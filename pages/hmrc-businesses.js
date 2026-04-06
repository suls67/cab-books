import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/hmrc-businesses.module.css'

export default function HmrcBusinesses() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [businesses, setBusinesses] = useState([])
  const [status, setStatus] = useState({ type: '', text: '' })
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

  async function handleFetchBusinesses() {
    setStatus({ type: '', text: '' })
    setIsLoading(true)

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    if (!accessToken) {
      setStatus({ type: 'error', text: 'You need to be signed in before fetching businesses.' })
      setIsLoading(false)
      return
    }

    const response = await fetch('/api/hmrc/listBusinesses', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = await response.json()

    if (!response.ok) {
      setStatus({
        type: 'error',
        text: data.error || 'Could not fetch businesses from HMRC.'
      })
      setBusinesses([])
      setIsLoading(false)
      return
    }

    const businessList = data.listOfBusinesses || []

    setBusinesses(businessList)
    setStatus({
      type: 'success',
      text: businessList.length > 0
        ? 'Businesses fetched successfully from HMRC.'
        : 'HMRC returned no businesses for this driver.'
    })
    setIsLoading(false)
  }

  return (
    <div className={styles.container}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>HMRC businesses</p>
            <h1>Fetch business details</h1>
            <p className={styles.subtitle}>
              Use the saved HMRC token to load the businesses linked to this driver.
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

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleFetchBusinesses}
              disabled={isLoading || !driver?.nino}
            >
              {isLoading ? 'Fetching businesses...' : 'Fetch businesses'}
            </button>

            <Link href="/hmrc" className={styles.secondaryBtn}>
              Back
            </Link>
          </div>

          {businesses.length > 0 && (
            <div className={styles.results}>
              <div className={styles.resultsHeader}>
                <p className={styles.sectionEyebrow}>Results</p>
                <h2>Businesses from HMRC</h2>
              </div>

              <div className={styles.businessList}>
                {businesses.map((business, index) => (
                  <div
                    key={business.businessId || `${business.typeOfBusiness}-${index}`}
                    className={styles.businessCard}
                  >
                    <div>
                      <span className={styles.label}>Business ID</span>
                      <strong>{business.businessId || 'Not provided'}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>Type</span>
                      <strong>{business.typeOfBusiness || 'Not provided'}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>Trading name</span>
                      <strong>{business.tradingName || business.businessName || 'Not provided'}</strong>
                    </div>

                    <div>
                      <span className={styles.label}>Start date</span>
                      <strong>{business.tradingStartDate || 'Not provided'}</strong>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.nextStep}>
                <p className={styles.nextStepText}>
                  Once the business details look right, fetch the HMRC obligations for this driver.
                </p>
                <Link href="/hmrc-obligations" className={styles.nextStepLink}>
                  View obligations
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
