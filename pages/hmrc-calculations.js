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
  const getFriendlyDisclaimer = () => {
    if (!selectedCalculation) return ''

    if (
      selectedCalculation.status &&
      (calculationType === 'in-year' || calculationType === 'intent-to-finalise')
    ) {
      return `This calculation is based on information HMRC has received up to ${formatDateTime(selectedCalculation.submissionDate)}. It may change as more information is received.`
    }

    return selectedCalculation.disclaimer || ''
  }
  const groupedMessages = Array.isArray(selectedCalculation?.errors) ? selectedCalculation.errors : []
  const infoMessages = groupedMessages.flatMap((group) => group?.info || [])
  const warningMessages = groupedMessages.flatMap((group) => group?.warnings || [])
  const errorMessages = groupedMessages.flatMap((group) => group?.errors || [])
  const hasWarnings = warningMessages.length > 0
  const hasErrors = errorMessages.length > 0
  const latestCalculations = calculations.slice(0, 3)

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
                <h2>Recent calculations for {taxYear}</h2>
              </div>

              <div className={styles.calculationList}>
                {latestCalculations.map((calculation, index) => {
                  const calculationId =
                    calculation.calculationId || calculation.id || calculation.calculation_id

                  return (
                    <div key={calculationId || index} className={styles.calculationCard}>
                      <div>
                        <span className={styles.label}>Calculation</span>
                        <strong>{index === 0 ? 'Latest calculation' : `Previous calculation ${index}`}</strong>
                      </div>

                      <div>
                        <span className={styles.label}>Type</span>
                        <strong>{calculation.calculationType || calculationType}</strong>
                      </div>

                      <button
                        type="button"
                        className={styles.inlineLink}
                        onClick={() => handleRetrieve(calculationId)}
                      >
                        View details
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedCalculation && (
            <div className={styles.resultPanel}>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionEyebrow}>Result</p>
                <h2>Calculation details</h2>
              </div>

              <div className={styles.resultGrid}>
                <div>
                  <span className={styles.label}>Status</span>
                  <strong>{selectedCalculation.status || 'Unknown'}</strong>
                </div>

                <div>
                  <span className={styles.label}>Based on data up to</span>
                  <strong>{formatDateTime(selectedCalculation.submissionDate)}</strong>
                </div>

                {!hasErrors && (
                  <>
                    <div>
                      <span className={styles.label}>Tax due</span>
                      <strong>{formatMoney(selectedCalculation.taxDue)}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>NIC</span>
                      <strong>{formatMoney(selectedCalculation.nic)}</strong>
                    </div>
                  </>
                )}
              </div>

              {getFriendlyDisclaimer() && (
                <div className={styles.disclaimerBlock}>{getFriendlyDisclaimer()}</div>
              )}

              {(hasWarnings || hasErrors || selectedCalculation.status === 'pending') && (
                <div className={styles.nextStepPanel}>
                  <p className={styles.sectionEyebrow}>Next step</p>
                  <h3>What to do next</h3>

                  {selectedCalculation.status === 'pending' && (
                    <p className={styles.nextStepText}>
                      HMRC is still processing this calculation. Give it a little more time, then
                      use `View existing calculations` and open the latest calculation again.
                    </p>
                  )}

                  {hasWarnings && (
                    <p className={styles.nextStepText}>
                      HMRC has returned warnings. Review your obligations and quarterly submissions
                      to make sure there are no missing updates before relying on this result.
                    </p>
                  )}

                  {hasErrors && (
                    <p className={styles.nextStepText}>
                      You need to complete all required submissions before HMRC can calculate your
                      tax. Go to obligations and submit missing periods.
                    </p>
                  )}

                  <div className={styles.nextStepActions}>
                    <Link href="/hmrc-obligations" className={styles.secondaryBtn}>
                      Review obligations
                    </Link>

                    <Link href="/hmrc-submit" className={styles.primaryBtn}>
                      Submit next update
                    </Link>
                  </div>
                </div>
              )}

              {selectedCalculation.errors?.length > 0 ? (
                <div className={styles.messageStack}>
                  {infoMessages.length > 0 && (
                    <div className={styles.infoBlock}>
                      <h3>Info</h3>
                      <div className={styles.messageList}>
                        {infoMessages.map((item, index) => (
                          <div key={`info-${item.id}-${index}`} className={styles.messageItem}>
                            <strong>Information</strong>
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
                          <div key={`warning-${item.id}-${index}`} className={styles.messageItem}>
                            <strong>Warning</strong>
                            <p>{simplifyMessage(item.text)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {errorMessages.length > 0 && (
                    <div className={styles.errorBlock}>
                      <h3>Errors</h3>
                      <div className={styles.messageList}>
                        {errorMessages.map((item, index) => (
                          <div key={`error-${item.id}-${index}`} className={styles.messageItem}>
                            <strong>Error</strong>
                            <p>{simplifyMessage(item.text)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.payloadBlock}>
                  <h3>Calculation output</h3>
                  <pre>{JSON.stringify({
                    incomeSources: selectedCalculation.incomeSources,
                    allowances: selectedCalculation.allowances,
                    submissionDate: selectedCalculation.submissionDate
                  }, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
