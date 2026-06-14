import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { supabase } from '../../../supabaseClient';

const TAX_YEAR_PATTERN = /^\d{4}-\d{2}$/;

async function parseJsonSafely(response) {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function buildAnnualPayload(tradingIncomeAllowance) {
  return {
    allowances: {
      tradingIncomeAllowance: Number(tradingIncomeAllowance)
    },
    nonFinancials: {
      businessDetailsChangedRecently: false
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const appAccessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, appAccessToken);

    if (req.method === 'GET') {
      const { taxYear } = req.query;

      if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
        return res.status(400).json({ error: 'taxYear is required as a query parameter in the format YYYY-YY' });
      }

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

      const businessResponse = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/business/details/${driver.nino}/list`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${hmrcAccessToken}`,
            Accept: 'application/vnd.hmrc.2.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      );

      const businessData = await businessResponse.json();
      const businessId = businessData?.listOfBusinesses?.[0]?.businessId;

      if (!businessResponse.ok || !businessId) {
        return res.status(businessResponse.status || 400).json({
          error: businessData?.message || businessData?.error || 'Could not load HMRC business details.',
          details: businessData
        });
      }

      const annualResponse = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/annual/${taxYear}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${hmrcAccessToken}`,
            Accept: 'application/vnd.hmrc.5.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      );

      const annualData = await parseJsonSafely(annualResponse);

      if (!annualResponse.ok) {
        return res.status(annualResponse.status).json({
          error: annualData?.message || annualData?.error || 'Could not retrieve HMRC annual submission.',
          details: annualData
        });
      }

      return res.status(200).json({
        taxYear,
        businessId,
        ...annualData
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { taxYear, tradingIncomeAllowance, payload } = req.body;

    if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
      return res.status(400).json({ error: 'taxYear is required in the format YYYY-YY' });
    }

    if (tradingIncomeAllowance === undefined && !payload) {
      return res.status(400).json({ error: 'Provide tradingIncomeAllowance or a full payload object.' });
    }

    const allowanceValue = Number(tradingIncomeAllowance ?? payload?.allowances?.tradingIncomeAllowance ?? 0);
    if (!Number.isFinite(allowanceValue) || allowanceValue < 0) {
      return res.status(400).json({ error: 'tradingIncomeAllowance must be a valid positive number.' });
    }

    const annualPayload = payload || buildAnnualPayload(allowanceValue);

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

    const businessResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/details/${driver.nino}/list`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${hmrcAccessToken}`,
          Accept: 'application/vnd.hmrc.2.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const businessData = await businessResponse.json();
    const businessId = businessData?.listOfBusinesses?.[0]?.businessId;

    if (!businessResponse.ok || !businessId) {
      return res.status(businessResponse.status || 400).json({
        error: businessData?.message || businessData?.error || 'Could not load HMRC business details for annual submission.',
        details: businessData
      });
    }

    if (allowanceValue > 0) {
      const cumulativeGetRes = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/cumulative/${taxYear}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${hmrcAccessToken}`,
            Accept: 'application/vnd.hmrc.5.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      );

      if (cumulativeGetRes.ok) {
        const cumulativeData = await parseJsonSafely(cumulativeGetRes);
        const hasExpenses = cumulativeData?.periodExpenses &&
          Object.values(cumulativeData.periodExpenses).some((v) => Number(v) > 0);

        if (hasExpenses) {
          const zeroExpensesRes = await fetch(
            `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/cumulative/${taxYear}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${hmrcAccessToken}`,
                Accept: 'application/vnd.hmrc.5.0+json',
                'Content-Type': 'application/json',
                'Gov-Test-Scenario': 'DEFAULT'
              },
              body: JSON.stringify({
                periodDates: cumulativeData.periodDates,
                periodIncome: cumulativeData.periodIncome,
                periodExpenses: { consolidatedExpenses: 0 }
              })
            }
          );

          if (!zeroExpensesRes.ok) {
            const zeroExpensesError = await parseJsonSafely(zeroExpensesRes);
            return res.status(zeroExpensesRes.status).json({
              error: 'Could not remove expenses from cumulative submission before claiming Trading Income Allowance.',
              details: zeroExpensesError
            });
          }
        }
      }
    }

    const annualResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/annual/${taxYear}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${hmrcAccessToken}`,
          Accept: 'application/vnd.hmrc.5.0+json',
          'Content-Type': 'application/json',
          'Gov-Test-Scenario': 'DEFAULT'
        },
        body: JSON.stringify(annualPayload)
      }
    );

    const annualResult = await parseJsonSafely(annualResponse);

    if (!annualResponse.ok) {
      return res.status(annualResponse.status).json({
        error: annualResult?.message || annualResult?.error || 'HMRC annual submission failed.',
        details: annualResult,
        sent: {
          nino: driver.nino,
          businessId,
          taxYear
        }
      });
    }

    const { error: saveError } = await supabaseAdmin
      .from('hmrc_annual_submissions')
      .insert([{
        driver_id: currentDriver.id,
        business_id: businessId,
        tax_year: taxYear,
        payload: annualPayload,
        hmrc_response: annualResult
      }]);

    if (saveError) {
      return res.status(500).json({
        error: `HMRC accepted the annual submission, but saving history failed: ${saveError.message}`,
        details: annualResult
      });
    }

    return res.status(200).json({
      success: true,
      businessId,
      taxYear,
      response: annualResult || { message: 'HMRC accepted annual submission with no response body.' }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not submit annual HMRC figures.'
    });
  }
}
