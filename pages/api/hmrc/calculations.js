import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getHmrcFraudPreventionHeaders } from '../../../lib/hmrc/fraudHeaders';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { supabase } from '../../../supabaseClient';

const POLL_DELAY_MS = 2500;
const POLL_ATTEMPTS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCalculationDisclaimer(calculationType, submissionDate) {
  if (calculationType === 'in-year' || calculationType === 'intent-to-finalise') {
    return `This calculation is based on information HMRC has received up to ${submissionDate}. It may change as more information is received.`;
  }

  return '';
}

function extractCalculationSummary(payload) {
  const incomeSources =
    payload?.incomeSources ||
    payload?.inputs ||
    payload?.calculation ||
    null;
  const allowances =
    payload?.allowancesAndDeductions ||
    payload?.allowances ||
    payload?.reliefs ||
    null;
  const taxDue =
    payload?.taxCalculation?.totalIncomeTaxAndNicsDue ||
    payload?.calculation?.taxDue ||
    payload?.taxDue ||
    null;
  const nic =
    payload?.nationalInsuranceContributions?.totalNic ||
    payload?.nic ||
    payload?.taxCalculation?.totalNic ||
    null;
  const errors = payload?.errors || payload?.failures || payload?.messages || [];

  return {
    taxDue: taxDue === null ? null : Number(taxDue),
    nic: nic === null ? null : Number(nic),
    incomeSources,
    allowances,
    errors: Array.isArray(errors) ? errors : [errors]
  };
}

async function getHmrcContext(req) {
  const appAccessToken = getAccessTokenFromRequest(req);
  const currentDriver = await getDriverFromAccessToken(supabase, appAccessToken);

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, email, nino')
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

  return {
    driver,
    hmrcAccessToken,
    fraudHeaders: getHmrcFraudPreventionHeaders({
      ...req,
      headers: {
        ...req.headers,
        'x-hmrc-user-id': driver.email || String(driver.id)
      }
    })
  };
}

async function hmrcFetch(url, options, context, attempt = 0) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${context.hmrcAccessToken}`,
      ...context.fraudHeaders
    }
  });

  if (response.status === 401 && attempt === 0) {
    const { data: tokenData } = await supabase
      .from('hmrc_tokens')
      .select('*')
      .eq('driver_id', context.driver.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!tokenData) {
      throw new Error('HMRC token not found');
    }

    context.hmrcAccessToken = await refreshToken(tokenData, context.driver.id, supabase);
    return hmrcFetch(url, options, context, attempt + 1);
  }

  return response;
}

async function listCalculations(req, res, context) {
  const { taxYear, calculationType } = req.query;

  if (!taxYear) {
    return res.status(400).json({ error: 'taxYear is required' });
  }

  const query = calculationType ? `?calculationType=${encodeURIComponent(calculationType)}` : '';
  const response = await hmrcFetch(
    `https://test-api.service.hmrc.gov.uk/individuals/calculations/${context.driver.nino}/self-assessment/${taxYear}${query}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    },
    context
  );

  const payload = await response.json();

  if (!response.ok) {
    return res.status(response.status).json({
      error: payload.message || payload.error || 'Could not list HMRC calculations.',
      details: payload
    });
  }

  return res.status(200).json({
    status: 'complete',
    taxYear,
    calculations: payload.calculations || payload || []
  });
}

