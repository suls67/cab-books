import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc.module.css'

export default function HmrcHome() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [hmrcToken, setHmrcToken] = useState(null)
  const [businesses, setBusinesses] = useState([])
  const [obligations, setObligations] = useState([])
  const [submissionHistory, setSubmissionHistory] = useState([])
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadHmrcHome() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)

        const { data: tokenData, error: tokenError } = await supabase
          .from('hmrc_tokens')
          .select('created_at, expires_at')
          .eq('driver_id', currentDriver.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (tokenError) {
          setStatus({
            type: 'error',
            text: `Could not load HMRC connection status: ${tokenError.message}`
          })
        } else {
          setHmrcToken(tokenData || null)
        }

        const { data: savedSubmissions, error: submissionsError } = await supabase
          .from('hmrc_submissions')
          .select('period_id, period_start, period_end, submitted_at')
          .eq('driver_id', currentDriver.id)
          .order('submitted_at', { ascending: false })

        if (submissionsError) {
          setStatus({
            type: 'error',
            text: `Could not load saved submission history: ${submissionsError.message}`
          })
        } else {
          setSubmissionHistory(savedSubmissions || [])
        }

        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token

        if (accessToken && currentDriver.nino && tokenData) {
          const [businessesResponse, obligationsResponse] = await Promise.all([
            fetch('/api/hmrc/listBusinesses', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }),
            fetch('/api/hmrc/obligations', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            })
          ])

          const businessesData = await businessesResponse.json()
          const obligationsData = await obligationsResponse.json()

          if (businessesResponse.ok) {
            setBusinesses(businessesData.listOfBusinesses || [])
          }

          if (obligationsResponse.ok) {
            setObligations(obligationsData.periods || [])
          }

          if (!businessesResponse.ok || !obligationsResponse.ok) {
            setStatus({
              type: 'error',
              text:
                businessesData.error ||
                obligationsData.error ||
                'HMRC is connected, but some HMRC details could not be loaded right now.'
            })
          }
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Could not load your HMRC workspace.'
        setStatus({ type: 'error', text })

        if (text === 'No signed-in user was found') {
          router.push('/login')
        }
      } finally {
        setIsLoading(false)
      }
    }

    loadHmrcHome()
  }, [router])

  const formatDateTime = (value) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))

  const openPeriods = obligations.filter((period) => period.status === 'open')
  const fulfilledPeriods = obligations.filter((period) => period.status === 'fulfilled')
  const latestSubmission = submissionHistory[0]

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC workspace</p>
            <h1>HMRC tasks in one place</h1>
            <p className={styles.subtitle}>
              Manage your HMRC connection, check business details, review obligations, and keep an
              eye on what your app has already submitted.
            </p>
          </div>

          <Link href="/dashboard" className={styles.backLink}>
            Return to dashboard
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

            <div>
              <span className={styles.label}>HMRC status</span>
              <strong>{hmrcToken ? 'Connected' : isLoading ? 'Loading...' : 'Not connected'}</strong>
            </div>
          </div>

          {status.text && (
            <div className={status.type === 'error' ? styles.error : styles.success}>
              {status.text}
            </div>
          )}

          {!driver?.nino && (
            <div className={styles.warning}>
              Add your NINO before moving further into HMRC tasks.
            </div>
          )}

          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.label}>Businesses found</span>
              <strong>{businesses.length}</strong>
              <p>{hmrcToken ? 'Loaded from HMRC using the saved token.' : 'Connect HMRC to load this.'}</p>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.label}>Open obligations</span>
              <strong>{openPeriods.length}</strong>
              <p>Quarterly updates still waiting to be filed.</p>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.label}>Fulfilled obligations</span>
              <strong>{fulfilledPeriods.length}</strong>
              <p>Periods HMRC already marks as submitted.</p>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.label}>Saved submissions</span>
              <strong>{submissionHistory.length}</strong>
              <p>{latestSubmission ? `Last saved ${formatDateTime(latestSubmission.submitted_at)}` : 'No local submission history yet.'}</p>
            </div>
          </div>

          <div className={styles.taskGrid}>
            <div className={styles.taskCard}>
              <p className={styles.sectionEyebrow}>Step 1</p>
              <h2>Connect to HMRC</h2>
              <p>
                Start or review your HMRC authorisation and check token dates for this driver.
              </p>
              <Link href="/connect-hmrc" className={styles.taskLink}>
                Open connection
              </Link>
            </div>

            <div className={styles.taskCard}>
              <p className={styles.sectionEyebrow}>Step 2</p>
              <h2>Business details</h2>
              <p>
                View the HMRC business records linked to this driver and confirm the business ID.
              </p>
              <Link href="/hmrc-businesses" className={styles.taskLink}>
                View businesses
              </Link>
            </div>

            <div className={styles.taskCard}>
              <p className={styles.sectionEyebrow}>Step 3</p>
              <h2>Obligations</h2>
              <p>
                Review open and fulfilled quarterly updates and compare them with your app history.
              </p>
              <Link href="/hmrc-obligations" className={styles.taskLink}>
                View obligations
              </Link>
            </div>

            <div className={styles.taskCard}>
              <p className={styles.sectionEyebrow}>Step 4</p>
              <h2>Submit next update</h2>
              <p>
                Enter this quarter&apos;s figures and let the app prepare the year-to-date totals for
                HMRC.
              </p>
              <Link href="/hmrc-submit" className={styles.taskLink}>
                Submit figures
              </Link>
            </div>

            <div className={styles.taskCard}>
              <p className={styles.sectionEyebrow}>Step 5</p>
              <h2>Tax calculations</h2>
              <p>
                Trigger an HMRC calculation, review any validation errors, and inspect the latest
                tax result for this year.
              </p>
              <Link href="/hmrc-calculations" className={styles.taskLink}>
                Open calculations
              </Link>
            </div>
          </div>

          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <div>
                <p className={styles.sectionEyebrow}>Summary</p>
                <h2>Latest saved submissions</h2>
              </div>

              <Link href="/hmrc-obligations" className={styles.secondaryLink}>
                Open full obligations view
              </Link>
            </div>

            {submissionHistory.length > 0 ? (
              <div className={styles.historyList}>
                {submissionHistory.slice(0, 3).map((submission) => (
                  <div
                    key={`${submission.period_id || submission.submitted_at}`}
                    className={styles.historyCard}
                  >
                    <span className={styles.label}>Submitted period</span>
                    <strong>{submission.period_start} to {submission.period_end}</strong>
                    <p>{formatDateTime(submission.submitted_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                No saved HMRC submission rows have been recorded in the app for this driver yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
