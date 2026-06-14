import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-calculations.module.css'

function getClientHeaders(driver) {
  if (typeof window === 'undefined') return {}

  const existingDeviceId = window.localStorage.getItem('hmrcDeviceId')
  const deviceId = existingDeviceId || window.crypto?.randomUUID?.() || `device-${Date.now()}`

  if (!existingDeviceId) {
    window.localStorage.setItem('hmrcDeviceId', deviceId)
  }

  const timezoneOffsetMinutes = -new Date().getTimezoneOffset()
  const sign = timezoneOffsetMinutes >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(timezoneOffsetMinutes) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(timezoneOffsetMinutes) % 60).padStart(2, '0')

  return {
    'x-hmrc-device-id': deviceId,
    'x-hmrc-browser-user-agent': window.navigator.userAgent,
    'x-hmrc-timezone': `${sign}${hours}:${minutes}`,
    'x-hmrc-window-size': `width=${window.innerWidth}&height=${window.innerHeight}`,
    'x-hmrc-screens': `width=${window.screen.width}&height=${window.screen.height}&scaling-factor=${window.devicePixelRatio || 1}&colour-depth=${window.screen.colorDepth || 24}`,
    'x-hmrc-user-id': driver?.email || driver?.id || 'unknown-user'
  }
}

function toReadable(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim()
}

function moneyFmt(value) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value))
}

function TaxCalcSection({ data }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const entries = Object.entries(data)
  const primitives = entries.filter(([, v]) => typeof v === 'number' && v !== 0 && v != null)
  const groups = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
  if (!primitives.length && !groups.length) return null
  return (
    <>
      {primitives.map(([key, val]) => (
        <div key={key} className={styles.calcRow}>
          <span className={styles.calcKey}>{toReadable(key)}</span>
          <span className={styles.calcVal}>{moneyFmt(val)}</span>
        </div>
      ))}
      {groups.map(([key, val]) => (
        <div key={key} className={styles.calcGroup}>
          <h4 className={styles.calcGroupTitle}>{toReadable(key)}</h4>
          <TaxCalcSection data={val} />
        </div>
      ))}
    </>
  )
}

