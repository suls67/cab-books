import Link from 'next/link'
import { useRouter } from 'next/router'
import styles from '../styles/dashboard.module.css'
import { startTransition, useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'


export default function Dashboard() {
  const router = useRouter()
  const [view, setView] = useState('week')
  const [driver, setDriver] = useState(null)
  const [entries, setEntries] = useState([])
  const [status, setStatus] = useState({ type: '', message: '' })

  useEffect(() => {
    async function loadEntries() {
      let currentDriver

      try {
        currentDriver = await getCurrentDriver(supabase)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not resolve the current driver'

        if (message === 'No signed-in user was found') {
          router.push('/login')
          return
        }

        startTransition(() => {
          setStatus({ type: 'error', message })
        })
        return
      }

      const { data, error } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('driver_id', currentDriver.id)
        .order('created_at', { ascending: false })

      if (error) {
        startTransition(() => {
          setStatus({ type: 'error', message: `Could not load entries: ${error.message}` })
        })
        return
      }

      startTransition(() => {
        setDriver(currentDriver)
        setEntries(data || [])
        setStatus(current =>
          current.type === 'error' ? current : { type: '', message: '' }
        )
      })
    }

    loadEntries()
  }, [router])

  const now = new Date()

  const filtered = entries.filter((entry) => {
    const date = new Date(entry.date)

    if (view === 'week') {
      const start = new Date()
      start.setDate(now.getDate() - now.getDay())
      return date >= start
    }

    if (view === 'month') {
      return (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      )
    }

    if (view === 'quarter') {
      const quarter = Math.floor(now.getMonth() / 3)
      return (
        Math.floor(date.getMonth() / 3) === quarter &&
        date.getFullYear() === now.getFullYear()
      )
    }

    if (view === 'year') {
      return date.getFullYear() === now.getFullYear()
    }

    return true
  })

  const income = filtered.reduce((sum, entry) => sum + Number(entry.income || 0), 0)
  const expense = filtered.reduce((sum, entry) => sum + Number(entry.expense || 0), 0)
  const net = income - expense
  const incomeEntryCount = filtered.filter((entry) => Number(entry.income || 0) > 0).length
  const totalIncomeAllTime = entries.reduce(
    (sum, entry) => sum + Number(entry.income || 0),
    0
  )
  const totalExpenseAllTime = entries.reduce(
    (sum, entry) => sum + Number(entry.expense || 0),
    0
  )
  const latestEntry = entries[0]
  const recentEntries = entries.slice(0, 5)
  const averageIncome = income / (incomeEntryCount || 1)
  const totalMileage = filtered.reduce((sum, entry) => sum + Number(entry.mileage || 0), 0)
  const viewLabels = {
    week: 'This week',
    month: 'This month',
    quarter: 'This quarter',
    year: 'This year'
  }

  const formatCurrency = (value) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(value || 0)

  const formatDate = (value) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value))

return (
  <div className={styles.container}>
    <div className={styles.shell}>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Operations overview</p>
          <h1 className={styles.title}>Driver dashboard</h1>
          <p className={styles.subtitle}>
            {driver
              ? `Track fares, monitor activity, and keep ${driver.name}'s bookkeeping in one place.`
              : "Track fares, monitor activity, and keep this period's bookkeeping in one place."}
          </p>
        </div>

        <div className={styles.heroPanel}>
          <span className={styles.heroPanelLabel}>Current view</span>
          <strong>{viewLabels[view]}</strong>
          <span className={styles.heroPanelMeta}>
            {latestEntry ? `Last entry on ${formatDate(latestEntry.date)}` : 'No entries saved yet'}
          </span>
        </div>
      </div>

      {status.message && (
        <div
          className={status.type === 'error' ? styles.statusError : styles.statusSuccess}
        >
          {status.message}
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.toggle}>
          {['week', 'month', 'quarter', 'year'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={view === v ? styles.active : styles.tab}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <button
          className={styles.logout}
          onClick={async () => {
            await supabase.auth.signOut()
            router.push('/login')
          }}
        >
          Logout
        </button>
      </div>

      <div className={styles.metricGrid}>
        <div className={styles.metricPrimary}>
          <span className={styles.metricLabel}>Income collected</span>
          <h2>{formatCurrency(income)}</h2>
          <p>{viewLabels[view]} across {incomeEntryCount} paid entries</p>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Net position</span>
          <h3 className={net >= 0 ? styles.netPositive : styles.netNegative}>
            {formatCurrency(net)}
          </h3>
          <p>{viewLabels[view]} income minus recorded expenses.</p>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Mileage logged</span>
          <h3>{totalMileage.toFixed(1)} mi</h3>
          <p>Useful once trip logging is fully connected to each day.</p>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>All-time totals</span>
          <h3>{formatCurrency(totalIncomeAllTime - totalExpenseAllTime)}</h3>
          <p>{entries.length} total records stored in `daily_logs`.</p>
        </div>
      </div>

      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Period summary</p>
              <h3>{viewLabels[view]}</h3>
            </div>
          </div>

          <div className={styles.statList}>
            <div className={styles.statRow}>
              <span>Entries in range</span>
              <strong>{filtered.length}</strong>
            </div>

            <div className={styles.statRow}>
              <span>Average income</span>
              <strong className={styles.netPositive}>{formatCurrency(averageIncome)}</strong>
            </div>

            <div className={styles.statRow}>
              <span>Total expenses</span>
              <strong className={styles.netNegative}>{formatCurrency(expense)}</strong>
            </div>

            <div className={styles.statRow}>
              <span>Latest activity</span>
              <strong>{latestEntry ? formatDate(latestEntry.date) : 'No activity yet'}</strong>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Actions</p>
              <h3>Add a new record</h3>
            </div>
          </div>

          <div className={styles.actions}>
            <Link href="/add-income" className={styles.incomeBtn}>
              + Add income
            </Link>

            <Link href="/add-expense" className={styles.expenseBtn}>
              − Add expense
            </Link>
          </div>

          <div className={styles.helperCard}>
            <span className={styles.helperLabel}>Current setup</span>
            <div className={styles.profilePrompt}>
              <p>
                {driver?.nino
                  ? 'Your profile is set up. You can still review or change your NINO details any time.'
                  : 'Your NINO has not been added yet. Complete your profile before continuing with HMRC-related steps.'}
              </p>
              <Link href="/profile" className={styles.profileLink}>
                {driver?.nino ? 'Manage profile' : 'Add NINO'}
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.tablePanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Recent records</p>
            <h3>Latest activity</h3>
          </div>
        </div>

        {recentEntries.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Income</th>
                  <th>Expense</th>
                  <th>Mileage</th>
                </tr>
              </thead>
              <tbody>
                {recentEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.date)}</td>
                    <td className={styles.netPositive}>{formatCurrency(Number(entry.income || 0))}</td>
                    <td className={styles.netNegative}>{formatCurrency(Number(entry.expense || 0))}</td>
                    <td>{Number(entry.mileage || 0).toFixed(1)} mi</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h4>No records yet</h4>
            <p>Add your first income or expense entry to start building the dashboard history.</p>
          </div>
        )}
      </section>

      <section className={styles.hmrcSection}>
        <div className={styles.hmrcCopy}>
          <p className={styles.sectionEyebrow}>HMRC</p>
          <h3>Connect your tax account</h3>
          <p>
            Link your HMRC account from a dedicated page before moving on to business lookup,
            obligations, and quarterly submissions.
          </p>
        </div>

        <Link href="/hmrc" className={styles.hmrcLink}>
          Open HMRC workspace
        </Link>
      </section>
    </div>
  </div>
)
}
