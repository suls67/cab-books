import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { getNextOpenPeriod, getQuarterLabel, sortPeriods } from '../lib/hmrcPeriods'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-obligations.module.css'

const isPeriodSubmitted = (period, submissionHistory) =>
  submissionHistory.some(
    (s) => s.period_start === period.start && s.period_end === period.end
  )

const isPeriodFulfilled = (period, submissionHistory) =>
  period.status === 'fulfilled' || isPeriodSubmitted(period, submissionHistory)

function getDueDateUrgency(dueDate) {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((due - today) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { type: 'overdue', daysLeft };
  if (daysLeft <= 30) return { type: 'approaching', daysLeft };
  return null;
}

export default function HmrcObligations() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [obligations, setObligations] = useState([])
  const [crystallisation, setCrystallisation] = useState(null)
  const [submissionHistory, setSubmissionHistory] = useState([])
  const [businessId, setBusinessId] = useState('')
  const [lastFetchedAt, setLastFetchedAt] = useState(null)
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(false)

  async function loadSubmissionHistory(driverId) {
    if (!driverId) return;
    const { data, error } = await supabase
      .from('hmrc_submissions')
      .select('period_id, period_start, period_end, turnover, expenses, submitted_at')
      .eq('driver_id', driverId)
      .order('submitted_at', { ascending: false })

    if (error) {
      setStatus({ type: 'error', text: `Could not load saved submission history: ${error.message}` })
      return
    }
    setSubmissionHistory(data || [])
  }

  async function loadObligations(accessToken, options = {}) {
    const { silent = false } = options
    if (!silent) setStatus({ type: '', text: '' })
    setIsLoading(true)

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before fetching obligations.' })
      setIsLoading(false)
      return
    }

    const response = await fetch('/api/hmrc/obligations', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    const data = await response.json()

    if (!response.ok) {
      setStatus({ type: 'error', text: data.error || 'Could not fetch obligations from HMRC.' })
      setObligations([])
      setBusinessId('')
      setIsLoading(false)
      return
    }

    setObligations(data.periods || [])
    setCrystallisation(data.crystallisation || null)
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
    async function loadPage() {
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
        if (text === 'No signed-in user was found') router.push('/login')
      }
    }
    loadPage()
  }, [router])

  async function handleFetchObligations() {
    const { data: sessionData } = await supabase.auth.getSession()
    await loadObligations(sessionData.session?.access_token)
  }

  const formatDate = (value) => {
    if (!value) return 'Not provided'
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
  }

  const formatDateTime = (value) => {
    if (!value) return 'Not provided'
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  }

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value || 0))

  const sortedPeriods = sortPeriods(obligations)
  const openPeriods = sortedPeriods.filter((p) => !isPeriodFulfilled(p, submissionHistory))
  const fulfilledPeriods = sortedPeriods.filter((p) => isPeriodFulfilled(p, submissionHistory))
  const nextDuePeriod = getNextOpenPeriod(openPeriods)
  const nextQuarterLabel = getQuarterLabel(nextDuePeriod, sortedPeriods)
  const submittedQuarters = Array.from(
    new Set(fulfilledPeriods.map((p) => getQuarterLabel(p, sortedPeriods)))
  )
  const totals = submissionHistory.reduce(
    (acc, s) => { acc.turnover += Number(s.turnover || 0); acc.expenses += Number(s.expenses || 0); return acc },
    { turnover: 0, expenses: 0 }
  )
  const latestSubmittedPeriod = fulfilledPeriods[fulfilledPeriods.length - 1] || null
  const earliestSubmittedPeriod = fulfilledPeriods[0] || null

  // Nudge: find the most urgent open period
  const urgentPeriod = openPeriods
    .map((p) => ({ period: p, urgency: getDueDateUrgency(p.due) }))
    .filter((x) => x.urgency !== null)
    .sort((a, b) => a.urgency.daysLeft - b.urgency.daysLeft)[0] || null

  const crystallisationUrgency = crystallisation && crystallisation.status !== 'fulfilled'
    ? getDueDateUrgency(crystallisation.due)
    : null

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

          {/* Overdue / approaching nudge */}
          {urgentPeriod && (
            <div className={urgentPeriod.urgency.type === 'overdue' ? styles.nudgeOverdue : styles.nudgeApproaching}>
              {urgentPeriod.urgency.type === 'overdue' ? (
                <>
                  <strong>Overdue update</strong>
                  <p>
                    {getQuarterLabel(urgentPeriod.period, sortedPeriods)} was due on{' '}
                    {formatDate(urgentPeriod.period.due)} —{' '}
                    {Math.abs(urgentPeriod.urgency.daysLeft)} day{Math.abs(urgentPeriod.urgency.daysLeft) !== 1 ? 's' : ''} overdue.{' '}
                    <Link href="/hmrc-submit">Submit now</Link>
                  </p>
                </>
              ) : (
                <>
                  <strong>Update due soon</strong>
                  <p>
                    {getQuarterLabel(urgentPeriod.period, sortedPeriods)} is due on{' '}
                    {formatDate(urgentPeriod.period.due)} —{' '}
                    {urgentPeriod.urgency.daysLeft} day{urgentPeriod.urgency.daysLeft !== 1 ? 's' : ''} left.{' '}
                    <Link href="/hmrc-submit">Submit now</Link>
                  </p>
                </>
              )}
            </div>
          )}

          {crystallisationUrgency && (
            <div className={crystallisationUrgency.type === 'overdue' ? styles.nudgeOverdue : styles.nudgeApproaching}>
              {crystallisationUrgency.type === 'overdue' ? (
                <>
                  <strong>Final declaration overdue</strong>
                  <p>
                    Your final declaration was due on {formatDate(crystallisation.due)} —{' '}
                    {Math.abs(crystallisationUrgency.daysLeft)} day{Math.abs(crystallisationUrgency.daysLeft) !== 1 ? 's' : ''} overdue.{' '}
                    <Link href="/hmrc-final">Submit now</Link>
                  </p>
                </>
              ) : (
                <>
                  <strong>Final declaration due soon</strong>
                  <p>
                    Your final declaration is due on {formatDate(crystallisation.due)} —{' '}
                    {crystallisationUrgency.daysLeft} day{crystallisationUrgency.daysLeft !== 1 ? 's' : ''} left.{' '}
                    <Link href="/hmrc-final">Submit now</Link>
                  </p>
                </>
              )}
            </div>
          )}

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
                <strong>{nextDuePeriod ? formatDate(nextDuePeriod.due) : 'All up to date'}</strong>
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
                      cumulative — figures should cover everything from the start of the tax year up
                      to the end of that quarter.
                    </p>
                  </div>

                  <div className={styles.obligationList}>
                    {openPeriods.map((period, index) => {
                      const urgency = getDueDateUrgency(period.due)
                      return (
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
                            <strong className={urgency?.type === 'overdue' ? styles.overdueStatus : styles.openStatus}>
                              {urgency?.type === 'overdue'
                                ? `Overdue (${Math.abs(urgency.daysLeft)}d)`
                                : urgency?.type === 'approaching'
                                ? `Due in ${urgency.daysLeft}d`
                                : isPeriodFulfilled(period, submissionHistory)
                                ? 'Fulfilled'
                                : 'Open'}
                            </strong>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {fulfilledPeriods.length > 0 && (
                <div className={styles.periodSection}>
                  <div className={styles.subHeader}>
                    <p className={styles.sectionEyebrow}>Fulfilled</p>
                    <h3>Completed periods</h3>
                  </div>
                  <div className={styles.obligationList}>
                    {fulfilledPeriods.map((period, index) => (
                      <div key={`fulfilled-${period.start}-${period.end}-${index}`} className={`${styles.obligationCard} ${styles.obligationCardFulfilled}`}>
                        <div>
                          <span className={styles.label}>Update period</span>
                          <strong>{getQuarterLabel(period, sortedPeriods)}</strong>
                        </div>
                        <div>
                          <span className={styles.label}>Period</span>
                          <strong>{formatDate(period.start)} — {formatDate(period.end)}</strong>
                        </div>
                        <div>
                          <span className={styles.label}>Status</span>
                          <strong className={styles.fulfilledStatus}>Fulfilled</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Final declaration obligation */}
              {crystallisation && (
                <div className={styles.periodSection}>
                  <div className={styles.subHeader}>
                    <p className={styles.sectionEyebrow}>Final declaration</p>
                    <h3>Year-end declaration deadline</h3>
                    <p className={styles.sectionText}>
                      The final declaration (crystallisation) confirms your total income and tax
                      liability for the year. Due on 31 January following the tax year end.
                    </p>
                  </div>

                  <div className={styles.crystallisationCard}>
                    <div>
                      <span className={styles.label}>Tax year covers</span>
                      <strong>{formatDate(crystallisation.start)} — {formatDate(crystallisation.end)}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Due date</span>
                      <strong>{formatDate(crystallisation.due)}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Status</span>
                      <strong className={crystallisation.status === 'fulfilled' ? styles.fulfilledStatus : styles.openStatus}>
                        {crystallisation.status === 'fulfilled' ? 'Fulfilled' : 'Open'}
                      </strong>
                    </div>
                    {crystallisation.status !== 'fulfilled' && (
                      <div>
                        <Link href="/hmrc-final" className={styles.inlineLink}>
                          Go to final declaration
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.periodSection}>
                <div className={styles.subHeader}>
                  <p className={styles.sectionEyebrow}>Submitted</p>
                  <h3>Submission history</h3>
                  <p className={styles.sectionText}>
                    Based on quarterly submissions saved in your app database.
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
                          ? ` (${formatDate(earliestSubmittedPeriod?.start)} to ${getQuarterLabel({ start: latestSubmittedPeriod.start, end: latestSubmittedPeriod.end }, sortedPeriods)})`
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
