import Link from 'next/link'
import { useState } from 'react'
import { supabase } from '../supabaseClient'
import styles from '../styles/login.module.css'

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogin(event) {
    event.preventDefault()
    setErrorMessage('')

    if (!identifier.trim() || !password.trim()) {
      setErrorMessage('Enter your username or email and your password.')
      return
    }

    setIsLoading(true)

    let email = identifier.trim()

    if (!email.includes('@')) {
      const { data: driver, error: driverError } = await supabase
        .from('drivers')
        .select('email')
        .ilike('name', email)
        .maybeSingle()

      if (driverError) {
        setErrorMessage(`Could not look up username: ${driverError.message}`)
        setIsLoading(false)
        return
      }

      if (!driver?.email) {
        setErrorMessage('No account was found for that username.')
        setIsLoading(false)
        return
      }

      email = driver.email
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    setIsLoading(false)

    if (error) {
      setErrorMessage(error.message)
    } else {
      window.location.href = '/dashboard'
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* <p className={styles.eyebrow}>Taxi bookkeeping</p> */}
        <h1 className={styles.title}>Sign in to CabBooks</h1>
        <p className={styles.subtitle}>Use your email or your driver username to continue.</p>

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="identifier">Username or Email</label>
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="drivername or name@email.com"
              autoComplete="username"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <button type="submit" className={styles.button} disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Login'}
          </button>
        </form>

        <p className={styles.link}>
          New here? <Link href="/signup">Create your account.</Link>
        </p>

        <p className={styles.back}>
          <Link href="/">Back to home</Link>
        </p>
      </div>
    </div>
  )
}
