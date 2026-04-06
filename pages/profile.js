import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/profile.module.css'

export default function Profile() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [name, setName] = useState('')
  const [nino, setNino] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
        setName(currentDriver.name || '')
        setNino(currentDriver.nino || '')
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Could not load your profile.'
        setMessage({ type: 'error', text })

        if (text === 'No signed-in user was found') {
          router.push('/login')
        }
      }
    }

    loadDriver()
  }, [router])

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage({ type: '', text: '' })

    if (!driver) {
      setMessage({ type: 'error', text: 'Your driver profile is not ready yet.' })
      return
    }

    if (!name.trim() || !nino.trim()) {
      setMessage({ type: 'error', text: 'Enter your name and NINO before saving.' })
      return
    }

    const normalizedNino = nino.trim().toUpperCase()

    setIsSaving(true)

    const { error } = await supabase
      .from('drivers')
      .update({
        name: name.trim(),
        nino: normalizedNino
      })
      .eq('id', driver.id)

    if (error) {
      setMessage({ type: 'error', text: `Could not save your profile: ${error.message}` })
      setIsSaving(false)
      return
    }

    setMessage({ type: 'success', text: 'Profile updated successfully.' })
    setIsSaving(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Driver profile</p>
            <h1>Complete your HMRC details</h1>
            <p className={styles.subtitle}>
              Add your personal NINO so your driver profile is ready for HMRC-related flows.
            </p>
          </div>

          <Link href="/dashboard" className={styles.backLink}>
            Back to dashboard
          </Link>
        </div>

        <div className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="name">Driver name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="nino">National Insurance Number</label>
              <input
                id="nino"
                type="text"
                value={nino}
                onChange={(event) => setNino(event.target.value)}
                placeholder="QQ123456C"
                autoCapitalize="characters"
              />
            </div>

            {message.text && (
              <p className={message.type === 'error' ? styles.error : styles.success}>
                {message.text}
              </p>
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save profile'}
              </button>

              <Link href="/dashboard" className={styles.secondaryBtn}>
                Skip for now
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
