import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { getPeriodKey, getQuarterLabel, sortPeriods } from '../lib/hmrcPeriods'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-submit.module.css'

const isPeriodSubmitted = (period, submissionHistory) =>
  submissionHistory.some(
    (submission) =>
      submission.period_start === period.start && submission.period_end === period.end
  )

const isPeriodFulfilled = (period, submissionHistory) =>
  period.status === 'fulfilled' || isPeriodSubmitted(period, submissionHistory)

export default function HmrcSubmit() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [allPeriods, setAllPeriods] = useState([])
  const [openPeriod, setOpenPeriod] = useState(null)
  const [previousSubmission, setPreviousSubmission] = useState(null)
  const [existingSubmission, setExistingSubmission] = useState(null)
  const [turnover, setTurnover] = useState('')
  const [expenses, setExpenses] = useState('')
  const [status, setStatus] = useState({ type: '', text: '' })
  const [result, setResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function loadSubmissionState(currentDriver) {
    const { data: savedSubmissions, error: savedSubmissionsError } = await supabase
      .from('hmrc_submissions')
      .select('period_id, submitted_at, period_start, period_end, turnover, expenses')
      .eq('driver_id', currentDriver.id)
      .order('submitted_at', { ascending: false })

    if (savedSubmissionsError) {
      setStatus({
        type: 'error',
        text: `Could not load saved submission history: ${savedSubmissionsError.message}`
      })
      return
    }

    const history = savedSubmissions || []

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before loading HMRC periods.' })
      return
    }

    const obligationsResponse = await fetch('/api/hmrc/obligations', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const obligationsData = await obligationsResponse.json()

    if (!obligationsResponse.ok) {
      setStatus({
        type: 'error',
        text: obligationsData.error || 'Could not load the current HMRC obligation period.'
      })
      return
    }

    const periods = obligationsData.periods || []
    const sortedPeriods = sortPeriods(periods)
    const nextOpenPeriod =
      sortedPeriods.find((period) => !isPeriodFulfilled(period, history)) || null

    setAllPeriods(periods)
    setOpenPeriod(nextOpenPeriod || null)

    if (nextOpenPeriod) {
      const currentSubmission =
        history.find(
          (submission) =>
            submission.period_start === nextOpenPeriod.start &&
            submission.period_end === nextOpenPeriod.end
        ) || null

      setExistingSubmission(currentSubmission)

      const nextPeriodIndex = sortedPeriods.findIndex(
        (period) => getPeriodKey(period) === getPeriodKey(nextOpenPeriod)
      )

      const previousFulfilledPeriods = sortedPeriods
        .slice(0, nextPeriodIndex)
        .filter((period) => isPeriodFulfilled(period, history))

      const latestPreviousPeriod =
        previousFulfilledPeriods[previousFulfilledPeriods.length - 1] || null

      const latestPreviousSubmission =
        latestPreviousPeriod
          ? history.find(
              (submission) =>
                submission.period_start === latestPreviousPeriod.start &&
                submission.period_end === latestPreviousPeriod.end
            ) || null
          : null

      setPreviousSubmission(latestPreviousSubmission)
      return
    }

    setExistingSubmission(null)
    setPreviousSubmission(history[0] || null)
  }

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
        await loadSubmissionState(currentDriver)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Could not load your driver profile.'
        setStatus({ type: 'error', text })

        if (text === 'No signed-in user was found') {
          router.push('/login')
        }
      }
    }

    loadDriver()
  }, [router])

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus({ type: '', text: '' })
    setResult(null)

    if (!turnover.trim() || !expenses.trim()) {
      setStatus({ type: 'error', text: 'Enter turnover and expenses before submitting.' })
      return
    }

    setIsSubmitting(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before submitting to HMRC.' })
      setIsSubmitting(false)
      return
    }

    const response = await fetch('/api/hmrc/submitIncome', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        turnover,
        expenses
      })
    })

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'HMRC submission failed.'
      })
      setResult(data.details || null)
      setIsSubmitting(false)
      return
    }

    setStatus({
      type: 'success',
      text: 'Quarterly submission sent to HMRC successfully.'
    })
    setResult(data)
    setTurnover('')
    setExpenses('')
    await loadSubmissionState(driver)
    setIsSubmitting(false)
  }

  const formatDate = (value) => {
    if (!value) return 'Not provided'

    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value))
  }

  const sortedPeriods = sortPeriods(allPeriods)
  const quarterLabel = getQuarterLabel(openPeriod, sortedPeriods)
  const enteredTurnover = Number(turnover) || 0
  const enteredExpenses = Number(expenses) || 0
  const previousTurnover = Number(previousSubmission?.turnover || 0)
  const previousExpenses = Number(previousSubmission?.expenses || 0)
  const reviewTurnover = previousTurnover + enteredTurnover
  const reviewExpenses = previousExpenses + enteredExpenses
  const formatMoney = (value) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  const submittedQuarterLabel =
    result?.periodStartDate && result?.periodEndDate
      ? getQuarterLabel(
          {
            start: result.periodStartDate,
            end: result.periodEndDate
          },
          sortedPeriods
        )
      : quarterLabel

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC submission</p>
            <h1>Submit your figures</h1>
            <p className={styles.subtitle}>
              Enter this quarter&apos;s turnover and expenses. We&apos;ll prepare the year-to-date
              totals for the next open HMRC update automatically.
            </p>
          </div>

          <Link href="/hmrc" className={styles.backLink}>
            Back to HMRC
          </Link>
        </div>

        <div className={styles.card}>
          <div className={styles.summary}>
            <div>
              <span className={styles.label}>Driver</span>
              <strong>{driver?.name || 'Loading...'}</strong>
            </div>

            <div>
              <span className={styles.label}>NINO</span>
              <strong>{driver?.nino || 'Missing'}</strong>
            </div>
          </div>

          <div className={styles.periodCard}>
            <p className={styles.sectionEyebrow}>Submission period</p>
            {openPeriod ? (
              <>
                <div className={styles.periodIntro}>
                  <span className={styles.periodBadge}>{quarterLabel}</span>
                  <p className={styles.periodDescription}>
                    You only need to enter {quarterLabel}&apos;s figures. We&apos;ll add them to your
                    previous submitted totals before anything is sent to HM Revenue and Customs.
                  </p>
                </div>

                <div className={styles.periodGrid}>
                  <div>
                    <span className={styles.label}>Update period</span>
                    <strong>{quarterLabel}</strong>
                  </div>

                  <div>
                    <span className={styles.label}>Period start</span>
                    <strong>{formatDate(openPeriod.start)}</strong>
                  </div>

                  <div>
                    <span className={styles.label}>Period end</span>
                    <strong>{formatDate(openPeriod.end)}</strong>
                  </div>

                  <div>
                    <span className={styles.label}>Due date</span>
                    <strong>{formatDate(openPeriod.due)}</strong>
                  </div>

                  <div>
                    <span className={styles.label}>Status</span>
                    <strong>{openPeriod.status}</strong>
                  </div>
                </div>

                {existingSubmission && (
                  <div className={styles.duplicateNotice}>
                    {quarterLabel} already submitted.
                  </div>
                )}
              </>
            ) : (
              <p className={styles.periodFallback}>
                No open HMRC period is currently available for submission.
              </p>
            )}
          </div>

          {status.text && (
            <div className={status.type === 'error' ? styles.error : styles.success}>
              {status.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="turnover">Enter turnover</label>
              <input
                id="turnover"
                type="number"
                step="0.01"
                value={turnover}
                onChange={(event) => setTurnover(event.target.value)}
                placeholder="Enter turnover"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="expenses">Enter expenses</label>
              <input
                id="expenses"
                type="number"
                step="0.01"
                value={expenses}
                onChange={(event) => setExpenses(event.target.value)}
                placeholder="Enter expenses"
              />
            </div>

            {openPeriod && !existingSubmission && (
              <div className={styles.reviewCard}>
                <div className={styles.reviewHeader}>
                  <p className={styles.sectionEyebrow}>Review</p>
                  <h2>Year-to-date totals</h2>
                  <p className={styles.reviewText}>
                    Check the figures below before submitting {quarterLabel} to HM Revenue and
                    Customs.
                  </p>
                </div>

                <div className={styles.reviewGrid}>
                  <div className={styles.reviewStat}>
                    <span className={styles.label}>Submitted income so far</span>
                    <strong>{formatMoney(previousTurnover)}</strong>
                  </div>

                  <div className={`${styles.reviewStat} ${styles.reviewTotal}`}>
                    <span className={styles.label}>Total income to submit</span>
                    <strong>{formatMoney(reviewTurnover)}</strong>
                  </div>
                </div>

                <div className={styles.expenseGrid}>
                  <div className={styles.reviewStat}>
                    <span className={styles.label}>Submitted expenses so far</span>
                    <strong>{formatMoney(previousExpenses)}</strong>
                  </div>

                  <div className={`${styles.reviewStat} ${styles.reviewTotal}`}>
                    <span className={styles.label}>Total expense to submit</span>
                    <strong>{formatMoney(reviewExpenses)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={isSubmitting || !driver?.nino || !openPeriod || !!existingSubmission}
              >
                {isSubmitting ? 'Submitting...' : 'Submit to HMRC'}
              </button>

              <Link href="/hmrc" className={styles.secondaryBtn}>
                Cancel
              </Link>
            </div>
          </form>

          {result && (
            <div className={styles.resultPanel}>
              <p className={styles.sectionEyebrow}>Confirmation</p>

              {status.type === 'success' ? (
                <div className={styles.confirmationCard}>
                  <h2>Submission received by HMRC</h2>
                  <div className={styles.confirmationGrid}>
                    <div>
                      <span className={styles.label}>Submitted update</span>
                      <strong>{submittedQuarterLabel}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>Period</span>
                      <strong>
                        {formatDate(result.periodStartDate)} to {formatDate(result.periodEndDate)}
                      </strong>
                    </div>

                    <div>
                      <span className={styles.label}>Total income submitted</span>
                      <strong>{formatMoney(result.submittedTurnover)}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>Total expense submitted</span>
                      <strong>{formatMoney(result.submittedExpenses)}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <pre>{JSON.stringify(result, null, 2)}</pre>
              )}

              {status.type === 'success' && (
                <div className={styles.resultActions}>
                  <Link href="/dashboard" className={styles.resultLinkPrimary}>
                    Back to dashboard
                  </Link>

                  <Link href="/hmrc-obligations" className={styles.resultLinkSecondary}>
                    View obligations
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
