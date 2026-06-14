import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-income-summary.module.css'

const BUSINESS_TYPES = [
  { value: 'self-employment', label: 'Self-employment' },
  { value: 'uk-property', label: 'UK property' },
  { value: 'foreign-property', label: 'Foreign property' },
  { value: 'uk-property-fhl', label: 'UK property FHL' },
  { value: 'foreign-property-fhl-eea', label: 'Foreign property FHL (EEA)' }
]

export default function HmrcIncomeSummary() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [taxYear, setTaxYear] = useState('')
  const [typeOfBusiness, setTypeOfBusiness] = useState('self-employment')
  const [status, setStatus] = useState({ type: '', text: '' })
  const [result, setResult] = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    async function loadDriver() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
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

  async function handleFetch(event) {
    event.preventDefault()
    setStatus({ type: '', text: '' })
    setResult(null)

    if (!taxYear.trim()) {
      setStatus({ type: 'error', text: 'Enter a tax year before fetching the summary.' })
      return
    }

    setIsLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before fetching the income summary.' })
      setIsLoading(false)
      return
    }

    const response = await fetch(
      `/api/hmrc/incomeSummary?taxYear=${encodeURIComponent(taxYear)}&typeOfBusiness=${encodeURIComponent(typeOfBusiness)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not retrieve the income summary from HMRC.'
      })
      setIsLoading(false)
      return
    }

    setResult(data)
    setStatus({ type: 'success', text: 'Income summary retrieved from HMRC.' })
    setIsLoading(false)
  }

  const formatMoney = (value) =>
    value === null || value === undefined
      ? 'Not provided'
      : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value))

  const s = result?.summary
  const totalIncome = s?.total?.income ?? null
  const totalExpenses = s?.total?.expenses ?? null
  const totalAdditions = s?.total?.additions ?? null
  const totalDeductions = s?.total?.deductions ?? null
  const accountingAdjustments = s?.total?.accountingAdjustments ?? null
  const netProfit = s?.profit?.net ?? null
  const taxableProfit = s?.profit?.taxable ?? null
  const adjustedProfit = s?.profit?.adjusted ?? null
  const netLoss = s?.loss?.net ?? null
  const taxableLoss = s?.loss?.taxable ?? null
  const outstandingBusinessIncome = s?.outstandingBusinessIncome ?? null

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC income summary</p>
            <h1>Business income source summary</h1>
            <p className={styles.subtitle}>
              Retrieve a year-to-date summary of the income and expenditure HMRC holds for your
              self-employment business.
            </p>
          </div>

          <Link href="/hmrc" className={styles.backLink}>
            Back to HMRC
          </Link>
        </div>

        <div className={styles.card}>
          <div className={styles.driverSummary}>
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

          <form onSubmit={handleFetch} className={styles.form}>
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
              <label htmlFor="typeOfBusiness">Type of business</label>
              <select
                id="typeOfBusiness"
                value={typeOfBusiness}
                onChange={(event) => setTypeOfBusiness(event.target.value)}
              >
                {BUSINESS_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.actions}>
              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={isLoading || !driver?.nino}
              >
                {isLoading ? 'Fetching summary...' : 'Fetch income summary'}
              </button>

              <Link href="/hmrc" className={styles.secondaryBtn}>
                Cancel
              </Link>
            </div>
          </form>

          {result && (
            <div className={styles.resultPanel}>
              <div className={styles.resultHeader}>
                <p className={styles.sectionEyebrow}>Result</p>
                <h2>Income summary for {result.taxYear}</h2>
              </div>

              <div className={styles.resultGrid}>
                <div>
                  <span className={styles.label}>Business ID</span>
                  <strong>{result.businessId}</strong>
                </div>

                <div>
                  <span className={styles.label}>Business type</span>
                  <strong>{result.typeOfBusiness}</strong>
                </div>

                {totalIncome !== null && (
                  <div>
                    <span className={styles.label}>Total income</span>
                    <strong>{formatMoney(totalIncome)}</strong>
                  </div>
                )}

                {totalExpenses !== null && (
                  <div>
                    <span className={styles.label}>Total expenses</span>
                    <strong>{formatMoney(totalExpenses)}</strong>
                  </div>
                )}

                {totalAdditions !== null && (
                  <div>
                    <span className={styles.label}>Additions</span>
                    <strong>{formatMoney(totalAdditions)}</strong>
                  </div>
                )}

                {totalDeductions !== null && (
                  <div>
                    <span className={styles.label}>Deductions</span>
                    <strong>{formatMoney(totalDeductions)}</strong>
                  </div>
                )}

                {accountingAdjustments !== null && (
                  <div>
                    <span className={styles.label}>Accounting adjustments</span>
                    <strong>{formatMoney(accountingAdjustments)}</strong>
                  </div>
                )}

                {netProfit !== null && (
                  <div>
                    <span className={styles.label}>Net profit</span>
                    <strong>{formatMoney(netProfit)}</strong>
                  </div>
                )}

                {taxableProfit !== null && (
                  <div>
                    <span className={styles.label}>Taxable profit</span>
                    <strong>{formatMoney(taxableProfit)}</strong>
                  </div>
                )}

                {adjustedProfit !== null && (
                  <div>
                    <span className={styles.label}>Adjusted profit</span>
                    <strong>{formatMoney(adjustedProfit)}</strong>
                  </div>
                )}

                {netLoss !== null && (
                  <div>
                    <span className={styles.label}>Net loss</span>
                    <strong>{formatMoney(netLoss)}</strong>
                  </div>
                )}

                {taxableLoss !== null && (
                  <div>
                    <span className={styles.label}>Taxable loss</span>
                    <strong>{formatMoney(taxableLoss)}</strong>
                  </div>
                )}

                {outstandingBusinessIncome !== null && (
                  <div>
                    <span className={styles.label}>Outstanding business income</span>
                    <strong>{formatMoney(outstandingBusinessIncome)}</strong>
                  </div>
                )}
              </div>

              <div className={styles.rawPanel}>
                <p className={styles.sectionEyebrow}>Full HMRC response</p>
                <pre>{JSON.stringify(result.summary, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
