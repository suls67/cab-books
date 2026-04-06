import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getNextOpenPeriod } from '../../../lib/hmrcPeriods';
import { supabase } from '../../../supabaseClient';
import { refreshToken } from '../../../lib/hmrc/refreshToken';

const HMRC_MAX_VALUE = 99999999999.99;

const isPeriodSubmitted = (period, submissionHistory) =>
  submissionHistory.some(
    (submission) =>
      submission.period_start === period.start && submission.period_end === period.end
  );

const isPeriodFulfilled = (period, submissionHistory) =>
  period.status === 'fulfilled' || isPeriodSubmitted(period, submissionHistory);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    req.method = 'POST';
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, accessToken);
    const { turnover, expenses } = req.body;

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
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const businessData = await businessResponse.json();
    const businessId = businessData.listOfBusinesses[0].businessId;

    // get obligations
    const obligationsResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/obligations/details/${driver.nino}/income-and-expenditure?typeOfBusiness=self-employment&businessId=${businessId}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.3.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
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

    const { data: existingSubmissions, error: existingSubmissionError } = await supabase
      .from('hmrc_submissions')
      .select('id, submitted_at, period_id, period_start, period_end')
      .eq('driver_id', currentDriver.id)
      .order('submitted_at', { ascending: false });

    if (existingSubmissionError) {
      throw new Error(`Could not verify existing HMRC submissions: ${existingSubmissionError.message}`);
    }

    const submissionHistory = existingSubmissions || [];
    const nextPendingPeriod =
      getNextOpenPeriod(periods.filter((period) => !isPeriodFulfilled(period, submissionHistory))) ||
      null;

    if (!nextPendingPeriod) {
      throw new Error('No open obligations found (all already submitted)');
    }

    const periodStartDate = nextPendingPeriod.start;
    const periodEndDate = nextPendingPeriod.end;

    const existingSubmission =
      submissionHistory.find(
        (submission) =>
          submission.period_start === periodStartDate && submission.period_end === periodEndDate
      ) || null;

    if (existingSubmission) {
      return res.status(409).json({
        error: 'This obligation period has already been submitted. Any further change must go through an adjustment flow.',
        details: existingSubmission
      });
    }

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

    const { data: previousSubmissions, error: previousSubmissionError } = await supabase
      .from('hmrc_submissions')
      .select('turnover, expenses, period_start, period_end')
      .eq('driver_id', currentDriver.id)
      .lt('period_end', periodStartDate)
      .order('period_end', { ascending: false })
      .limit(1);

    if (previousSubmissionError) {
      throw new Error(`Could not load previous quarterly totals: ${previousSubmissionError.message}`);
    }

    const previousSubmission = previousSubmissions?.[0] || null;
    const previousTurnover = Number(previousSubmission?.turnover || 0);
    const previousExpenses = Number(previousSubmission?.expenses || 0);

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
      `https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/${driver.nino}/${businessId}/period`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.5.0+json',
          'Content-Type': 'application/json',
          'Gov-Test-Scenario': 'DEFAULT'
        },
        body: JSON.stringify(hmrcPayload)
      }
    );

    const submissionResult = await submissionResponse.json();

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
            cumulativeExpenses: hmrcPayload.periodExpenses.consolidatedExpenses
          }
        }
      });
    }

  const { error: saveSubmissionError } = await supabase
    .from('hmrc_submissions')
    .insert([{
      driver_id: currentDriver.id,
      business_id: businessId,
      period_id: submissionResult.periodId,
      period_start: periodStartDate,
      period_end: periodEndDate,
      turnover: hmrcPayload.periodIncome.turnover,
      expenses: hmrcPayload.periodExpenses.consolidatedExpenses,
      hmrc_response: {
        ...submissionResult,
        quarterTurnover: enteredTurnover,
        quarterExpenses: enteredExpenses
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
    periodId: submissionResult.periodId,
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
