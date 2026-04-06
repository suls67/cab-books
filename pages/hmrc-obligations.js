import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { getNextOpenPeriod, getQuarterLabel, sortPeriods } from '../lib/hmrcPeriods'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-obligations.module.css'

const isPeriodSubmitted = (period, submissionHistory) =>
  submissionHistory.some(
    (submission) =>
      submission.period_start === period.start && submission.period_end === period.end
  )

const isPeriodFulfilled = (period, submissionHistory) =>
  period.status === 'fulfilled' || isPeriodSubmitted(period, submissionHistory)

export default function HmrcObligations() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [obligations, setObligations] = useState([])
  const [submissionHistory, setSubmissionHistory] = useState([])
  const [businessId, setBusinessId] = useState('')
  const [lastFetchedAt, setLastFetchedAt] = useState(null)
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(false)

  async function loadSubmissionHistory(driverId) {
    if (!driverId) {
      setSubmissionHistory([])
      return
    }

    const { data, error } = await supabase
      .from('hmrc_submissions')
      .select('period_id, period_start, period_end, turnover, expenses, submitted_at')
      .eq('driver_id', driverId)
      .order('submitted_at', { ascending: false })

    if (error) {
      setStatus({
        type: 'error',
        text: `Could not load saved submission history: ${error.message}`
      })
      return
    }

    setSubmissionHistory(data || [])
  }

  async function loadObligations(accessToken, options = {}) {
    const { silent = false } = options

    if (!silent) {
      setStatus({ type: '', text: '' })
    }

    setIsLoading(true)

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before fetching obligations.' })
      setIsLoading(false)
      return
    }

    const response = await fetch('/api/hmrc/obligations', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not fetch obligations from HMRC.'
      })
      setObligations([])
      setBusinessId('')
      setIsLoading(false)
      return
    }

    setObligations(data.periods || [])
    setBusinessId(data.businessId || '')
    setLastFetchedAt(new Date().toISOString())
    setStatus({
      type: 'success',
      text: data.periods?.length
        ? 'Obligations loaded from HMRC.'
        : 'HMRC returned no obligations for this driver.'
    })
    setIsLoading(false)
  }

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
        await loadSubmissionHistory(currentDriver.id)

        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token

        if (currentDriver.nino) {
          await loadObligations(accessToken, { silent: true })
        }
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

  async function handleFetchObligations() {
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    await loadObligations(accessToken)
  }

  const formatDate = (value) => {
    if (!value) return 'Not provided'

    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value))
  }

  const formatDateTime = (value) => {
    if (!value) return 'Not provided'

    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  }

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(Number(value || 0))

  const sortedPeriods = sortPeriods(obligations)
  const openPeriods = sortedPeriods.filter(
    (period) => !isPeriodFulfilled(period, submissionHistory)
  )
  const fulfilledPeriods = sortedPeriods.filter(
    (period) => isPeriodFulfilled(period, submissionHistory)
  )
  const nextDuePeriod = getNextOpenPeriod(openPeriods)
  const nextQuarterLabel = getQuarterLabel(nextDuePeriod, sortedPeriods)
  const submittedQuarters = Array.from(
    new Set(
      fulfilledPeriods.map((period) =>
        getQuarterLabel(period, sortedPeriods)
      )
    )
  )
  const totals = submissionHistory.reduce(
    (accumulator, submission) => {
      accumulator.turnover += Number(submission.turnover || 0)
      accumulator.expenses += Number(submission.expenses || 0)
      return accumulator
    },
    { turnover: 0, expenses: 0 }
  )
  const latestSubmittedPeriod = fulfilledPeriods[fulfilledPeriods.length - 1] || null
  const earliestSubmittedPeriod = fulfilledPeriods[0] || null

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC obligations</p>
            <h1>Reporting obligations</h1>
            <p className={styles.subtitle}>
              Use the saved HMRC token to load the current filing periods and identify the next
              cumulative quarterly update for this driver.
            </p>
          </div>

          <div className={styles.headerActions}>
            <Link href="/hmrc-businesses" className={styles.backLink}>
              Back to businesses
            </Link>

            <Link href="/hmrc" className={styles.headerSecondaryLink}>
              Back to HMRC
            </Link>
          </div>
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

            <div>
              <span className={styles.label}>Business ID</span>
              <strong>{businessId || 'Not loaded yet'}</strong>
            </div>
          </div>

          {obligations.length > 0 && (
            <div className={styles.statusGrid}>
              <div className={styles.statusCard}>
                <span className={styles.label}>Open periods</span>
                <strong>{openPeriods.length}</strong>
              </div>

              <div className={styles.statusCard}>
                <span className={styles.label}>Fulfilled periods</span>
                <strong>{fulfilledPeriods.length}</strong>
              </div>

              <div className={styles.statusCard}>
                <span className={styles.label}>Next due</span>
                <strong>{nextDuePeriod ? formatDate(nextDuePeriod.due) : 'No open due date'}</strong>
              </div>

              <div className={styles.statusCard}>
                <span className={styles.label}>Last refreshed</span>
                <strong>{lastFetchedAt ? formatDateTime(lastFetchedAt) : 'Not fetched yet'}</strong>
              </div>
            </div>
          )}

          {status.text && (
            <div className={status.type === 'error' ? styles.error : styles.success}>
              {status.text}
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleFetchObligations}
              disabled={isLoading || !driver?.nino}
            >
              {isLoading ? 'Fetching obligations...' : 'Fetch obligations'}
            </button>

            <Link href="/hmrc-businesses" className={styles.secondaryBtn}>
              Back
            </Link>
          </div>

          {obligations.length > 0 && (
            <div className={styles.results}>
              <div className={styles.resultsHeader}>
                <p className={styles.sectionEyebrow}>Results</p>
                <h2>Current HMRC state</h2>
              </div>

              {openPeriods.length > 0 && (
                <div className={styles.periodSection}>
                  <div className={styles.subHeader}>
                    <p className={styles.sectionEyebrow}>Open</p>
                    <h3>Ready to submit</h3>
                    <p className={styles.sectionText}>
                      The next open update is {nextQuarterLabel}. HMRC quarterly updates are
                      cumulative, so the figures should cover everything from the start of the tax
                      year up to the end of that quarter.
                    </p>
                  </div>

                  <div className={styles.obligationList}>
                    {openPeriods.map((period, index) => (
                      <div key={`${period.start}-${period.end}-${index}`} className={styles.obligationCard}>
                        <div>
                          <span className={styles.label}>Update period</span>
                          <strong>{getQuarterLabel(period, sortedPeriods)}</strong>
                        </div>

                        <div>
                          <span className={styles.label}>Period start</span>
                          <strong>{formatDate(period.start)}</strong>
                        </div>

                        <div>
                          <span className={styles.label}>Period end</span>
                          <strong>{formatDate(period.end)}</strong>
                        </div>

                        <div>
                          <span className={styles.label}>Due date</span>
                          <strong>{formatDate(period.due)}</strong>
                        </div>

                        <div>
                          <span className={styles.label}>Status</span>
                          <strong className={styles.openStatus}>
                            {isPeriodFulfilled(period, submissionHistory)
                              ? 'fulfilled'
                              : period.status || 'Unknown'}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.periodSection}>
                <div className={styles.subHeader}>
                  <p className={styles.sectionEyebrow}>Submitted</p>
                  <h3>Submitted quarters</h3>
                  <p className={styles.sectionText}>
                    This summary is based on the quarterly submissions saved in your app database.
                  </p>
                </div>

                {submissionHistory.length > 0 ? (
                  <div className={styles.submissionSummary}>
                    <div className={styles.submissionListCard}>
                      <span className={styles.label}>Submitted quarters</span>
                      <div className={styles.quarterList}>
                        {submittedQuarters.map((quarter) => (
                          <p key={quarter}>{quarter}</p>
                        ))}
                      </div>
                    </div>

                    <div className={styles.submissionTotalCard}>
                      <span className={styles.label}>
                        Submitted so far
                        {latestSubmittedPeriod
                          ? ` (${formatDate(earliestSubmittedPeriod?.start)} to ${getQuarterLabel(
                              {
                                start: latestSubmittedPeriod.start,
                                end: latestSubmittedPeriod.end
                              },
                              sortedPeriods
                            )})`
                          : ''}
                      </span>
                      <div className={styles.totalBlock}>
                        <span className={styles.totalLabel}>Turnover</span>
                        <strong>{formatCurrency(totals.turnover)}</strong>
                      </div>

                      <div className={styles.totalBlock}>
                        <span className={styles.totalLabel}>Expenses</span>
                        <strong className={styles.totalExpense}>{formatCurrency(totals.expenses)}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    No saved submission history was found in Supabase for this driver yet.
                  </div>
                )}
              </div>

              <div className={styles.nextStep}>
                <p className={styles.nextStepText}>
                  When you&apos;re ready, move on to submitting cumulative turnover and expenses for
                  {nextDuePeriod ? ` ${nextQuarterLabel}` : ' the next open period'}.
                </p>
                <Link href="/hmrc-submit" className={styles.nextStepLink}>
                  Submit figures
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
