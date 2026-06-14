import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-create-test-user.module.css'

export default function HmrcCreateTestUser() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [credentials, setCredentials] = useState(null)
  const [ninoSaved, setNinoSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not load driver.'
        if (text === 'No signed-in user was found') {
          router.push('/login')
        }
      }
    }
    loadDriver()
  }, [router])

  async function handleCreate() {
    setError('')
    setCredentials(null)
    setNinoSaved(false)
    setIsCreating(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      if (!accessToken) {
        setError('You must be signed in to create a test user.')
        return
      }

      const res = await fetch('/api/hmrc/createTestUser', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ action: 'create' })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Could not create test user.')
        return
      }

      setCredentials(data)
    } finally {
      setIsCreating(false)
    }
  }

  async function handleSaveNino() {
    if (!credentials?.nino) return
    setError('')
    setIsSaving(true)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token

      const res = await fetch('/api/hmrc/createTestUser', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ action: 'saveNino', nino: credentials.nino })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Could not save NINO.')
        return
      }

      setNinoSaved(true)
      setDriver((prev) => ({ ...prev, nino: credentials.nino }))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC sandbox</p>
            <h1>Create test user</h1>
            <p className={styles.subtitle}>
              Generate a new HMRC sandbox individual with MTD Income Tax enrolled — gives you a real
              NINO and businessId registered in the STATEFUL environment.
            </p>
          </div>

          <Link href="/hmrc" className={styles.backLink}>
            Back to HMRC
          </Link>
        </div>

        <div className={styles.card}>
          <div className={styles.driverRow}>
            <div>
              <span className={styles.label}>Driver</span>
              <strong>{driver?.name || 'Loading...'}</strong>
            </div>
            <div>
              <span className={styles.label}>Current NINO</span>
              <strong>{driver?.nino || 'Not set'}</strong>
            </div>
          </div>

          <div className={styles.warningBlock}>
            <strong>Before you continue</strong>
            <p>
              This creates a brand-new HMRC sandbox user. After creation you will need to:
            </p>
            <ul>
              <li>Save the new NINO to your driver profile (button below)</li>
              <li>Re-authorise via OAuth using the new userId and password</li>
              <li>The old HMRC token will no longer be valid for submissions</li>
            </ul>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={isCreating}
              onClick={handleCreate}
            >
              {isCreating ? 'Creating test user...' : 'Create new HMRC test user'}
            </button>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {credentials && (
            <div className={styles.credentialsPanel}>
              <h2>Test user created</h2>
              <p>Save these credentials — they will not be shown again.</p>

              <div className={styles.credGrid}>
                <div className={styles.credItem}>
                  <span className={styles.label}>User ID (login)</span>
                  <strong className={styles.monoText}>{credentials.userId || '—'}</strong>
                </div>

                <div className={styles.credItem}>
                  <span className={styles.label}>Password</span>
                  <strong className={styles.monoText}>{credentials.password || '—'}</strong>
                </div>

                <div className={styles.credItem}>
                  <span className={styles.label}>NINO</span>
                  <strong className={styles.monoText}>{credentials.nino || '—'}</strong>
                </div>

                <div className={styles.credItem}>
                  <span className={styles.label}>MTD IT ID</span>
                  <strong className={styles.monoText}>{credentials.mtdItId || '—'}</strong>
                </div>

                {credentials.userFullName && (
                  <div className={styles.credItem}>
                    <span className={styles.label}>Full name</span>
                    <strong>{credentials.userFullName}</strong>
                  </div>
                )}

                {credentials.saUtr && (
                  <div className={styles.credItem}>
                    <span className={styles.label}>SA UTR</span>
                    <strong className={styles.monoText}>{credentials.saUtr}</strong>
                  </div>
                )}
              </div>

              {!ninoSaved ? (
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={isSaving || !credentials.nino}
                  onClick={handleSaveNino}
                >
                  {isSaving ? 'Saving...' : `Save NINO (${credentials.nino}) to driver profile`}
                </button>
              ) : (
                <div className={styles.savedBanner}>
                  NINO {credentials.nino} saved to your driver profile.
                </div>
              )}

              {ninoSaved && (
                <Link href="/connect-hmrc" className={styles.oauthLink}>
                  Re-authorise with HMRC using new credentials
                </Link>
              )}

              <div className={styles.nextSteps}>
                <strong>Next steps</strong>
                <ol>
                  <li>Save the NINO above to your driver profile</li>
                  <li>Go to Connect HMRC and sign in with the new userId + password</li>
                  <li>Once re-authorised, go to Submit quarterly update and submit all 4 quarters</li>
                  <li>Submit annual figures via Annual submission</li>
                  <li>Run tax calculation, then final declaration</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
