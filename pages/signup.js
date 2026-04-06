import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { supabase } from '../supabaseClient'
import styles from '../styles/login.module.css'

export default function Signup() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState({ type: '', text: '' })
  const [isLoading, setIsLoading] = useState(false)

  async function handleSignup(event) {
    event.preventDefault()
    setMessage({ type: '', text: '' })

    if (!username.trim() || !email.trim() || !password.trim()) {
      setMessage({ type: 'error', text: 'Complete all fields before creating your account.' })
      return
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setIsLoading(true)

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim()

    const { data: existingDriver, error: existingDriverError } = await supabase
      .from('drivers')
      .select('id')
      .or(`email.eq.${normalizedEmail},name.eq.${normalizedUsername}`)
      .maybeSingle()

    if (existingDriverError) {
      setMessage({
        type: 'error',
        text: `Could not check existing accounts: ${existingDriverError.message}`
      })
      setIsLoading(false)
      return
    }

    if (existingDriver) {
      setMessage({
        type: 'error',
        text: 'An account with that email or username already exists.'
      })
      setIsLoading(false)
      return
    }

    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password
    })

    if (signupError) {
      setMessage({ type: 'error', text: signupError.message })
      setIsLoading(false)
      return
    }

    if (!signupData.user) {
      setMessage({
        type: 'error',
        text: 'The account was created, but no user record was returned.'
      })
      setIsLoading(false)
      return
    }

    const { error: driverError } = await supabase
      .from('drivers')
      .insert([{
        name: normalizedUsername,
        email: normalizedEmail,
        auth_user_id: signupData.user.id
      }])

    if (driverError) {
      setMessage({
        type: 'error',
        text: `Your login was created, but the driver profile could not be saved: ${driverError.message}`
      })
      setIsLoading(false)
      return
    }

    setMessage({
      type: 'success',
      text: 'Account created successfully. Redirecting to profile setup...'
    })

    router.push('/profile')
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Create your CabBooks account</h1>
        <p className={styles.subtitle}>
          We&apos;ll create your secure login and your linked driver profile together.
        </p>

        <form onSubmit={handleSignup} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="username">Driver username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Choose a username"
              autoComplete="username"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@email.com"
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a password"
              autoComplete="new-password"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
          </div>

          {message.text && (
            <p className={message.type === 'error' ? styles.error : styles.success}>
              {message.text}
            </p>
          )}

          <button type="submit" className={styles.button} disabled={isLoading}>
            {isLoading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className={styles.link}>
          Already registered? <Link href="/login">Sign in here</Link>
        </p>

        <p className={styles.back}>
          <Link href="/">Back to home</Link>
        </p>
      </div>
    </div>
  )
}
