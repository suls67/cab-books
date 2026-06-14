import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getHmrcFraudPreventionHeaders } from '../../../lib/hmrc/fraudHeaders';
import { getNextOpenPeriod, getPeriodKey, sortPeriods } from '../../../lib/hmrcPeriods';
import { supabase } from '../../../supabaseClient';
import { refreshToken } from '../../../lib/hmrc/refreshToken';

const HMRC_MAX_VALUE = 99999999999.99;
const TAX_YEAR_PATTERN = /^\d{4}-\d{2}$/;

const isPeriodSubmitted = (period, submissionHistory) =>
  submissionHistory.some(
    (submission) =>
      submission.period_start === period.start && submission.period_end === period.end
  );

const isPeriodFulfilled = (period, submissionHistory) =>
  period.status === 'fulfilled' || isPeriodSubmitted(period, submissionHistory);

function shiftEndDateToTaxYear(obligationEndDate, taxYear) {
  const taxYearStart = Number(taxYear.slice(0, 4));
  const [, mm, dd] = obligationEndDate.split('-');
  const month = Number(mm);
  const day = Number(dd);
  const inEndYear = month < 4 || (month === 4 && day <= 5);
  const targetYear = inEndYear ? taxYearStart + 1 : taxYearStart;
  return `${targetYear}-${mm}-${dd}`;
}

async function getDriverAndToken(req) {
  const accessToken = getAccessTokenFromRequest(req);
  const currentDriver = await getDriverFromAccessToken(supabase, accessToken);

  const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('nino')
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

  return { currentDriver, driver, hmrcToken };
}

