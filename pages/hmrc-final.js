import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-final.module.css'

const INCOME_SOURCES = [
  {
    key: 'savingsInterest',
    label: 'Savings interest',
    hint: 'Interest from bank accounts, ISAs, or other savings accounts'
  },
  {
    key: 'dividends',
    label: 'Dividends',
    hint: 'Income from shares or investment funds'
  },
  {
    key: 'rentalIncome',
    label: 'Rental income',
    hint: 'Income from renting out property or land'
  },
  {
    key: 'employmentIncome',
    label: 'Employment income',
    hint: 'Wages, salary, or PAYE income from an employer'
  }
]

function PassIcon() {
  return <span className={styles.passIcon}>✓</span>
}

function FailIcon() {
  return <span className={styles.failIcon}>✗</span>
}

const formatMoney = (value) =>
  value != null
    ? new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: 2
      }).format(Number(value))
    : 'Not available'

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date(value))
    : '—'

export default function HmrcFinal() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [taxYear] = useState('2025-26')
  const [step, setStep] = useState('loading')
  const [preflight, setPreflight] = useState(null)
  const [incomeChecks, setIncomeChecks] = useState({
    savingsInterest: null,
    dividends: null,
    rentalIncome: null,
    employmentIncome: null
  })
  const [result, setResult] = useState(null)
  const [errorState, setErrorState] = useState(null)

  useEffect(() => {
    async function init() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
        await runPreflight()
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not load your profile.'
        if (text === 'No signed-in user was found') router.push('/login')
        setStep('error')
        setErrorState({ message: text, canRetry: false })
      }
    }
    init()
  }, [router])

  async function runPreflight() {
    setStep('loading')
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStep('error')
      setErrorState({ message: 'You need to be signed in to continue.', canRetry: false })
      return
    }

    const res = await fetch(`/api/hmrc/finalDeclaration?taxYear=${encodeURIComponent(taxYear)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const data = await res.json()

    if (!res.ok) {
      setStep('error')
      setErrorState({ message: data.error || 'Pre-flight check failed.', canRetry: true })
      return
    }

    setPreflight(data)

    if (data.alreadyFinalised) {
      setStep('finalised')
    } else if (!data.canProceed) {
      setStep('blocked')
    } else {
      setStep('checklist')
    }
  }

  async function handleSubmit() {
    setStep('submitting')
    setErrorState(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    const res = await fetch('/api/hmrc/finalDeclaration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ taxYear })
    })

    const data = await res.json()

    if (!res.ok) {
      setStep('error')
      setErrorState({
        message: data.error || 'The final declaration could not be submitted.',
        errorCode: data.errorCode,
        action: data.action,
        canRetry: data.canRetry ?? true,
        correlationId: data.correlationId
      })
      return
    }

    setResult(data)
    setStep('success')
  }

  const allChecked = INCOME_SOURCES.every((s) => incomeChecks[s.key] !== null)
  const lastCalc = preflight?.checks?.calculation?.lastCalculation

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Final declaration</p>
            <h1>Finalise your tax year</h1>
            <p className={styles.subtitle}>
              This is the final step of your {taxYear} Making Tax Digital journey — equivalent to
              submitting a Self Assessment tax return.
            </p>
          </div>
          <Link href="/hmrc" className={styles.backLink}>Back to HMRC</Link>
        </div>

        {/* LOADING */}
        {step === 'loading' && (
          <div className={styles.card}>
            <p className={styles.loadingText}>Running pre-flight checks...</p>
            <p className={styles.loadingHint}>Verifying obligations, annual summary, and calculations with HMRC.</p>
          </div>
        )}

        {/* BLOCKED */}
        {step === 'blocked' && preflight && (
          <div className={styles.card}>
            <p className={styles.sectionEyebrow}>Pre-flight checks</p>
            <h2 className={styles.cardTitle}>Complete these steps first</h2>
            <p className={styles.cardSubtitle}>
              All of the following must be complete before you can submit your final declaration.
            </p>

            <div className={styles.checkList}>
              {[
                {
                  key: 'obligations',
                  label: 'All quarterly obligations fulfilled',
                  data: preflight.checks.obligations,
                  href: '/hmrc-submit'
                },
                {
                  key: 'annualSummary',
                  label: 'Annual summary submitted',
                  data: preflight.checks.annualSummary,
                  href: '/hmrc-annual'
                },
                {
                  key: 'calculation',
                  label: 'Tax calculation run at least once',
                  data: preflight.checks.calculation,
                  href: '/hmrc-calculations'
                }
              ].map(({ key, label, data, href }) => (
                <div
                  key={key}
                  className={`${styles.checkItem} ${data.passed ? styles.checkItemPass : styles.checkItemFail}`}
                >
                  <div className={styles.checkItemLeft}>
                    {data.passed ? <PassIcon /> : <FailIcon />}
                    <div>
                      <strong>{label}</strong>
                      <p>{data.message}</p>
                      {data.openPeriods?.map((p, i) => (
                        <p key={i} className={styles.checkDetail}>
                          Open period: {formatDate(p.start)} — {formatDate(p.end)}
                        </p>
                      ))}
                    </div>
                  </div>
                  {!data.passed && (
                    <Link href={href} className={styles.fixBtn}>Fix →</Link>
                  )}
                </div>
              ))}
            </div>

            <button type="button" className={styles.secondaryBtn} onClick={runPreflight}>
              Re-check
            </button>
          </div>
        )}

        {/* ALREADY FINALISED — read-only view */}
        {step === 'finalised' && preflight?.finalisedRecord && (
          <div className={styles.card}>
            <div className={styles.successBanner}>
              <p className={styles.sectionEyebrow}>Complete</p>
              <h2>Tax year {taxYear} is finalised</h2>
              <p>A final declaration has already been submitted for this tax year.</p>
            </div>

            <div className={styles.resultGrid}>
              <div>
                <span className={styles.label}>Tax year</span>
                <strong>{taxYear}</strong>
              </div>
              <div>
                <span className={styles.label}>Submitted</span>
                <strong>{formatDate(preflight.finalisedRecord.updated_at)}</strong>
              </div>
              <div>
                <span className={styles.label}>Tax due</span>
                <strong>{formatMoney(preflight.finalisedRecord.tax_due)}</strong>
              </div>
              <div>
                <span className={styles.label}>NIC</span>
                <strong>{formatMoney(preflight.finalisedRecord.nic)}</strong>
              </div>
              <div className={styles.fullWidth}>
                <span className={styles.label}>Calculation ID</span>
                <strong className={styles.monoText}>{preflight.finalisedRecord.calculation_id}</strong>
              </div>
            </div>

            <div className={styles.actions}>
              <Link href="/hmrc" className={styles.primaryBtn}>Back to HMRC</Link>
            </div>
          </div>
        )}

        {/* INCOME CHECKLIST */}
        {step === 'checklist' && (
          <div className={styles.card}>
            <p className={styles.sectionEyebrow}>Step 1 of 2</p>
            <h2 className={styles.cardTitle}>Confirm your income sources</h2>
            <p className={styles.cardSubtitle}>
              For each income type below, confirm whether it applies to you and whether you have
              declared it to HMRC. You must answer every item before continuing.
            </p>

            <div className={styles.incomeList}>
              {INCOME_SOURCES.map(({ key, label, hint }) => (
                <div key={key} className={styles.incomeItem}>
                  <div className={styles.incomeLabel}>
                    <strong>{label}</strong>
                    <p>{hint}</p>
                  </div>
                  <div className={styles.incomeOptions}>
                    <label
                      className={`${styles.incomeOption} ${
                        incomeChecks[key] === 'declared' ? styles.incomeOptionSelected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name={key}
                        value="declared"
                        checked={incomeChecks[key] === 'declared'}
                        onChange={() =>
                          setIncomeChecks((prev) => ({ ...prev, [key]: 'declared' }))
                        }
                      />
                      I have this and have declared it
                    </label>
                    <label
                      className={`${styles.incomeOption} ${
                        incomeChecks[key] === 'na' ? styles.incomeOptionSelected : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name={key}
                        value="na"
                        checked={incomeChecks[key] === 'na'}
                        onChange={() =>
                          setIncomeChecks((prev) => ({ ...prev, [key]: 'na' }))
                        }
                      />
                      Not applicable to me
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!allChecked}
                onClick={() => setStep('confirm')}
              >
                Continue to confirmation
              </button>
            </div>
          </div>
        )}

        {/* CONFIRMATION */}
        {step === 'confirm' && (
          <div className={styles.card}>
            <p className={styles.sectionEyebrow}>Step 2 of 2</p>
            <h2 className={styles.cardTitle}>Review and confirm</h2>

            <div className={styles.resultGrid}>
              <div>
                <span className={styles.label}>Tax year</span>
                <strong>{taxYear}</strong>
              </div>
              {lastCalc && (
                <>
                  <div>
                    <span className={styles.label}>Estimated tax due</span>
                    <strong>{formatMoney(lastCalc.tax_due)}</strong>
                  </div>
                  <div>
                    <span className={styles.label}>NIC</span>
                    <strong>{formatMoney(lastCalc.nic)}</strong>
                  </div>
                  <div>
                    <span className={styles.label}>Calculation date</span>
                    <strong>{formatDate(lastCalc.submission_date)}</strong>
                  </div>
                </>
              )}
            </div>

            <div className={styles.disclaimerBlock}>
              This calculation is only based on information HMRC have received about your income and
              expenses. This may change as HMRC receives further information about you during the
              tax year.
            </div>

            <div className={styles.warningBlock}>
              <strong>This action cannot be undone.</strong>
              <p>
                By confirming, you are making a legal declaration that the information you have
                provided is correct and complete to the best of your knowledge. This is the
                equivalent of submitting a Self Assessment tax return.
              </p>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.dangerBtn} onClick={handleSubmit}>
                Confirm and submit
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setStep('checklist')}
              >
                Go back
              </button>
            </div>
          </div>
        )}

        {/* SUBMITTING */}
        {step === 'submitting' && (
          <div className={styles.card}>
            <p className={styles.loadingText}>Submitting your final declaration to HMRC...</p>
            <p className={styles.loadingHint}>
              This may take up to 15 seconds. Please do not close or refresh this page.
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {step === 'success' && result && (
          <div className={styles.card}>
            <div className={styles.successBanner}>
              <p className={styles.sectionEyebrow}>Complete</p>
              <h2>Final declaration submitted</h2>
              <p>
                Your {result.taxYear} tax year is now closed. Keep your reference number safe —
                it is proof of your submission.
              </p>
            </div>

            <div className={styles.resultGrid}>
              <div>
                <span className={styles.label}>Tax year</span>
                <strong>{result.taxYear}</strong>
              </div>
              <div>
                <span className={styles.label}>Submitted</span>
                <strong>{formatDate(result.submittedAt)}</strong>
              </div>
              <div>
                <span className={styles.label}>Final tax due</span>
                <strong>{formatMoney(result.taxDue)}</strong>
              </div>
              <div>
                <span className={styles.label}>NIC</span>
                <strong>{formatMoney(result.nic)}</strong>
              </div>
              <div className={styles.fullWidth}>
                <span className={styles.label}>Submission reference (Correlation ID)</span>
                <strong className={styles.monoText}>
                  {result.correlationId || 'Not provided by HMRC'}
                </strong>
              </div>
              <div className={styles.fullWidth}>
                <span className={styles.label}>Calculation ID</span>
                <strong className={styles.monoText}>{result.calculationId}</strong>
              </div>
            </div>

            {result.metadata?.periodTo && (
              <div className={styles.disclaimerBlock}>
                This calculation is based on information HMRC received up to{' '}
                {formatDate(result.metadata.periodTo)}.
              </div>
            )}

            {result.messages && (
              <>
                {Array.isArray(result.messages.errors) && result.messages.errors.length > 0 && (
                  <div className={styles.msgErrorBlock}>
                    <strong>Errors</strong>
                    {result.messages.errors.map((m, i) => (
                      <p key={i}>{m.text}</p>
                    ))}
                  </div>
                )}
                {Array.isArray(result.messages.warnings) && result.messages.warnings.length > 0 && (
                  <div className={styles.msgWarnBlock}>
                    <strong>Warnings from HMRC</strong>
                    {result.messages.warnings.map((m, i) => (
                      <p key={i}>{m.text}</p>
                    ))}
                  </div>
                )}
                {Array.isArray(result.messages.info) && result.messages.info.length > 0 && (
                  <div className={styles.msgInfoBlock}>
                    <strong>Information from HMRC</strong>
                    {result.messages.info.map((m, i) => (
                      <p key={i}>{m.text}</p>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className={styles.actions}>
              <Link href="/hmrc" className={styles.primaryBtn}>Back to HMRC</Link>
            </div>
          </div>
        )}

        {/* ERROR */}
        {step === 'error' && errorState && (
          <div className={styles.card}>
            <div className={styles.errorBanner}>
              <p className={styles.sectionEyebrow}>Error</p>
              <h2>Submission failed</h2>
              <p>{errorState.message}</p>
            </div>

            {errorState.correlationId && (
              <div className={styles.resultGrid}>
                <div className={styles.fullWidth}>
                  <span className={styles.label}>Reference number (Correlation ID)</span>
                  <strong className={styles.monoText}>{errorState.correlationId}</strong>
                </div>
              </div>
            )}

            <div className={styles.actions}>
              {errorState.action && (
                <Link href={errorState.action.href} className={styles.primaryBtn}>
                  {errorState.action.label}
                </Link>
              )}
              {errorState.canRetry && (
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setStep('confirm')}
                >
                  Retry
                </button>
              )}
              <Link href="/hmrc" className={styles.secondaryBtn}>Back to HMRC</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
