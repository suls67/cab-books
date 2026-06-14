import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getHmrcFraudPreventionHeaders } from '../../../lib/hmrc/fraudHeaders';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { supabase } from '../../../supabaseClient';

const POLL_DELAY_MS = 2500;
const POLL_ATTEMPTS = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonSafely(response) {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function getHmrcMeta(response) {
  return {
    hmrcStatusCode: response.status,
    correlationId: response.headers.get('x-correlationid') || null
  };
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
    null;
  const allowances =
    payload?.allowancesAndDeductions ||
    payload?.allowances ||
    payload?.reliefs ||
    null;
  const taxDue =
    payload?.calculation?.taxCalculation?.totalIncomeTaxAndNicsDue ??
    payload?.taxCalculation?.totalIncomeTaxAndNicsDue ??
    null;
  const nic =
    payload?.calculation?.taxCalculation?.nics?.totalNic ??
    payload?.taxCalculation?.nics?.totalNic ??
    null;

  // Validation errors live in messages.errors — check here first
  const validationErrors = Array.isArray(payload?.messages?.errors) ? payload.messages.errors : [];
  const hasValidationErrors = validationErrors.length > 0;

  return {
    taxDue: taxDue === null ? null : Number(taxDue),
    nic: nic === null ? null : Number(nic),
    incomeSources,
    allowances,
    hasValidationErrors,
    errors: validationErrors
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

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    return res.status(response.status).json({
      error: payload?.message || payload?.error || 'Could not list HMRC calculations.',
      details: payload,
      ...getHmrcMeta(response)
    });
  }

  return res.status(200).json({
    status: 'complete',
    taxYear,
    calculations: payload.calculations || payload || []
  });
}

async function saveCalculationRecord(values) {
  await supabase
    .from('hmrc_calculations')
    .upsert([values], {
      onConflict: 'calculation_id'
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

  if (response.status === 404) {
    return res.status(200).json({
      status: 'pending',
      calculationId,
      calculationType,
      ...getHmrcMeta(response)
    });
  }

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    return res.status(response.status).json({
      error: payload?.message || payload?.error || 'Could not retrieve HMRC calculation.',
      details: payload,
      ...getHmrcMeta(response)
    });
  }

  const summary = extractCalculationSummary(payload);
  const status = summary.hasValidationErrors ? 'error' : 'complete';
  const submissionDate =
    payload?.metadata?.calculationTimestamp ||
    payload?.calculationTimestamp ||
    new Date().toISOString();
  const resolvedCalculationType = calculationType || payload?.calculationType || 'in-year';
  const disclaimer = getCalculationDisclaimer(resolvedCalculationType, submissionDate);

  await saveCalculationRecord({
    driver_id: context.driver.id,
    tax_year: taxYear,
    calculation_type: resolvedCalculationType,
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
  });

  return res.status(200).json({
    status,
    calculationId,
    calculationType: resolvedCalculationType,
    ...getHmrcMeta(response),
    taxDue: summary.taxDue,
    nic: summary.nic,
    incomeSources: summary.incomeSources,
    allowances: summary.allowances,
    submissionDate,
    errors: summary.errors,
    disclaimer,
    metadata: payload?.metadata || null,
    calculation: payload?.calculation || null,
    messages: payload?.messages || null
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

  const triggerPayload = await parseJsonSafely(triggerResponse);

  if (!triggerResponse.ok || !triggerPayload.calculationId) {
    return res.status(triggerResponse.status || 500).json({
      error: triggerPayload?.message || triggerPayload?.error || 'Could not trigger HMRC calculation.',
      details: triggerPayload,
      ...getHmrcMeta(triggerResponse)
    });
  }

  const calculationId = triggerPayload.calculationId;
  const submissionDate = new Date().toISOString();
  const disclaimer = getCalculationDisclaimer(calculationType, submissionDate);

  await saveCalculationRecord({
    driver_id: context.driver.id,
    tax_year: taxYear,
    calculation_type: calculationType,
    calculation_id: calculationId,
    status: 'pending',
    disclaimer,
    raw_response: triggerPayload,
    submission_date: submissionDate,
    updated_at: submissionDate
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

    const pendingLike = retrieveResponse.status === 404;

    if (pendingLike && attempt < POLL_ATTEMPTS - 1) {
      await sleep(POLL_DELAY_MS);
      continue;
    }

    if (pendingLike) {
      await supabase
        .from('hmrc_calculations')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('calculation_id', calculationId);

      return res.status(200).json({
        status: 'pending',
        calculationId,
        calculationType,
        ...getHmrcMeta(retrieveResponse),
        taxDue: null,
        nic: null,
        incomeSources: null,
        allowances: null,
        submissionDate,
        errors: [],
        disclaimer
      });
    }

    const retrievePayload = await parseJsonSafely(retrieveResponse);

    if (!retrieveResponse.ok) {
      await supabase
        .from('hmrc_calculations')
        .update({
          status: 'error',
          errors: [retrievePayload],
          raw_response: retrievePayload,
          updated_at: new Date().toISOString()
        })
        .eq('calculation_id', calculationId);

      return res.status(retrieveResponse.status).json({
        status: 'error',
        calculationId,
        calculationType,
        ...getHmrcMeta(retrieveResponse),
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
    const status = summary.hasValidationErrors ? 'error' : 'complete';
    const resolvedSubmissionDate =
      retrievePayload?.metadata?.calculationTimestamp ||
      retrievePayload?.calculationTimestamp ||
      submissionDate;
    const resolvedDisclaimer = getCalculationDisclaimer(calculationType, resolvedSubmissionDate);

    await supabase
      .from('hmrc_calculations')
      .update({
        status,
        tax_due: summary.taxDue,
        nic: summary.nic,
        income_sources: summary.incomeSources,
        allowances: summary.allowances,
        submission_date: resolvedSubmissionDate,
        errors: summary.errors,
        disclaimer: resolvedDisclaimer,
        raw_response: retrievePayload,
        updated_at: new Date().toISOString()
      })
      .eq('calculation_id', calculationId);

    return res.status(200).json({
      status,
      calculationId,
      calculationType,
      ...getHmrcMeta(retrieveResponse),
      taxDue: summary.taxDue,
      nic: summary.nic,
      incomeSources: summary.incomeSources,
      allowances: summary.allowances,
      submissionDate: resolvedSubmissionDate,
      errors: summary.errors,
      disclaimer: resolvedDisclaimer,
      metadata: retrievePayload?.metadata || null,
      calculation: retrievePayload?.calculation || null,
      messages: retrievePayload?.messages || null
    });
  }

  return res.status(200).json({
    status: 'pending',
    calculationId,
    calculationType,
    hmrcStatusCode: 404,
    correlationId: null,
    taxDue: null,
    nic: null,
    incomeSources: null,
    allowances: null,
    submissionDate,
    errors: [],
    disclaimer
  });
}

async function submitFinalDeclaration(req, res, context) {
  const { taxYear, calculationId, calculationType } = req.body;
  const confirmationType = calculationType || 'final-declaration';

  if (!taxYear || !calculationId) {
    return res.status(400).json({ error: 'taxYear and calculationId are required' });
  }

  if (confirmationType !== 'final-declaration' && confirmationType !== 'confirm-amendment') {
    return res.status(400).json({ error: 'Invalid final declaration type' });
  }

  const response = await hmrcFetch(
    `https://test-api.service.hmrc.gov.uk/individuals/calculations/${context.driver.nino}/self-assessment/${taxYear}/${calculationId}/${confirmationType}`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    },
    context
  );

  let payload = null;

  if (response.status !== 204) {
    payload = await response.json();
  }

  if (!response.ok && response.status !== 204) {
    return res.status(response.status).json({
      error: payload?.message || payload?.error || 'Could not submit the HMRC final declaration.',
      details: payload,
      ...getHmrcMeta(response)
    });
  }

  const confirmedAt = new Date().toISOString();

  await supabase
    .from('hmrc_calculations')
    .update({
      status: confirmationType,
      updated_at: confirmedAt,
      raw_response: {
        finalDeclarationSubmittedAt: confirmedAt,
        calculationType: confirmationType
      }
    })
    .eq('calculation_id', calculationId);

  return res.status(200).json({
    success: true,
    status: confirmationType,
    calculationId,
    calculationType: confirmationType,
    submittedAt: confirmedAt,
    ...getHmrcMeta(response)
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

    if (req.method === 'PUT') {
      return submitFinalDeclaration(req, res, context);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not process HMRC calculation.'
    });
  }
}
