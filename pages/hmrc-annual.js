import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-annual.module.css'

export default function HmrcAnnual() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [taxYear, setTaxYear] = useState('')
  const [tradingIncomeAllowance, setTradingIncomeAllowance] = useState('1000')
  const [status, setStatus] = useState({ type: '', text: '' })
  const [result, setResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const [retrieveTaxYear, setRetrieveTaxYear] = useState('')
  const [retrievedData, setRetrievedData] = useState(null)
  const [retrieveStatus, setRetrieveStatus] = useState({ type: '', text: '' })
  const [isRetrieving, setIsRetrieving] = useState(false)

  const parseResponseSafely = useCallback(async (response) => {
    const text = await response.text()
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return {
        error: `Unexpected non-JSON response (HTTP ${response.status}).`,
        details: text?.slice(0, 500) || 'No response body.'
      }
    }
  }, [])

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Could not load your annual HMRC submission page.'
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

    if (!taxYear.trim()) {
      setStatus({ type: 'error', text: 'Enter a tax year before submitting.' })
      return
    }

    const allowanceValue = Number(tradingIncomeAllowance)
    if (!Number.isFinite(allowanceValue) || allowanceValue < 0) {
      setStatus({ type: 'error', text: 'Trading income allowance must be a valid positive number.' })
      return
    }

    if (allowanceValue > 0 && !showWarning) {
      setShowWarning(true)
      return
    }

    setShowWarning(false)
    setIsSubmitting(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before submitting annual figures.' })
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch('/api/hmrc/annualSubmission', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          taxYear,
          tradingIncomeAllowance: allowanceValue
        })
      })

      const data = await parseResponseSafely(response)

      if (!response.ok) {
        setStatus({
          type: 'error',
          text: data.error || 'Could not submit annual self-employment figures to HMRC.'
        })
        setResult(data.details || data || null)
        return
      }

      setStatus({
        type: 'success',
        text: 'Annual self-employment submission sent to HMRC successfully.'
      })
      setResult(data)
    } catch {
      setStatus({
        type: 'error',
        text: 'Unexpected error while submitting annual figures.'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRetrieve(event) {
    event.preventDefault()
    setRetrieveStatus({ type: '', text: '' })
    setRetrievedData(null)

    if (!retrieveTaxYear.trim()) {
      setRetrieveStatus({ type: 'error', text: 'Enter a tax year to retrieve.' })
      return
    }

    setIsRetrieving(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setRetrieveStatus({ type: 'error', text: 'You need to be signed in to retrieve annual figures.' })
      setIsRetrieving(false)
      return
    }

    try {
      const response = await fetch(`/api/hmrc/annualSubmission?taxYear=${encodeURIComponent(retrieveTaxYear.trim())}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const data = await parseResponseSafely(response)

      if (!response.ok) {
        setRetrieveStatus({ type: 'error', text: data.error || 'Could not retrieve annual submission from HMRC.' })
        return
      }

      setRetrievedData(data)
    } catch {
      setRetrieveStatus({ type: 'error', text: 'Unexpected error while retrieving annual figures.' })
    } finally {
      setIsRetrieving(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC annual submission</p>
            <h1>Submit annual investment allowance</h1>
            <p className={styles.subtitle}>
              Send annual self-employment allowance figures to HMRC as part of the year-end flow.
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

          {status.text && (
            <div className={status.type === 'error' ? styles.error : styles.success}>
              {status.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="taxYear">Tax year</label>
              <input
                id="taxYear"
                type="text"
                value={taxYear}
                onChange={(event) => setTaxYear(event.target.value)}
                placeholder="e.g. 2025-26"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="tradingIncomeAllowance">Trading income allowance</label>
              <input
                id="tradingIncomeAllowance"
                type="number"
                step="0.01"
                value={tradingIncomeAllowance}
                onChange={(event) => setTradingIncomeAllowance(event.target.value)}
                placeholder="1000"
              />
            </div>

            {showWarning && (
              <div className={styles.warningPanel}>
                <p className={styles.warningTitle}>Remove expenses before claiming allowance</p>
                <p className={styles.warningText}>
                  Claiming Trading Income Allowance will automatically remove all expenses from your
                  quarterly submission for {taxYear}. HMRC does not allow expenses and Trading Income
                  Allowance together. This cannot be undone — confirm to proceed.
                </p>
                <div className={styles.warningActions}>
                  <button
                    type="submit"
                    className={styles.primaryBtn}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Submitting...' : 'Confirm and submit'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setShowWarning(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!showWarning && (
              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn} disabled={isSubmitting || !driver?.nino}>
                  {isSubmitting ? 'Submitting...' : 'Submit annual figures'}
                </button>

                <Link href="/hmrc" className={styles.secondaryBtn}>
                  Cancel
                </Link>
              </div>
            )}
          </form>

          {result && (
            <div className={styles.resultPanel}>
              <p className={styles.sectionEyebrow}>Response</p>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}

          <div className={styles.retrievePanel}>
            <div className={styles.historyHeader}>
              <p className={styles.sectionEyebrow}>Retrieve from HMRC</p>
              <h2>View annual submission</h2>
            </div>

            <form onSubmit={handleRetrieve} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="retrieveTaxYear">Tax year</label>
                <input
                  id="retrieveTaxYear"
                  type="text"
                  value={retrieveTaxYear}
                  onChange={(event) => setRetrieveTaxYear(event.target.value)}
                  placeholder="e.g. 2025-26"
                />
              </div>

              <div className={styles.actions}>
                <button type="submit" className={styles.primaryBtn} disabled={isRetrieving || !driver?.nino}>
                  {isRetrieving ? 'Retrieving...' : 'Retrieve from HMRC'}
                </button>
              </div>
            </form>

            {retrieveStatus.text && (
              <div className={retrieveStatus.type === 'error' ? styles.error : styles.success}>
                {retrieveStatus.text}
              </div>
            )}

            {retrievedData && (
              <div className={styles.resultPanel}>
                <p className={styles.sectionEyebrow}>Annual submission — {retrievedData.taxYear}</p>

                {retrievedData.adjustments && (
                  <div className={styles.resultSection}>
                    <h3>Adjustments</h3>
                    {Object.entries(retrievedData.adjustments).map(([key, value]) => (
                      <div key={key} className={styles.resultRow}>
                        <span>{key}</span>
                        <strong>£{Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {retrievedData.allowances && (
                  <div className={styles.resultSection}>
                    <h3>Allowances</h3>
                    {Object.entries(retrievedData.allowances).map(([key, value]) =>
                      typeof value === 'object' ? null : (
                        <div key={key} className={styles.resultRow}>
                          <span>{key}</span>
                          <strong>£{Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
                        </div>
                      )
                    )}
                  </div>
                )}

                {retrievedData.nonFinancials && (
                  <div className={styles.resultSection}>
                    <h3>Non-financials</h3>
                    {Object.entries(retrievedData.nonFinancials).map(([key, value]) => (
                      <div key={key} className={styles.resultRow}>
                        <span>{key}</span>
                        <strong>{String(value)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