export default function HmrcCalculations() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [taxYear, setTaxYear] = useState('2025-26')
  const [calculationType, setCalculationType] = useState('in-year')
  const [calculations, setCalculations] = useState([])
  const [selectedCalculation, setSelectedCalculation] = useState(null)
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isFinalising, setIsFinalising] = useState(false)
  const [confirmFinalDeclaration, setConfirmFinalDeclaration] = useState(false)

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

  async function fetchCalculations(nextTaxYear = taxYear, nextType = calculationType) {
    setStatus({ type: '', text: '' })
    setIsLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before loading tax calculations.' })
      setIsLoading(false)
      return
    }

    const response = await fetch(
      `/api/hmrc/calculations?taxYear=${encodeURIComponent(nextTaxYear)}&calculationType=${encodeURIComponent(nextType)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...getClientHeaders(driver)
        }
      }
    )

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not load HMRC tax calculations.'
      })
      setIsLoading(false)
      return
    }

    const list = Array.isArray(data.calculations) ? data.calculations : []
    setCalculations(list)
    setStatus({
      type: 'success',
      text: list.length ? 'Existing HMRC calculations loaded.' : 'No HMRC calculations were found for that tax year yet.'
    })
    setIsLoading(false)
  }

  async function handleTrigger(event) {
    event.preventDefault()
    setStatus({ type: '', text: '' })
    setIsSubmitting(true)
    setSelectedCalculation(null)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before triggering a calculation.' })
      setIsSubmitting(false)
      return
    }

    const response = await fetch('/api/hmrc/calculations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...getClientHeaders(driver)
      },
      body: JSON.stringify({
        taxYear,
        calculationType
      })
    })

    const data = await response.json()
    setSelectedCalculation(data)

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not trigger the HMRC tax calculation.'
      })
      setIsSubmitting(false)
      return
    }

    setStatus({
      type: data.status === 'pending' ? 'success' : 'success',
      text:
        data.status === 'pending'
          ? 'Calculation is still processing. You can refresh or list calculations shortly.'
          : 'Tax calculation retrieved successfully.'
    })

    await fetchCalculations(taxYear, calculationType)
    setIsSubmitting(false)
  }

  async function handleFinalDeclaration() {
    if (!selectedCalculation?.calculationId) {
      setStatus({ type: 'error', text: 'No calculation is available to submit as a final declaration.' })
      return
    }

    setStatus({ type: '', text: '' })
    setIsFinalising(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before confirming the final declaration.' })
      setIsFinalising(false)
      return
    }

    const response = await fetch('/api/hmrc/calculations', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...getClientHeaders(driver)
      },
      body: JSON.stringify({
        taxYear,
        calculationId: selectedCalculation.calculationId,
        calculationType: 'final-declaration'
      })
    })

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not submit the HMRC final declaration.'
      })
      setIsFinalising(false)
      return
    }

    setSelectedCalculation((current) =>
      current
        ? {
            ...current,
            status: data.status,
            finalDeclarationSubmittedAt: data.submittedAt
          }
        : current
    )
    setStatus({
      type: 'success',
      text: 'Final declaration submitted to HMRC successfully.'
    })
    setConfirmFinalDeclaration(false)
    await fetchCalculations(taxYear, calculationType)
    setIsFinalising(false)
  }

  async function handleRetrieve(calculationId) {
    setStatus({ type: '', text: '' })
    setIsLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before retrieving a calculation.' })
      setIsLoading(false)
      return
    }

    const response = await fetch(
      `/api/hmrc/calculations?taxYear=${encodeURIComponent(taxYear)}&calculationType=${encodeURIComponent(calculationType)}&calculationId=${encodeURIComponent(calculationId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...getClientHeaders(driver)
        }
      }
    )

    const data = await response.json()
    setSelectedCalculation(data)

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not retrieve the selected calculation.'
      })
      setIsLoading(false)
      return
    }

    setStatus({
      type: data.status === 'error' ? 'error' : 'success',
      text:
        data.status === 'error'
          ? 'HMRC returned validation errors for this calculation.'
          : 'Calculation details loaded.'
    })
    setIsLoading(false)
  }

  const formatMoney = (value) =>
    value === null || value === undefined
      ? 'Not provided'
      : new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: 'GBP'
        }).format(Number(value))
  const formatDateTime = (value) =>
    value
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(value))
      : 'Not provided'
  const calcMessages = selectedCalculation?.messages || {}
  const errorMessages = Array.isArray(calcMessages.errors) ? calcMessages.errors : []
  const warningMessages = Array.isArray(calcMessages.warnings) ? calcMessages.warnings : []
  const infoMessages = Array.isArray(calcMessages.info) ? calcMessages.info : []
  const hasWarnings = warningMessages.length > 0
  const hasErrors = errorMessages.length > 0 || selectedCalculation?.status === 'error'
  const hasNoResults = hasErrors  // when validation errors exist, HMRC produces no calculation output
  const deriveListStatus = (calc) => {
    if (calc.finalDeclaration) return 'final'
    if (calc.totalIncomeTaxAndNicsDue != null) return 'complete'
    return 'pending'
  }
  const canSubmitFinalDeclaration =
    selectedCalculation?.status === 'complete' &&
    selectedCalculation?.calculationType === 'intent-to-finalise'

  const simplifyMessage = (text) => {
    if (!text) return ''
    if (text === 'Period submissions include gaps') {
      return 'There are gaps in your quarterly updates. Review your obligations and make sure every required period has been submitted.'
    }
    if (text === 'Final confirmation of income and expenses for all business sources has not been provided') {
      return 'HMRC does not yet have the full confirmed position for all business sources, so this calculation cannot be treated as complete.'
    }
    if (text.includes('Your BRT limit has been increased')) {
      return 'HMRC has adjusted part of the calculation because of the Gift Aid information it holds.'
    }
    return text
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC calculations</p>
            <h1>Run and review tax calculations</h1>
            <p className={styles.subtitle}>
              Trigger new calculations, retrieve existing ones, and review any validation errors
              before moving further into year-end HMRC steps.
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

          <form onSubmit={handleTrigger} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="taxYear">Tax year</label>
              <input
                id="taxYear"
                value={taxYear}
                onChange={(event) => setTaxYear(event.target.value)}
                placeholder="2025-26"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="calculationType">Calculation type</label>
              <select
                id="calculationType"
                value={calculationType}
                onChange={(event) => setCalculationType(event.target.value)}
              >
                <option value="in-year">In-year</option>
                <option value="intent-to-finalise">Intent to finalise</option>
                <option value="intent-to-amend">Intent to amend</option>
                <option value="final-declaration">Final declaration</option>
                <option value="confirm-amendment">Confirm amendment</option>
              </select>
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryBtn} disabled={isSubmitting || !driver?.nino}>
                {isSubmitting ? 'Running calculation...' : 'Run calculation'}
              </button>

              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => fetchCalculations()}
                disabled={isLoading || !driver?.nino}
              >
                {isLoading ? 'Loading...' : 'View existing calculations'}
              </button>
            </div>
          </form>

          {calculations.length > 0 && (
            <div className={styles.listSection}>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionEyebrow}>Existing</p>
                <h2>Calculations for {taxYear}</h2>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.calcTable}>
                  <thead>
                    <tr>
                      <th>Calculation ID</th>
                      <th>Timestamp</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculations.map((calc) => {
                      const id = calc.calculationId || calc.id || calc.calculation_id
                      const status = deriveListStatus(calc)
                      return (
                        <tr key={id}>
                          <td className={styles.idCell}>{id ? `${id.slice(0, 8)}…` : '—'}</td>
                          <td>{calc.calculationTimestamp ? formatDateTime(calc.calculationTimestamp) : '—'}</td>
                          <td>{calc.calculationType || '—'}</td>
                          <td>
                            <span className={styles[`badge_${status}`] || styles.badge_pending}>
                              {status}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.inlineLink}
                              onClick={() => handleRetrieve(id)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedCalculation && (
            <div className={styles.resultPanel}>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionEyebrow}>Result</p>
                <h2>Calculation details</h2>
              </div>

              {/* Disclaimer — only shown when results exist and type requires it */}
              {!hasNoResults &&
                (selectedCalculation.calculationType === 'in-year' ||
                  selectedCalculation.calculationType === 'intent-to-finalise') && (
                <div className={styles.disclaimerBlock}>
                  This calculation is only based on information HMRC has received about your income
                  and expenses up to{' '}
                  {selectedCalculation.metadata?.periodTo
                    ? formatDateTime(selectedCalculation.metadata.periodTo)
                    : 'the date of your last submission'}
                  . It does not include anything submitted after that date and may change as HMRC
                  receives further information.
                </div>
              )}

              {/* Validation error banner — no calculation results produced */}
              {hasNoResults && (
                <div className={styles.error}>
                  <strong>No calculation results produced.</strong> HMRC found validation errors in
                  your submitted data. You must fix the errors below, resubmit the affected
                  periods, and then re-trigger the calculation.
                </div>
              )}

              <div className={styles.resultGrid}>
                <div>
                  <span className={styles.label}>Status</span>
                  <strong>{selectedCalculation.status || 'Unknown'}</strong>
                </div>

                <div>
                  <span className={styles.label}>Type</span>
                  <strong>{selectedCalculation.calculationType || '—'}</strong>
                </div>

                {!hasNoResults && (
                  <div>
                    <span className={styles.label}>Based on data up to</span>
                    <strong>
                      {selectedCalculation.metadata?.periodTo
                        ? formatDateTime(selectedCalculation.metadata.periodTo)
                        : 'Last submission date'}
                    </strong>
                  </div>
                )}

                <div>
                  <span className={styles.label}>Calculation ID</span>
                  <strong className={styles.monoText}>{selectedCalculation.calculationId || '—'}</strong>
                </div>
              </div>

              {selectedCalculation.finalDeclarationSubmittedAt && (
                <div className={styles.confirmationBanner}>
                  Final declaration submitted on{' '}
                  {formatDateTime(selectedCalculation.finalDeclarationSubmittedAt)}.
                </div>
              )}

              {canSubmitFinalDeclaration && (
                <div className={styles.finalDeclarationPanel}>
                  <p className={styles.sectionEyebrow}>Final declaration</p>
                  <h3>Ready to confirm this calculation</h3>
                  <p className={styles.nextStepText}>
                    Only send this once you have reviewed the figures and you are happy to confirm
                    them with HMRC.
                  </p>

                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={confirmFinalDeclaration}
                      onChange={(event) => setConfirmFinalDeclaration(event.target.checked)}
                    />
                    <span>I have reviewed this calculation and want to submit the final declaration to HMRC.</span>
                  </label>

                  <div className={styles.nextStepActions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={handleFinalDeclaration}
                      disabled={!confirmFinalDeclaration || isFinalising}
                    >
                      {isFinalising ? 'Submitting final declaration...' : 'Submit final declaration'}
                    </button>
                  </div>
                </div>
              )}

              {(hasWarnings || hasErrors || selectedCalculation.status === 'pending') && (
                <div className={styles.nextStepPanel}>
                  <p className={styles.sectionEyebrow}>Next step</p>
                  <h3>What to do next</h3>

                  {selectedCalculation.status === 'pending' && (
                    <p className={styles.nextStepText}>
                      HMRC is still processing this calculation. Give it a little more time, then
                      use &ldquo;View existing calculations&rdquo; and open the latest calculation again.
                    </p>
                  )}

                  {hasErrors && (
                    <p className={styles.nextStepText}>
                      HMRC returned validation errors — no tax figures were produced. Fix the errors
                      shown below by amending the affected submissions, then come back and run a new
                      calculation.
                    </p>
                  )}

                  {hasWarnings && !hasErrors && (
                    <p className={styles.nextStepText}>
                      HMRC has returned warnings. Review your obligations and quarterly submissions
                      to make sure there are no missing updates before relying on this result.
                    </p>
                  )}

                  <div className={styles.nextStepActions}>
                    <Link href="/hmrc-obligations" className={styles.secondaryBtn}>
                      Review obligations
                    </Link>

                    <Link href="/hmrc-submit" className={styles.primaryBtn}>
                      {hasErrors ? 'Resubmit amended figures' : 'Submit next update'}
                    </Link>
                  </div>
                </div>
              )}

              {selectedCalculation.calculation?.taxCalculation && (
                <div className={styles.calcSection}>
                  <p className={styles.sectionEyebrow}>Tax summary</p>
                  <TaxCalcSection data={selectedCalculation.calculation.taxCalculation} />
                </div>
              )}

              {(errorMessages.length > 0 || warningMessages.length > 0 || infoMessages.length > 0) ? (
                <div className={styles.messageStack}>
                  {errorMessages.length > 0 && (
                    <div className={styles.errorBlock}>
                      <h3>Errors</h3>
                      <div className={styles.messageList}>
                        {errorMessages.map((item, index) => (
                          <div key={`error-${item.id || index}`} className={styles.messageItem}>
                            <strong>Error</strong>
                            <p>{simplifyMessage(item.text)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {warningMessages.length > 0 && (
                    <div className={styles.warningBlock}>
                      <h3>Warnings</h3>
                      <div className={styles.messageList}>
                        {warningMessages.map((item, index) => (
                          <div key={`warning-${item.id || index}`} className={styles.messageItem}>
                            <strong>Warning</strong>
                            <p>{simplifyMessage(item.text)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {infoMessages.length > 0 && (
                    <div className={styles.infoBlock}>
                      <h3>Info</h3>
                      <div className={styles.messageList}>
                        {infoMessages.map((item, index) => (
                          <div key={`info-${item.id || index}`} className={styles.messageItem}>
                            <strong>Information</strong>
                            <p>{simplifyMessage(item.text)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedCalculation.status === 'complete' ? (
                <div className={styles.payloadBlock}>
                  <p>No messages from HMRC for this calculation.</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
