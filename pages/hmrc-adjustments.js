import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-adjustments.module.css'

export default function HmrcAdjustments() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [taxYear, setTaxYear] = useState('')
  const [calculationId, setCalculationId] = useState('')
  const [income, setIncome] = useState({ turnover: '', otherIncome: '' })
  const [expenses, setExpenses] = useState({
    carVanTravelExpenses: '',
    financeCharges: '',
    depreciation: '',
    wagesAndStaffCosts: '',
    adminCosts: '',
    professionalFees: '',
    otherExpenses: ''
  })
  const [additions, setAdditions] = useState({
    carVanTravelExpensesDisallowable: '',
    financeChargesDisallowable: '',
    depreciationDisallowable: '',
    wagesAndStaffCostsDisallowable: '',
    adminCostsDisallowable: '',
    professionalFeesDisallowable: '',
    otherExpensesDisallowable: ''
  })
  const [history, setHistory] = useState([])
  const [status, setStatus] = useState({ type: '', text: '' })
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

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

  const getAppAccessToken = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    return sessionData.session?.access_token
  }, [])

  const loadHistory = useCallback(async (accessToken) => {
    if (!accessToken) return

    const response = await fetch('/api/hmrc/adjustments', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = await parseResponseSafely(response)
    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not load adjustment history.'
      })
      return
    }

    setHistory(data.history || [])
  }, [parseResponseSafely])

  useEffect(() => {
    async function loadPage() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)

        const accessToken = await getAppAccessToken()
        await loadHistory(accessToken)
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Could not load HMRC adjustments.'
        setStatus({ type: 'error', text })

        if (text === 'No signed-in user was found') {
          router.push('/login')
        }
      }
    }

    loadPage()
  }, [getAppAccessToken, loadHistory, router])

  async function runAdjustmentAction(action) {
    setStatus({ type: '', text: '' })
    setResult(null)
    setIsLoading(true)

    try {
      const accessToken = await getAppAccessToken()

      if (!accessToken) {
        setStatus({
          type: 'error',
          text: 'You need to be signed in before running HMRC adjustments.'
        })
        return
      }

      const payload = {
        action,
        taxYear,
        calculationId,
        ...income,
        ...expenses,
        ...additions
      }

      const response = await fetch('/api/hmrc/adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
      })

      const data = await parseResponseSafely(response)

      if (!response.ok) {
        setStatus({
          type: 'error',
          text: data.error || `Could not complete "${action}" in adjustment flow.`
        })
        setResult(data.details || data)
        return
      }

      if (action === 'trigger' && data.calculationId) {
        setCalculationId(data.calculationId)
      }

      setStatus({
        type: 'success',
        text:
          action === 'trigger'
            ? 'Calculation triggered successfully. Next, retrieve the adjustable summary.'
            : action === 'retrieve'
              ? 'Adjustable summary retrieved successfully.'
              : 'Accounting adjustment submitted to HMRC successfully.'
      })
      setResult(data)

      if (action === 'submit') {
        await loadHistory(accessToken)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const formatDateTime = (value) =>
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
            <p className={styles.eyebrow}>HMRC adjustments</p>
            <h1>Business adjustments (BSAS)</h1>
            <p className={styles.subtitle}>
              Trigger a calculation, retrieve the adjustable summary, then submit accounting
              adjustments.
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

          <div className={styles.formGrid}>
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
              <label htmlFor="calculationId">Calculation ID</label>
              <input
                id="calculationId"
                type="text"
                value={calculationId}
                onChange={(event) => setCalculationId(event.target.value)}
                placeholder="Auto-filled after trigger"
              />
            </div>
          </div>

          <div className={styles.sectionBlock}>
            <p className={styles.sectionEyebrow}>Income</p>
            <div className={styles.formGrid}>
              {[
                { key: 'turnover', label: 'Turnover' },
                { key: 'otherIncome', label: 'Other income' }
              ].map(({ key, label }) => (
                <div key={key} className={styles.field}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={income[key]}
                    onChange={(event) => setIncome((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.sectionBlock}>
            <p className={styles.sectionEyebrow}>Expenses</p>
            <div className={styles.formGrid}>
              {[
                { key: 'carVanTravelExpenses', label: 'Car, van and travel' },
                { key: 'financeCharges', label: 'Finance charges' },
                { key: 'depreciation', label: 'Depreciation' },
                { key: 'wagesAndStaffCosts', label: 'Wages and staff costs' },
                { key: 'adminCosts', label: 'Admin costs' },
                { key: 'professionalFees', label: 'Professional fees' },
                { key: 'otherExpenses', label: 'Other expenses' }
              ].map(({ key, label }) => (
                <div key={key} className={styles.field}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={expenses[key]}
                    onChange={(event) => setExpenses((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.sectionBlock}>
            <p className={styles.sectionEyebrow}>Disallowable amounts</p>
            <p className={styles.sectionNote}>Enter the portion of each expense that is not allowable for tax purposes.</p>
            <div className={styles.formGrid}>
              {[
                { key: 'carVanTravelExpensesDisallowable', label: 'Car, van and travel (disallowable)' },
                { key: 'financeChargesDisallowable', label: 'Finance charges (disallowable)' },
                { key: 'depreciationDisallowable', label: 'Depreciation (disallowable)' },
                { key: 'wagesAndStaffCostsDisallowable', label: 'Wages and staff costs (disallowable)' },
                { key: 'adminCostsDisallowable', label: 'Admin costs (disallowable)' },
                { key: 'professionalFeesDisallowable', label: 'Professional fees (disallowable)' },
                { key: 'otherExpensesDisallowable', label: 'Other expenses (disallowable)' }
              ].map(({ key, label }) => (
                <div key={key} className={styles.field}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={additions[key]}
                    onChange={(event) => setAdditions((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={isLoading || !driver?.nino}
              onClick={() => runAdjustmentAction('trigger')}
            >
              {isLoading ? 'Working...' : '1. Trigger'}
            </button>

            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={isLoading || !driver?.nino || !calculationId.trim()}
              onClick={() => runAdjustmentAction('retrieve')}
            >
              {isLoading ? 'Working...' : '2. Retrieve summary'}
            </button>

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={isLoading || !driver?.nino || !calculationId.trim()}
              onClick={() => runAdjustmentAction('submit')}
            >
              {isLoading ? 'Working...' : '3. Submit adjustment'}
            </button>
          </div>

          {result && (
            <div className={styles.resultPanel}>
              <p className={styles.sectionEyebrow}>Response</p>

              {result.action === 'retrieve' && result.summary ? (
                <>
                  <div className={styles.retrieveGrid}>
                    <div>
                      <span className={styles.label}>Status</span>
                      <strong>{result.summary.metadata?.summaryStatus ?? 'Unknown'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Tax year</span>
                      <strong>{result.summary.metadata?.taxYear ?? '—'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Business</span>
                      <strong>{result.summary.inputs?.businessName ?? '—'}</strong>
                    </div>
                    <div>
                      <span className={styles.label}>Calculation ID</span>
                      <strong>{result.summary.metadata?.calculationId ?? '—'}</strong>
                    </div>
                  </div>

                  <div className={styles.retrieveSection}>
                    <p className={styles.sectionEyebrow}>Original figures</p>
                    <div className={styles.retrieveGrid}>
                      <div>
                        <span className={styles.label}>Total income</span>
                        <strong>{result.summary.adjustableSummaryCalculation?.totalIncome ?? '—'}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Total expenses</span>
                        <strong>{result.summary.adjustableSummaryCalculation?.totalExpenses ?? '—'}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Net profit</span>
                        <strong>{result.summary.adjustableSummaryCalculation?.netProfit ?? '—'}</strong>
                      </div>
                      <div>
                        <span className={styles.label}>Taxable profit</span>
                        <strong>{result.summary.adjustableSummaryCalculation?.taxableProfit ?? '—'}</strong>
                      </div>
                    </div>
                  </div>

                  {result.summary.adjustments && (
                    <div className={styles.retrieveSection}>
                      <p className={styles.sectionEyebrow}>Adjustments on record</p>
                      <pre>{JSON.stringify(result.summary.adjustments, null, 2)}</pre>
                    </div>
                  )}

                  {result.summary.adjustedSummaryCalculation && (
                    <div className={styles.retrieveSection}>
                      <p className={styles.sectionEyebrow}>Adjusted figures</p>
                      <div className={styles.retrieveGrid}>
                        <div>
                          <span className={styles.label}>Total income</span>
                          <strong>{result.summary.adjustedSummaryCalculation?.totalIncome ?? '—'}</strong>
                        </div>
                        <div>
                          <span className={styles.label}>Total expenses</span>
                          <strong>{result.summary.adjustedSummaryCalculation?.totalExpenses ?? '—'}</strong>
                        </div>
                        <div>
                          <span className={styles.label}>Net profit</span>
                          <strong>{result.summary.adjustedSummaryCalculation?.netProfit ?? '—'}</strong>
                        </div>
                        <div>
                          <span className={styles.label}>Taxable profit</span>
                          <strong>{result.summary.adjustedSummaryCalculation?.taxableProfit ?? '—'}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <pre>{JSON.stringify(result, null, 2)}</pre>
              )}
            </div>
          )}

          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <p className={styles.sectionEyebrow}>History</p>
              <h2>Saved adjustments</h2>
            </div>

            {history.length ? (
              <div className={styles.historyList}>
                {history.map((item) => (
                  <div key={item.id} className={styles.historyCard}>
                    <span className={styles.label}>Tax year</span>
                    <strong>{item.tax_year}</strong>
                    <p>Calculation ID: {item.calculation_id}</p>
                    <p>Business ID: {item.business_id}</p>
                    <p>Submitted: {formatDateTime(item.submitted_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.historyEmpty}>No adjustment history saved yet for this driver.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
