import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/dashboard.module.css'

const PERIOD_LABELS = { week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This tax year' }

function getTaxYearBounds(date = new Date()) {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const startYear = (m > 3 || (m === 3 && d >= 6)) ? y : y - 1
  return {
    start: new Date(startYear, 3, 6),
    end: new Date(startYear + 1, 3, 5, 23, 59, 59)
  }
}

function filterEntries(entries, view) {
  const now = new Date()
  return entries.filter(e => {
    const d = new Date(e.date)
    if (view === 'week') {
      const start = new Date(now)
      start.setDate(now.getDate() - now.getDay())
      start.setHours(0, 0, 0, 0)
      return d >= start
    }
    if (view === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    if (view === 'quarter') {
      const q = Math.floor(now.getMonth() / 3)
      return Math.floor(d.getMonth() / 3) === q && d.getFullYear() === now.getFullYear()
    }
    if (view === 'year') {
      const { start, end } = getTaxYearBounds()
      return d >= start && d <= end
    }
    return true
  })
}

const fmt = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0)
const fmtDate = v => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(v))

export default function Dashboard() {
  const router = useRouter()
  const [view, setView] = useState('month')
  const [driver, setDriver] = useState(null)
  const [entries, setEntries] = useState([])
  const [hmrcConnected, setHmrcConnected] = useState(null)
  const [status, setStatus] = useState({ type: '', text: '' })

  useEffect(() => {
    async function load() {
      let currentDriver
      try {
        currentDriver = await getCurrentDriver(supabase)
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not load your profile.'
        if (text === 'No signed-in user was found') { router.push('/login'); return }
        setStatus({ type: 'error', text })
        return
      }

      setDriver(currentDriver)

      const [entriesResult, hmrcResult] = await Promise.all([
        supabase.from('entries').select('*').eq('driver_id', currentDriver.id).order('date', { ascending: false }),
        supabase.from('hmrc_tokens').select('id').eq('driver_id', currentDriver.id).limit(1).maybeSingle()
      ])

      if (entriesResult.error) {
        setStatus({ type: 'error', text: `Could not load entries: ${entriesResult.error.message}` })
      } else {
        setEntries(entriesResult.data || [])
      }

      setHmrcConnected(!!hmrcResult.data)
    }
    load()
  }, [router])

  const filtered = filterEntries(entries, view)
  const income = filtered.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0)
  const expense = filtered.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
  const net = income - expense
  const entryCount = filtered.length
  const recentEntries = entries.slice(0, 8)

  const allIncome = entries.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0)
  const allExpense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className={styles.page}>
      {status.type === 'error' && <div className={styles.error}>{status.text}</div>}

      {/* Period selector */}
      <div className={styles.periodRow}>
        <div className={styles.periodTabs}>
          {Object.entries(PERIOD_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`${styles.periodTab} ${view === key ? styles.periodTabActive : ''}`}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric cards */}
      <div className={styles.metricGrid}>
        <div className={`${styles.metricCard} ${styles.metricCardGreen}`}>
          <div className={styles.metricLabel}>Income</div>
          <div className={styles.metricValue}>{fmt(income)}</div>
          <div className={styles.metricSub}>{PERIOD_LABELS[view].toLowerCase()}</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Expenses</div>
          <div className={`${styles.metricValue} ${styles.metricNegative}`}>{fmt(expense)}</div>
          <div className={styles.metricSub}>{PERIOD_LABELS[view].toLowerCase()}</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Net profit</div>
          <div className={`${styles.metricValue} ${net >= 0 ? styles.metricPositive : styles.metricNegative}`}>
            {fmt(net)}
          </div>
          <div className={styles.metricSub}>income minus expenses</div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Entries</div>
          <div className={styles.metricValue}>{entryCount}</div>
          <div className={styles.metricSub}>{PERIOD_LABELS[view].toLowerCase()}</div>
        </div>
      </div>

      {/* Content grid */}
      <div className={styles.contentGrid}>
        {/* Recent transactions */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <div className={styles.cardEyebrow}>Latest</div>
              <div className={styles.cardTitle}>Recent transactions</div>
            </div>
            <Link href="/transactions" className={styles.viewAll}>View all</Link>
          </div>

          {recentEntries.length > 0 ? (
            <div className={styles.txList}>
              {recentEntries.map(entry => (
                <div key={entry.id} className={styles.txRow}>
                  <div className={`${styles.txDot} ${entry.type === 'income' ? styles.txDotIncome : styles.txDotExpense}`} />
                  <div className={styles.txInfo}>
                    <div className={styles.txDescription}>{entry.description || entry.category || (entry.type === 'income' ? 'Income' : 'Expense')}</div>
                    <div className={styles.txMeta}>{fmtDate(entry.date)} · {entry.category}</div>
                  </div>
                  <div className={`${styles.txAmount} ${entry.type === 'income' ? styles.txAmountIncome : styles.txAmountExpense}`}>
                    {entry.type === 'income' ? '+' : '-'}{fmt(entry.amount)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>📋</div>
              <div className={styles.emptyTitle}>No transactions yet</div>
              <div className={styles.emptySub}>Add your first income or expense entry to get started.</div>
              <Link href="/transactions" className={styles.addIncomeBtn} style={{ display: 'inline-flex', marginTop: 4 }}>
                Add transaction
              </Link>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className={styles.rightPanel}>
          {/* Quick actions */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>Quick add</div>
            </div>
            <div className={styles.quickActions}>
              <Link href="/transactions?add=income" className={styles.addIncomeBtn}>
                + Add income
              </Link>
              <Link href="/transactions?add=expense" className={styles.addExpenseBtn}>
                − Add expense
              </Link>
            </div>
          </div>

          {/* All-time summary */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>All time</div>
                <div className={styles.cardTitle}>Totals</div>
              </div>
            </div>
            <div className={styles.statList}>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Total income</span>
                <span className={`${styles.statValue} ${styles.metricPositive}`}>{fmt(allIncome)}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Total expenses</span>
                <span className={`${styles.statValue} ${styles.metricNegative}`}>{fmt(allExpense)}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Net profit</span>
                <span className={`${styles.statValue} ${allIncome - allExpense >= 0 ? styles.metricPositive : styles.metricNegative}`}>{fmt(allIncome - allExpense)}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>Entries logged</span>
                <span className={styles.statValue}>{entries.length}</span>
              </div>
            </div>
          </div>

          {/* HMRC status */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.cardEyebrow}>HMRC</div>
                <div className={styles.cardTitle}>Income Tax (MTD)</div>
              </div>
            </div>
            <div className={styles.hmrcBody}>
              {hmrcConnected === null ? (
                <div className={styles.hmrcCardSub}>Checking connection...</div>
              ) : hmrcConnected ? (
                <>
                  <div className={styles.hmrcConnectedBadge}>✓ Connected</div>
                  <div className={styles.hmrcManageRow}>
                    <span className={styles.hmrcNextDeadline}>Manage your MTD submissions</span>
                    <Link href="/hmrc" className={styles.hmrcManageLink}>Open →</Link>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.hmrcCardSub}>
                    Connect your HMRC account to submit quarterly updates and manage your Making Tax Digital obligations.
                  </div>
                  <div className={styles.hmrcSteps}>
                    <div className={styles.hmrcStep}>
                      <div className={styles.hmrcStepNum}>1</div>
                      <div>
                        <div className={styles.hmrcStepTitle}>Sign up for MTD on HMRC</div>
                        <div className={styles.hmrcStepDesc}>Register at HMRC's website if you haven't already</div>
                      </div>
                    </div>
                    <div className={styles.hmrcStep}>
                      <div className={styles.hmrcStepNum}>2</div>
                      <div>
                        <div className={styles.hmrcStepTitle}>Connect CabBooks to HMRC</div>
                        <div className={styles.hmrcStepDesc}>Grant permission to submit on your behalf</div>
                      </div>
                    </div>
                  </div>
                  <Link href="/connect-hmrc" className={styles.hmrcConnectBtn}>
                    Connect to HMRC
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
