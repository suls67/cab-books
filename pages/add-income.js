import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/add-income.module.css'

export default function AddIncome() {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [mileage, setMileage] = useState('')
  const [status, setStatus] = useState({ type: '', message: '' })
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()

    if (!amount) {
      setStatus({ type: 'error', message: 'Enter the income amount before saving.' })
      return
    }

    setIsSaving(true)
    setStatus({ type: '', message: '' })

    let driver
    try {
      driver = await getCurrentDriver(supabase)
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not resolve the current driver.'
      })
      setIsSaving(false)
      return
    }

    const { error } = await supabase
      .from('daily_logs')
      .insert([{
        driver_id: driver.id,
        date,
        income: Number(amount),
        mileage: mileage ? Number(mileage) : 0
      }])

    if (error) {
      setStatus({ type: 'error', message: `Could not save income: ${error.message}` })
      setIsSaving(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Income entry</p>
            <h1>Add income</h1>
            <p className={styles.subtitle}>
              Save a new fare or daily income record to your dashboard.
            </p>
          </div>

          <Link href="/dashboard" className={styles.backLink}>
            Back to dashboard
          </Link>
        </div>

        <div className={styles.card}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="amount">Income amount</label>
              <input
                id="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label htmlFor="date">Date</label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="mileage">Mileage</label>
                <input
                  id="mileage"
                  type="number"
                  step="0.1"
                  placeholder="0.0"
                  value={mileage}
                  onChange={(event) => setMileage(event.target.value)}
                />
              </div>
            </div>

            {status.message && (
              <p className={status.type === 'error' ? styles.error : styles.success}>
                {status.message}
              </p>
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save income'}
              </button>

              <Link href="/dashboard" className={styles.secondaryBtn}>
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
