import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/connect-hmrc.module.css'

export default function ConnectHmrc() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [hmrcToken, setHmrcToken] = useState(null)
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)

        const { data: latestToken, error: tokenError } = await supabase
          .from('hmrc_tokens')
          .select('created_at, expires_at')
          .eq('driver_id', currentDriver.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (tokenError) {
          setStatus({
            type: 'error',
            text: `Could not load HMRC status: ${tokenError.message}`
          })
          return
        }

        setHmrcToken(latestToken || null)
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

  const callbackStatus =
    router.isReady && router.query.status === 'success'
      ? {
          type: 'success',
          text: 'HMRC connected successfully. You can now move on to businesses, obligations, or calculations.'
        }
      : router.isReady && router.query.status === 'error'
        ? {
            type: 'error',
            text: typeof router.query.message === 'string' ? router.query.message : 'HMRC connection failed.'
          }
        : null

  async function handleConnect() {
    setStatus({ type: '', text: '' })
    setIsLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before connecting HMRC.' })
      setIsLoading(false)
      return
    }

    const response = await fetch('/api/hmrc/oauth', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = await response.json()

    if (!response.ok || !data.authUrl) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not start the HMRC connection flow.'
      })
      setIsLoading(false)
      return
    }

    window.location.href = data.authUrl
  }

  const formatDate = (value) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC connection</p>
            <h1>Connect your HMRC account</h1>
            <p className={styles.subtitle}>
              Authorise CabBooks to retrieve business details and support your MTD workflow.
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
              <span className={styles.label}>Email</span>
              <strong>{driver?.email || 'Loading...'}</strong>
            </div>

            <div>
              <span className={styles.label}>NINO</span>
              <strong>{driver?.nino || 'Missing'}</strong>
            </div>
          </div>

          <div className={styles.statusPanel}>
            <div>
              <span className={styles.label}>HMRC status</span>
              <strong>{hmrcToken ? 'Connected' : 'Not connected'}</strong>
            </div>

            <div>
              <span className={styles.label}>Last token saved</span>
              <strong>{hmrcToken?.created_at ? formatDate(hmrcToken.created_at) : 'No token yet'}</strong>
            </div>

            <div>
              <span className={styles.label}>Token expiry</span>
              <strong>{hmrcToken?.expires_at ? formatDate(hmrcToken.expires_at) : 'Unknown'}</strong>
            </div>
          </div>

          {!driver?.nino && (
            <div className={styles.warning}>
              Add your NINO in your profile before connecting HMRC so the driver record is complete.
            </div>
          )}

          {(callbackStatus?.text || status.text) && (
            <div
              className={(callbackStatus?.type || status.type) === 'error' ? styles.error : styles.success}
            >
              {callbackStatus?.text || status.text}
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleConnect}
              disabled={isLoading || !driver?.nino}
            >
              {isLoading ? 'Opening HMRC...' : 'Connect to HMRC'}
            </button>

            <Link href="/profile" className={styles.secondaryBtn}>
              Review profile
            </Link>
          </div>

          <div className={styles.nextStep}>
            <p className={styles.nextStepText}>
              Already connected? Move on to fetching HMRC businesses using the saved token.
            </p>
            <Link href="/hmrc-businesses" className={styles.nextStepLink}>
              Fetch businesses
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