async function retrieveCalculation(req, res, context) {
  const { taxYear, calculationId, calculationType } = req.query;

  if (!taxYear || !calculationId) {
    return res.status(400).json({ error: 'taxYear and calculationId are required' });
  }

  const response = await hmrcFetch(
    `https://test-api.service.hmrc.gov.uk/individuals/calculations/${context.driver.nino}/self-assessment/${taxYear}/${calculationId}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    },
    context
  );

  const payload = await response.json();

  if (!response.ok) {
    return res.status(response.status).json({
      error: payload.message || payload.error || 'Could not retrieve HMRC calculation.',
      details: payload
    });
  }

  const summary = extractCalculationSummary(payload);
  const status = summary.errors.length ? 'error' : 'complete';
  const submissionDate = new Date().toISOString();
  const disclaimer = getCalculationDisclaimer(calculationType, submissionDate);

  await supabase
    .from('hmrc_calculations')
    .upsert([{
      driver_id: context.driver.id,
      tax_year: taxYear,
      calculation_type: calculationType || payload?.calculationType || 'in-year',
      calculation_id: calculationId,
      status,
      tax_due: summary.taxDue,
      nic: summary.nic,
      income_sources: summary.incomeSources,
      allowances: summary.allowances,
      submission_date: submissionDate,
      errors: summary.errors,
      disclaimer,
      raw_response: payload,
      updated_at: submissionDate
    }], {
      onConflict: 'calculation_id'
    });

  return res.status(200).json({
    status,
    calculationId,
    taxDue: summary.taxDue,
    nic: summary.nic,
    incomeSources: summary.incomeSources,
    allowances: summary.allowances,
    submissionDate,
    errors: summary.errors,
    disclaimer
  });
}

async function triggerCalculation(req, res, context) {
  const { taxYear, calculationType } = req.body;

  if (!taxYear || !calculationType) {
    return res.status(400).json({ error: 'taxYear and calculationType are required' });
  }

  const { data: pendingCalculation, error: pendingError } = await supabase
    .from('hmrc_calculations')
    .select('calculation_id, created_at')
    .eq('driver_id', context.driver.id)
    .eq('tax_year', taxYear)
    .eq('calculation_type', calculationType)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError) {
    return res.status(500).json({ error: `Could not check existing calculations: ${pendingError.message}` });
  }

  if (pendingCalculation) {
    return res.status(409).json({
      status: 'pending',
      error: 'A calculation is already processing for this tax year and type.',
      calculationId: pendingCalculation.calculation_id
    });
  }

  const triggerResponse = await hmrcFetch(
    `https://test-api.service.hmrc.gov.uk/individuals/calculations/${context.driver.nino}/self-assessment/${taxYear}/trigger/${calculationType}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    },
    context
  );

  const triggerPayload = await triggerResponse.json();

  if (!triggerResponse.ok || !triggerPayload.calculationId) {
    return res.status(triggerResponse.status || 500).json({
      error: triggerPayload.message || triggerPayload.error || 'Could not trigger HMRC calculation.',
      details: triggerPayload
    });
  }

  const calculationId = triggerPayload.calculationId;
  const submissionDate = new Date().toISOString();
  const disclaimer = getCalculationDisclaimer(calculationType, submissionDate);

  await supabase
    .from('hmrc_calculations')
    .upsert([{
      driver_id: context.driver.id,
      tax_year: taxYear,
      calculation_type: calculationType,
      calculation_id: calculationId,
      status: 'pending',
      disclaimer,
      raw_response: triggerPayload,
      submission_date: submissionDate,
      updated_at: submissionDate
    }], {
      onConflict: 'calculation_id'
    });

  await sleep(5000);

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const retrieveResponse = await hmrcFetch(
      `https://test-api.service.hmrc.gov.uk/individuals/calculations/${context.driver.nino}/self-assessment/${taxYear}/${calculationId}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.hmrc.8.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      },
      context
    );

    const retrievePayload = await retrieveResponse.json();

    if (!retrieveResponse.ok) {
      const pendingLike = retrieveResponse.status === 404 || retrieveResponse.status === 202;

      if (pendingLike && attempt < POLL_ATTEMPTS - 1) {
        await sleep(POLL_DELAY_MS);
        continue;
      }

      await supabase
        .from('hmrc_calculations')
        .update({
          status: pendingLike ? 'pending' : 'error',
          errors: [retrievePayload],
          raw_response: retrievePayload,
          updated_at: new Date().toISOString()
        })
        .eq('calculation_id', calculationId);

      if (pendingLike) {
        return res.status(202).json({
          status: 'pending',
          calculationId,
          taxDue: null,
          nic: null,
          incomeSources: null,
          allowances: null,
          submissionDate,
          errors: [],
          disclaimer
        });
      }

      return res.status(retrieveResponse.status).json({
        status: 'error',
        calculationId,
        taxDue: null,
        nic: null,
        incomeSources: null,
        allowances: null,
        submissionDate,
        errors: [retrievePayload],
        disclaimer
      });
    }

    const summary = extractCalculationSummary(retrievePayload);
    const status = summary.errors.length ? 'error' : 'complete';

    await supabase
      .from('hmrc_calculations')
      .update({
        status,
        tax_due: summary.taxDue,
        nic: summary.nic,
        income_sources: summary.incomeSources,
        allowances: summary.allowances,
        submission_date: submissionDate,
        errors: summary.errors,
        raw_response: retrievePayload,
        updated_at: submissionDate
      })
      .eq('calculation_id', calculationId);

    return res.status(200).json({
      status,
      calculationId,
      taxDue: summary.taxDue,
        nic: summary.nic,
        incomeSources: summary.incomeSources,
        allowances: summary.allowances,
        submissionDate,
        errors: summary.errors,
        disclaimer
      });
  }

  return res.status(202).json({
    status: 'pending',
    calculationId,
    taxDue: null,
    nic: null,
    incomeSources: null,
    allowances: null,
    submissionDate,
    errors: [],
    disclaimer
  });
}

export default async function handler(req, res) {
  try {
    const context = await getHmrcContext(req);

    if (req.method === 'GET') {
      if (req.query.calculationId) {
        return retrieveCalculation(req, res, context);
      }

      return listCalculations(req, res, context);
    }

    if (req.method === 'POST') {
      return triggerCalculation(req, res, context);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not process HMRC calculation.'
    });
  }
}