async function getBusinessId(nino, hmrcToken) {
  const response = await fetch(
    `https://test-api.service.hmrc.gov.uk/individuals/business/details/${nino}/list`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${hmrcToken}`,
        Accept: 'application/vnd.hmrc.2.0+json',
        'Gov-Test-Scenario': 'DEFAULT'
      }
    }
  );
  const data = await response.json();
  const businessId = data?.listOfBusinesses?.[0]?.businessId;
  if (!response.ok || !businessId) throw new Error(data?.message || 'Could not load business details');
  return businessId;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'GET') {
      const { taxYear } = req.query;

      if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
        return res.status(400).json({ error: 'taxYear is required in the format YYYY-YY' });
      }

      const { driver, hmrcToken } = await getDriverAndToken(req);
      const businessId = await getBusinessId(driver.nino, hmrcToken);

      const hmrcRes = await fetch(
        `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/cumulative/${taxYear}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${hmrcToken}`,
            Accept: 'application/vnd.hmrc.5.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      );

      if (hmrcRes.status === 404) {
        return res.status(200).json({ noData: true, taxYear });
      }

      const data = hmrcRes.status === 204 ? {} : await hmrcRes.json();

      if (!hmrcRes.ok) {
        return res.status(hmrcRes.status).json({
          error: data?.message || data?.error || 'Could not retrieve cumulative summary from HMRC.',
          details: data
        });
      }

      return res.status(200).json({ taxYear, businessId, ...data });
    }

    const accessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, accessToken);
    const { turnover, expenses, openingTurnover, openingExpenses, taxYear } = req.body;

    if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
      return res.status(400).json({ error: 'taxYear is required in the format YYYY-YY' });
    }

    const fraudHeaders = getHmrcFraudPreventionHeaders({
      ...req,
      headers: {
        ...req.headers,
        'x-hmrc-user-id': currentDriver.email || String(currentDriver.id)
      }
    });

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('nino')
      .eq('id', currentDriver.id)
      .maybeSingle();

    if (driverError || !driver) {
      throw new Error('Driver not found');
    }

    // token
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

    let access_token = tokenData.access_token;

    // refresh if expired
    if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
      access_token = await refreshToken(tokenData, currentDriver.id, supabase);
    }

    // get businessId
    const businessResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/details/${driver.nino}/list`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.2.0+json',
          'Gov-Test-Scenario': 'DEFAULT',
          ...fraudHeaders
        }
      }
    );

    const businessData = await businessResponse.json();
    const firstBusiness = businessData.listOfBusinesses?.[0];
    const businessId = firstBusiness?.businessId;
    const businessType = firstBusiness?.typeOfBusiness;

    // get obligations
    const obligationsResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/obligations/details/${driver.nino}/income-and-expenditure?typeOfBusiness=self-employment&businessId=${businessId}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.3.0+json',
          'Gov-Test-Scenario': 'DEFAULT',
          ...fraudHeaders
        }
      }
    );

    const obligationsData = await obligationsResponse.json();

    const obligation = obligationsData.obligations[0];

    const periods = obligation.obligationDetails
      .map((item) => ({
        start: item.periodStartDate,
        end: item.periodEndDate,
        due: item.dueDate,
        status: item.status
      }));
    const sortedPeriods = sortPeriods(periods);

    const { data: existingSubmissions, error: existingSubmissionError } = await supabase
      .from('hmrc_submissions')
      .select('id, submitted_at, period_id, period_start, period_end, turnover, expenses')
      .eq('driver_id', currentDriver.id)
      .order('submitted_at', { ascending: false });

    if (existingSubmissionError) {
      throw new Error(`Could not verify existing HMRC submissions: ${existingSubmissionError.message}`);
    }

    const submissionHistory = existingSubmissions || [];
    const nextPendingPeriod =
      getNextOpenPeriod(sortedPeriods.filter((period) => !isPeriodFulfilled(period, submissionHistory))) ||
      null;

    if (!nextPendingPeriod) {
      throw new Error('No open obligations found (all already submitted)');
    }

    const periodStartDate = `${taxYear.slice(0, 4)}-04-06`;
    const periodEndDate = shiftEndDateToTaxYear(nextPendingPeriod.end, taxYear);
    const nextPeriodIndex = sortedPeriods.findIndex(
      (period) => getPeriodKey(period) === getPeriodKey(nextPendingPeriod)
    );

    //const turnover = 1000;
    //const expenses = 200;
    if (turnover === undefined || expenses === undefined) {
      throw new Error('Turnover and expenses are required');
    }

    const enteredTurnover = Number(turnover);
    const enteredExpenses = Number(expenses);

    if (!Number.isFinite(enteredTurnover) || !Number.isFinite(enteredExpenses)) {
      throw new Error('Turnover and expenses must be numbers');
    }

    if (enteredTurnover < 0 || enteredExpenses < 0) {
      throw new Error('Values cannot be negative');
    }

    const previousFulfilledPeriods = sortedPeriods
      .slice(0, nextPeriodIndex)
      .filter((period) => isPeriodFulfilled(period, submissionHistory));
    const latestPreviousPeriod = previousFulfilledPeriods[previousFulfilledPeriods.length - 1] || null;
    const latestPreviousSubmission =
      latestPreviousPeriod
        ? submissionHistory.find(
            (submission) =>
              submission.period_start === latestPreviousPeriod.start &&
              submission.period_end === latestPreviousPeriod.end
          ) || null
        : null;
    const baselineRequired = Boolean(latestPreviousPeriod && !latestPreviousSubmission);

    if (baselineRequired) {
      const enteredOpeningTurnover = Number(openingTurnover);
      const enteredOpeningExpenses = Number(openingExpenses);

      if (!Number.isFinite(enteredOpeningTurnover) || !Number.isFinite(enteredOpeningExpenses)) {
        return res.status(409).json({
          error: 'Opening totals are required before this cumulative submission can continue.',
          details: {
            reason: 'missing_opening_totals',
            previousFulfilledPeriod: latestPreviousPeriod
          }
        });
      }

      if (enteredOpeningTurnover < 0 || enteredOpeningExpenses < 0) {
        return res.status(400).json({
          error: 'Opening totals cannot be negative.',
          details: {
            openingTurnover: enteredOpeningTurnover,
            openingExpenses: enteredOpeningExpenses
          }
        });
      }
    }

    const previousTurnover = Number(
      latestPreviousSubmission?.turnover || (baselineRequired ? Number(openingTurnover) : 0)
    );
    const previousExpenses = Number(
      latestPreviousSubmission?.expenses || (baselineRequired ? Number(openingExpenses) : 0)
    );

    if (!Number.isFinite(previousTurnover) || !Number.isFinite(previousExpenses)) {
      throw new Error('Previous submitted totals could not be read correctly.');
    }

    const cumulativeTurnover = previousTurnover + enteredTurnover;
    const cumulativeExpenses = previousExpenses + enteredExpenses;

    if (!Number.isFinite(cumulativeTurnover) || !Number.isFinite(cumulativeExpenses)) {
      throw new Error('The calculated year-to-date totals are invalid.');
    }

    if (
      Math.abs(cumulativeTurnover) > HMRC_MAX_VALUE ||
      Math.abs(cumulativeExpenses) > HMRC_MAX_VALUE
    ) {
      return res.status(400).json({
        error: 'The year-to-date totals are outside the HMRC allowed range.',
        details: {
          enteredTurnover,
          enteredExpenses,
          previousTurnover,
          previousExpenses,
          cumulativeTurnover,
          cumulativeExpenses
        }
      });
    }

    // submit to HMRC
    const hmrcPayload = {
      periodDates: {
        periodStartDate,
        periodEndDate
      },
      periodIncome: {
        turnover: Number(cumulativeTurnover.toFixed(2)),
        other: 0
      },
      periodExpenses: {
        consolidatedExpenses: Number(cumulativeExpenses.toFixed(2))
      }
    };

    const submissionResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/cumulative/${taxYear}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.5.0+json',
          'Content-Type': 'application/json',
          'Gov-Test-Scenario': 'DEFAULT',
          ...fraudHeaders
        },
        body: JSON.stringify(hmrcPayload)
      }
    );

    const submissionResult = submissionResponse.status === 204 ? {} : await submissionResponse.json();

    if (!submissionResponse.ok) {
      return res.status(400).json({
        error: submissionResult.message || 'HMRC submission failed',
        details: {
          hmrc: submissionResult,
          sent: {
            periodStartDate,
            periodEndDate,
            enteredTurnover,
            enteredExpenses,
            previousTurnover,
            previousExpenses,
            cumulativeTurnover: hmrcPayload.periodIncome.turnover,
            cumulativeExpenses: hmrcPayload.periodExpenses.consolidatedExpenses,
            businessId,
            businessType
          }
        }
      });
    }

  const { error: saveSubmissionError } = await supabase
    .from('hmrc_submissions')
    .insert([{
      driver_id: currentDriver.id,
      business_id: businessId,
      period_id: `${nextPendingPeriod.start}_${nextPendingPeriod.end}`,
      period_start: nextPendingPeriod.start,
      period_end: nextPendingPeriod.end,
      turnover: hmrcPayload.periodIncome.turnover,
      expenses: hmrcPayload.periodExpenses.consolidatedExpenses,
      hmrc_response: {
        ...submissionResult,
        quarterTurnover: enteredTurnover,
        quarterExpenses: enteredExpenses,
        hmrcPeriodStartDate: periodStartDate,
        hmrcPeriodEndDate: periodEndDate
      }
    }]);

  if (saveSubmissionError) {
    return res.status(500).json({
      error: `HMRC accepted the submission, but saving submission history failed: ${saveSubmissionError.message}`,
      details: submissionResult
    });
  }

  res.status(200).json({
    success: true,
    businessId,
    periodStartDate,
    periodEndDate,
    submittedTurnover: hmrcPayload.periodIncome.turnover,
    submittedExpenses: hmrcPayload.periodExpenses.consolidatedExpenses
  });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
