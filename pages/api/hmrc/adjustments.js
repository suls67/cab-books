import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { supabase } from '../../../supabaseClient';

const TAX_YEAR_PATTERN = /^\d{4}-\d{2}$/;

async function parseJsonSafely(response) {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}


async function getHmrcContext(req) {
  const appAccessToken = getAccessTokenFromRequest(req);
  const currentDriver = await getDriverFromAccessToken(supabase, appAccessToken);

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, nino')
    .eq('id', currentDriver.id)
    .maybeSingle();

  if (driverError || !driver) {
    throw new Error('Driver not found');
  }

  const { data: tokenData, error: tokenError } = await supabase
    .from('hmrc_tokens')
    .select('*')
    .eq('driver_id', currentDriver.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError || !tokenData) {
    throw new Error('HMRC token not found');
  }

  let hmrcAccessToken = tokenData.access_token;

  if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
    hmrcAccessToken = await refreshToken(tokenData, currentDriver.id, supabase);
  }

  return { driver, hmrcAccessToken };
}

async function getBusinessId(nino, accessToken) {
  const businessResponse = await fetch(
    `https://test-api.service.hmrc.gov.uk/individuals/business/details/${nino}/list`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.hmrc.2.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    }
  );

  const businessData = await parseJsonSafely(businessResponse);
  const businessId = businessData?.listOfBusinesses?.[0]?.businessId;

  if (!businessResponse.ok || !businessId) {
    throw new Error(
      businessData?.message ||
        businessData?.error ||
        'Could not load business details before adjustment flow.'
    );
  }

  return businessId;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const context = await getHmrcContext(req);

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('hmrc_adjustments')
        .select(
          'id, tax_year, calculation_id, business_id, submitted_at, adjustment_payload, hmrc_response'
        )
        .eq('driver_id', context.driver.id)
        .order('submitted_at', { ascending: false })
        .limit(15);

      if (error) {
        return res.status(500).json({ error: `Could not load adjustment history: ${error.message}` });
      }

      return res.status(200).json({ history: data || [] });
    }

    const { action, taxYear, calculationId, turnover, expenses, otherIncome } = req.body;

    if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
      return res.status(400).json({ error: 'taxYear is required in YYYY-YY format.' });
    }

    if (!action) {
      return res.status(400).json({ error: 'action is required (trigger, retrieve, submit).' });
    }

    const businessId = await getBusinessId(context.driver.nino, context.hmrcAccessToken);

    if (action === 'trigger') {
      const startYear = Number(taxYear.slice(0, 4));
      const endYear = startYear + 1;
      const accountingPeriod = { startDate: `${startYear}-04-06`, endDate: `${endYear}-04-05` };

      const triggerResponse = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/self-assessment/adjustable-summary/${context.driver.nino}/trigger`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${context.hmrcAccessToken}`,
            Accept: 'application/vnd.hmrc.7.0+json',
            'Content-Type': 'application/json',
            'Gov-Test-Scenario': 'DEFAULT'
          },
          body: JSON.stringify({
            typeOfBusiness: 'self-employment',
            businessId,
            taxYear,
            accountingPeriod
          })
        }
      );

      const triggerData = await parseJsonSafely(triggerResponse);

      if (!triggerResponse.ok || !triggerData?.calculationId) {
        return res.status(triggerResponse.status).json({
          error: triggerData?.message || triggerData?.error || 'Could not trigger calculation for adjustment flow.',
          details: triggerData
        });
      }

      return res.status(200).json({
        success: true,
        action,
        taxYear,
        businessId,
        calculationId: triggerData.calculationId
      });
    }

    if (!calculationId) {
      return res.status(400).json({ error: 'calculationId is required for retrieve/submit.' });
    }

    if (action === 'retrieve') {
      const retrieveResponse = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/self-assessment/adjustable-summary/${context.driver.nino}/self-employment/${calculationId}/${taxYear}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${context.hmrcAccessToken}`,
            Accept: 'application/vnd.hmrc.7.0+json',
            'Gov-Test-Scenario': 'SELF_EMPLOYMENT_PROFIT'
          }
        }
      );

      const retrieveData = await parseJsonSafely(retrieveResponse);

      if (!retrieveResponse.ok) {
        return res.status(retrieveResponse.status).json({
          error: retrieveData?.message || retrieveData?.error || 'Could not retrieve adjustable summary.',
          details: retrieveData
        });
      }

      return res.status(200).json({
        success: true,
        action,
        taxYear,
        businessId,
        calculationId,
        summary: retrieveData
      });
    }

    if (action !== 'submit') {
      return res.status(400).json({ error: 'Unsupported action. Use trigger, retrieve or submit.' });
    }

    const {
      carVanTravelExpenses,
      financeCharges,
      depreciation,
      wagesAndStaffCosts,
      adminCosts,
      professionalFees,
      otherExpenses,
      carVanTravelExpensesDisallowable,
      financeChargesDisallowable,
      depreciationDisallowable,
      wagesAndStaffCostsDisallowable,
      adminCostsDisallowable,
      professionalFeesDisallowable,
      otherExpensesDisallowable
    } = req.body;

    const toNum = (val) => { const n = Number(val); return Number.isFinite(n) ? n : 0; };
    const omitZero = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== 0));

    const expensesPayload = omitZero({
      carVanTravelExpenses: toNum(carVanTravelExpenses),
      financeCharges: toNum(financeCharges),
      depreciation: toNum(depreciation),
      wagesAndStaffCosts: toNum(wagesAndStaffCosts),
      adminCosts: toNum(adminCosts),
      professionalFees: toNum(professionalFees),
      otherExpenses: toNum(otherExpenses)
    });

    const additionsPayload = omitZero({
      carVanTravelExpensesDisallowable: toNum(carVanTravelExpensesDisallowable),
      financeChargesDisallowable: toNum(financeChargesDisallowable),
      depreciationDisallowable: toNum(depreciationDisallowable),
      wagesAndStaffCostsDisallowable: toNum(wagesAndStaffCostsDisallowable),
      adminCostsDisallowable: toNum(adminCostsDisallowable),
      professionalFeesDisallowable: toNum(professionalFeesDisallowable),
      otherExpensesDisallowable: toNum(otherExpensesDisallowable)
    });

    const incomePayload = { turnover: toNum(turnover) };
    if (toNum(otherIncome) !== 0) incomePayload.other = toNum(otherIncome);

    const adjustmentPayload = { income: incomePayload };

    if (Object.keys(expensesPayload).length > 0) {
      adjustmentPayload.expenses = expensesPayload;
    }

    if (Object.keys(additionsPayload).length > 0) {
      adjustmentPayload.additions = additionsPayload;
    }

    const submitResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/self-assessment/adjustable-summary/${context.driver.nino}/self-employment/${calculationId}/adjust/${taxYear}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.hmrcAccessToken}`,
          Accept: 'application/vnd.hmrc.7.0+json',
          'Content-Type': 'application/json',
          'Gov-Test-Scenario': 'DEFAULT'
        },
        body: JSON.stringify(adjustmentPayload)
      }
    );

    const submitData = await parseJsonSafely(submitResponse);

    if (!submitResponse.ok) {
      return res.status(submitResponse.status).json({
        error: submitData?.message || submitData?.error || 'Could not submit accounting adjustment.',
        details: submitData
      });
    }

    const { error: saveError } = await supabaseAdmin
      .from('hmrc_adjustments')
      .insert([
        {
          driver_id: context.driver.id,
          business_id: businessId,
          tax_year: taxYear,
          calculation_id: calculationId,
          adjustment_payload: adjustmentPayload,
          hmrc_response: submitData
        }
      ]);

    if (saveError) {
      return res.status(500).json({
        error: `HMRC accepted the adjustment, but saving history failed: ${saveError.message}`,
        details: submitData
      });
    }

    return res.status(200).json({
      success: true,
      action,
      taxYear,
      businessId,
      calculationId,
      response: submitData || { message: 'HMRC accepted adjustment with no response body.' }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not complete HMRC adjustment flow.'
    });
  }
}
