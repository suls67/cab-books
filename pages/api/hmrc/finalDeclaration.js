import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getHmrcFraudPreventionHeaders } from '../../../lib/hmrc/fraudHeaders';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { supabase } from '../../../supabaseClient';

const HMRC_BASE = 'https://test-api.service.hmrc.gov.uk';

const ERROR_MAP = {
  INCOME_SOURCES_INCOMPLETE: {
    message: 'Some income sources have not been fully declared. Review your quarterly submissions before finalising.',
    action: { label: 'View obligations', href: '/hmrc-obligations' },
    canRetry: false
  },
  OBLIGATIONS_NOT_MET: {
    message: 'Not all quarterly obligations have been fulfilled. Complete all quarterly updates before finalising.',
    action: { label: 'Submit quarterly update', href: '/hmrc-submit' },
    canRetry: false
  },
  CALCULATION_NOT_FOUND: {
    message: 'The tax calculation could not be found. Trigger a new calculation and try again.',
    action: { label: 'Run calculation', href: '/hmrc-calculations' },
    canRetry: false
  },
  FINAL_DECLARATION_RECEIVED: {
    message: 'A final declaration has already been submitted for this tax year.',
    action: null,
    canRetry: false
  },
  RULE_FINAL_DECLARATION_RECEIVED: {
    message: 'A final declaration has already been submitted for this tax year.',
    action: null,
    canRetry: false
  },
  MATCHING_RESOURCE_NOT_FOUND: {
    message: 'HMRC could not find a matching record. Ensure all submissions are complete and try again.',
    action: { label: 'View obligations', href: '/hmrc-obligations' },
    canRetry: true
  },
  FORBIDDEN: {
    message: 'You do not have permission to submit this declaration. Please reconnect your HMRC account.',
    action: { label: 'Reconnect HMRC', href: '/connect-hmrc' },
    canRetry: false
  },
  SERVER_ERROR: {
    message: 'HMRC is experiencing technical issues. Please try again in a few minutes.',
    action: null,
    canRetry: true
  },
  SERVICE_UNAVAILABLE: {
    message: 'The HMRC service is temporarily unavailable. Please try again later.',
    action: null,
    canRetry: true
  }
};

function mapHmrcError(code, message) {
  if (code && ERROR_MAP[code]) return ERROR_MAP[code];
  if (message?.toLowerCase().includes('unavailable')) return ERROR_MAP.SERVICE_UNAVAILABLE;
  return {
    message: 'An unexpected error occurred. Please try again or contact support if the issue persists.',
    action: null,
    canRetry: true
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getContext(req) {
  const appToken = getAccessTokenFromRequest(req);
  const currentDriver = await getDriverFromAccessToken(supabase, appToken);

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('id, email, nino')
    .eq('id', currentDriver.id)
    .maybeSingle();

  if (driverError || !driver) throw new Error('Driver not found');

  const { data: tokenData, error: tokenError } = await supabase
    .from('hmrc_tokens')
    .select('*')
    .eq('driver_id', currentDriver.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError || !tokenData) throw new Error('HMRC token not found');

  let hmrcToken = tokenData.access_token;
  if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
    hmrcToken = await refreshToken(tokenData, currentDriver.id, supabase);
  }

  const fraudHeaders = getHmrcFraudPreventionHeaders({
    ...req,
    headers: { ...req.headers, 'x-hmrc-user-id': driver.email || String(driver.id) }
  });

  return { driver, currentDriver, hmrcToken, fraudHeaders };
}

async function getBusinessId(nino, hmrcToken) {
  const res = await fetch(`${HMRC_BASE}/individuals/business/details/${nino}/list`, {
    headers: {
      Authorization: `Bearer ${hmrcToken}`,
      Accept: 'application/vnd.hmrc.2.0+json',
      'Gov-Test-Scenario': 'DEFAULT'
    }
  });
  const data = await res.json();
  const businessId = data?.listOfBusinesses?.[0]?.businessId;
  if (!res.ok || !businessId) throw new Error('Could not retrieve business details from HMRC');
  return businessId;
}

async function handlePreflight(req, res) {
  const { taxYear } = req.query;
  if (!taxYear) return res.status(400).json({ error: 'taxYear is required' });

  const { driver, currentDriver, hmrcToken, fraudHeaders } = await getContext(req);

  // Guard: already finalised?
  const { data: existingFinal } = await supabase
    .from('hmrc_calculations')
    .select('calculation_id, calculation_type, submission_date, tax_due, nic, updated_at')
    .eq('driver_id', currentDriver.id)
    .eq('tax_year', taxYear)
    .in('status', ['final-declaration', 'confirm-amendment'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingFinal) {
    return res.status(200).json({
      taxYear,
      alreadyFinalised: true,
      finalisedRecord: existingFinal,
      canProceed: false
    });
  }

  // Check 1: All quarterly obligations fulfilled — verified via Supabase submissions
  // (HMRC DEFAULT sandbox returns canned obligation data regardless of actual submissions)
  let obligationsCheck = { passed: false, message: 'Could not verify quarterly submissions.', openPeriods: [] };
  try {
    const { data: submissions, error: submissionsError } = await supabase
      .from('hmrc_submissions')
      .select('id')
      .eq('driver_id', currentDriver.id);

    if (submissionsError) throw submissionsError;

    const count = submissions?.length || 0;
    if (count >= 3) {
      obligationsCheck = { passed: true, message: `${count} quarterly submissions found.`, openPeriods: [] };
    } else {
      obligationsCheck = {
        passed: false,
        message: `Only ${count} quarterly submissions found. At least 3 are required.`,
        openPeriods: []
      };
    }
  } catch {
    obligationsCheck = { passed: false, message: 'Could not verify quarterly submissions.', openPeriods: [] };
  }

  // Check 2: Annual summary submitted
  let annualCheck = { passed: false, message: '' };
  const { data: annualRecord } = await supabase
    .from('hmrc_annual_submissions')
    .select('id, submitted_at')
    .eq('driver_id', currentDriver.id)
    .eq('tax_year', taxYear)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  annualCheck = annualRecord
    ? { passed: true, message: `Annual summary submitted on ${new Date(annualRecord.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.` }
    : { passed: false, message: 'No annual summary has been submitted for this tax year.' };

  // Check 3: At least one completed calculation
  let calculationCheck = { passed: false, message: '', lastCalculation: null };
  const { data: lastCalc } = await supabase
    .from('hmrc_calculations')
    .select('calculation_id, calculation_type, tax_due, nic, submission_date, status')
    .eq('driver_id', currentDriver.id)
    .eq('tax_year', taxYear)
    .in('status', ['complete', 'error'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  calculationCheck = lastCalc
    ? {
        passed: true,
        message: `Last calculation retrieved on ${new Date(lastCalc.submission_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
        lastCalculation: lastCalc
      }
    : { passed: false, message: 'No tax calculation found. Run a calculation first.', lastCalculation: null };

  const canProceed = obligationsCheck.passed && annualCheck.passed && calculationCheck.passed;

  return res.status(200).json({
    taxYear,
    alreadyFinalised: false,
    canProceed,
    checks: {
      obligations: obligationsCheck,
      annualSummary: annualCheck,
      calculation: calculationCheck
    }
  });
}

async function handleSubmit(req, res) {
  const { taxYear } = req.body;
  if (!taxYear) return res.status(400).json({ error: 'taxYear is required' });

  const { driver, currentDriver, hmrcToken, fraudHeaders } = await getContext(req);

  // Guard: already finalised
  const { data: existingFinal } = await supabase
    .from('hmrc_calculations')
    .select('calculation_id')
    .eq('driver_id', currentDriver.id)
    .eq('tax_year', taxYear)
    .in('status', ['final-declaration', 'confirm-amendment'])
    .maybeSingle();

  if (existingFinal) {
    return res.status(409).json({
      error: 'A final declaration has already been submitted for this tax year.',
      errorCode: 'FINAL_DECLARATION_RECEIVED',
      action: null,
      canRetry: false
    });
  }

  // Step 1: Trigger intent-to-finalise
  const triggerRes = await fetch(
    `${HMRC_BASE}/individuals/calculations/${driver.nino}/self-assessment/${taxYear}/trigger/intent-to-finalise`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hmrcToken}`,
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT',
        ...fraudHeaders
      }
    }
  );

  if (!triggerRes.ok) {
    const triggerData = await triggerRes.json().catch(() => ({}));
    const errorCode = triggerData?.code || triggerData?.errors?.[0]?.code || 'UNKNOWN';
    const mapped = mapHmrcError(errorCode, triggerData?.message);
    return res.status(triggerRes.status).json({
      error: mapped.message,
      errorCode,
      action: mapped.action,
      canRetry: mapped.canRetry,
      correlationId: triggerRes.headers.get('x-correlationid') || null
    });
  }

  const triggerData = await triggerRes.json().catch(() => ({}));
  const calculationId = triggerData?.calculationId;

  if (!calculationId) {
    return res.status(500).json({
      error: 'HMRC did not return a calculation ID. Please try again.',
      canRetry: true
    });
  }

  // Step 2: Wait 5s for HMRC to process
  await sleep(5000);

  // Step 3: Retrieve the calculation
  const retrieveRes = await fetch(
    `${HMRC_BASE}/individuals/calculations/${driver.nino}/self-assessment/${taxYear}/${calculationId}`,
    {
      headers: {
        Authorization: `Bearer ${hmrcToken}`,
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT',
        ...fraudHeaders
      }
    }
  );

  const retrieveData = retrieveRes.status === 204 ? {} : await retrieveRes.json().catch(() => ({}));

  if (!retrieveRes.ok) {
    const errorCode = retrieveData?.code || retrieveData?.errors?.[0]?.code || 'UNKNOWN';
    const mapped = mapHmrcError(errorCode, retrieveData?.message);
    return res.status(retrieveRes.status).json({
      error: mapped.message,
      errorCode,
      action: mapped.action,
      canRetry: mapped.canRetry,
      correlationId: retrieveRes.headers.get('x-correlationid') || null
    });
  }

  // Step 4: Submit final declaration (returns 204, no body)
  const declarationRes = await fetch(
    `${HMRC_BASE}/individuals/calculations/${driver.nino}/self-assessment/${taxYear}/${calculationId}/final-declaration`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hmrcToken}`,
        Accept: 'application/vnd.hmrc.8.0+json',
        'Gov-Test-Scenario': 'DEFAULT',
        ...fraudHeaders
      }
    }
  );

  const correlationId = declarationRes.headers.get('x-correlationid') || null;

  if (declarationRes.status !== 204 && !declarationRes.ok) {
    const declarationData = await declarationRes.json().catch(() => ({}));
    const errorCode = declarationData?.code || declarationData?.errors?.[0]?.code || 'UNKNOWN';
    const mapped = mapHmrcError(errorCode, declarationData?.message);
    return res.status(declarationRes.status).json({
      error: mapped.message,
      errorCode,
      action: mapped.action,
      canRetry: mapped.canRetry,
      correlationId
    });
  }

  // Step 5: Extract figures from the retrieved calculation
  const taxDue = retrieveData?.calculation?.taxCalculation?.totalIncomeTaxAndNicsDue ?? null;
  const nic = retrieveData?.calculation?.taxCalculation?.nics?.totalNic ?? null;
  const submittedAt = new Date().toISOString();

  // Step 6: Save to Supabase
  const { error: saveError } = await supabase.from('hmrc_calculations').upsert([{
    driver_id: currentDriver.id,
    tax_year: taxYear,
    calculation_type: 'final-declaration',
    calculation_id: calculationId,
    status: 'final-declaration',
    tax_due: taxDue,
    nic,
    income_sources: retrieveData?.calculation?.incomeSources || null,
    allowances: retrieveData?.calculation?.allowancesAndDeductions || null,
    submission_date: submittedAt,
    errors: retrieveData?.messages ? [retrieveData.messages] : null,
    disclaimer: `Final declaration for ${taxYear}. HMRC correlation ID: ${correlationId}`,
    raw_response: { ...retrieveData, correlationId, finalDeclarationSubmittedAt: submittedAt },
    updated_at: submittedAt
  }], { onConflict: 'calculation_id' });

  if (saveError) {
    return res.status(500).json({
      error: `HMRC accepted the declaration, but saving the record failed: ${saveError.message}. Your submission reference is ${correlationId}.`,
      correlationId,
      calculationId,
      canRetry: false
    });
  }

  return res.status(200).json({
    success: true,
    taxYear,
    calculationId,
    correlationId,
    taxDue,
    nic,
    periodTo: retrieveData?.metadata?.periodTo || null,
    metadata: retrieveData?.metadata || null,
    calculation: retrieveData?.calculation || null,
    messages: retrieveData?.messages || null,
    submittedAt
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return handlePreflight(req, res);
    if (req.method === 'POST') return handleSubmit(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'An unexpected error occurred.' });
  }
}
