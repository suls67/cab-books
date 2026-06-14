import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/reports.module.css'

const INCOME_CATEGORIES = [
  'Fares (cash)', 'Fares (card)', 'App fares (Uber/Bolt)', 'Private hire',
  'Airport run', 'School run', 'Account work', 'Other income'
]
const EXPENSE_CATEGORIES = [
  'Badge renewal', 'Car Rent', 'Car Wash', 'Finance payments', 'Fines',
  'Fuel', 'Insurance', 'Lease Payments', 'MOT', 'Phone Contracts', 'Repairs',
  'Road tax', 'Service', 'Tolls', 'Vehicle Licence renewal', 'Parking',
  'Food/Snacks', 'Other'
]

const TAX_MONTH_INDICES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2]
const TAX_MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const fmt = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0)

function getCurrentTaxYear() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  return (m > 3 || (m === 3 && d >= 6)) ? y : y - 1
}

function getEntryTaxYear(dateStr) {
  const d = new Date(dateStr)
  const m = d.getMonth(), day = d.getDate(), y = d.getFullYear()
  return (m > 3 || (m === 3 && day >= 6)) ? y : y - 1
}

function getTaxYearBounds(year) {
  return { start: new Date(year, 3, 6), end: new Date(year + 1, 3, 5, 23, 59, 59) }
}

function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

const now = new Date()

export default function Reports() {
  const router = useRouter()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  const [period, setPeriod] = useState('year')
  const [taxYear, setTaxYear] = useState(getCurrentTaxYear())
  const [monthNav, setMonthNav] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [weekStart, setWeekStart] = useState(() => getWeekStart(now))

  useEffect(() => {
    async function init() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        const { data } = await supabase
          .from('entries')
          .select('*')
          .eq('driver_id', currentDriver.id)
          .order('date', { ascending: true })
        setEntries(data || [])
      } catch (err) {
        const text = err instanceof Error ? err.message : ''
        if (text === 'No signed-in user was found') router.push('/login')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router])

  // ── Navigation helpers ───────────────────────────────────────

  function prevMonthNav() {
    setMonthNav(m => m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 })
  }
  function nextMonthNav() {
    setMonthNav(m => m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 })
  }
  function prevWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() - 7); return n })
  }
  function nextWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(d.getDate() + 7); return n })
  }

  const isCurrentMonth = monthNav.year === now.getFullYear() && monthNav.month === now.getMonth()
  const isCurrentWeek = isSameDay(weekStart, getWeekStart(now))

  // ── Period entries ───────────────────────────────────────────

  const availableYears = [...new Set([getCurrentTaxYear(), ...entries.map(e => getEntryTaxYear(e.date))])].sort((a, b) => b - a)

  const { start: tyStart, end: tyEnd } = getTaxYearBounds(taxYear)
  const taxYearEntries = entries.filter(e => { const d = new Date(e.date); return d >= tyStart && d <= tyEnd })

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  weekEnd.setHours(23, 59, 59)

  const periodEntries =
    period === 'year' ? taxYearEntries :
    period === 'month' ? entries.filter(e => {
      const d = new Date(e.date)
      return d.getFullYear() === monthNav.year && d.getMonth() === monthNav.month
    }) :
    entries.filter(e => { const d = new Date(e.date); return d >= weekStart && d <= weekEnd })

  // ── Totals ───────────────────────────────────────────────────

  const totalIncome = periodEntries.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0)
  const totalExpense = periodEntries.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
  const netProfit = totalIncome - totalExpense

  // ── Chart data ───────────────────────────────────────────────

  let chartData = []
  if (period === 'year') {
    chartData = TAX_MONTH_INDICES.map((monthIdx, i) => {
      const yearOfMonth = monthIdx >= 3 ? taxYear : taxYear + 1
      const me = taxYearEntries.filter(e => {
        const d = new Date(e.date)
        return d.getFullYear() === yearOfMonth && d.getMonth() === monthIdx
      })
      return {
        label: TAX_MONTH_LABELS[i],
        showLabel: true,
        income: me.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0),
        expense: me.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0),
      }
    })
  } else if (period === 'month') {
    const daysInMonth = new Date(monthNav.year, monthNav.month + 1, 0).getDate()
    chartData = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const de = entries.filter(e => {
        const d = new Date(e.date)
        return d.getFullYear() === monthNav.year && d.getMonth() === monthNav.month && d.getDate() === day
      })
      return {
        label: String(day),
        showLabel: [1, 7, 14, 21, 28].includes(day) || day === daysInMonth,
        income: de.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0),
        expense: de.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0),
      }
    })
  } else {
    chartData = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + i)
      const de = entries.filter(e => isSameDay(new Date(e.date), date))
      return {
        label: WEEKDAY_LABELS[i],
        showLabel: true,
        income: de.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0),
        expense: de.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0),
      }
    })
  }

  const maxChartVal = Math.max(...chartData.map(m => Math.max(m.income, m.expense)), 1)

  // ── Category breakdowns ──────────────────────────────────────

  const incomeByCategory = INCOME_CATEGORIES
    .map(cat => ({ cat, total: periodEntries.filter(e => e.type === 'income' && e.category === cat).reduce((s, e) => s + Number(e.amount), 0) }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)

  const expenseByCategory = EXPENSE_CATEGORIES
    .map(cat => ({ cat, total: periodEntries.filter(e => e.type === 'expense' && e.category === cat).reduce((s, e) => s + Number(e.amount), 0) }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)

  // ── Labels ───────────────────────────────────────────────────

  const taxYearLabel = `${taxYear}–${String(taxYear + 1).slice(2)}`
  const weekRangeLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTH_SHORT[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${weekStart.getDate()} ${MONTH_SHORT[weekStart.getMonth()]}–${weekEnd.getDate()} ${MONTH_SHORT[weekEnd.getMonth()]} ${weekStart.getFullYear()}`

  const periodLabel =
    period === 'year' ? `Tax year ${taxYearLabel}` :
    period === 'month' ? `${MONTH_NAMES[monthNav.month]} ${monthNav.year}` :
    weekRangeLabel

  const chartTitle =
    period === 'year' ? 'Monthly overview' :
    period === 'month' ? 'Daily overview' :
    'Daily overview'

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>Loading reports...</div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>Reports</h1>
        <div className={styles.controls}>
          <div className={styles.periodTabs}>
            {['year', 'month', 'week'].map(p => (
              <button
                key={p}
                className={`${styles.periodTab} ${period === p ? styles.periodTabActive : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {period === 'year' && (
            <select
              className={styles.yearSelect}
              value={taxYear}
              onChange={e => setTaxYear(Number(e.target.value))}
            >
              {availableYears.map(y => (
                <option key={y} value={y}>{y}–{String(y + 1).slice(2)}</option>
              ))}
            </select>
          )}

          {period === 'month' && (
            <div className={styles.navPills}>
              <button className={styles.navArrow} onClick={prevMonthNav} aria-label="Previous month">
                <ChevronLeft />
              </button>
              <span className={styles.navLabel}>{MONTH_NAMES[monthNav.month]} {monthNav.year}</span>
              <button className={styles.navArrow} onClick={nextMonthNav} disabled={isCurrentMonth} aria-label="Next month">
                <ChevronRight />
              </button>
            </div>
          )}

          {period === 'week' && (
            <div className={styles.navPills}>
              <button className={styles.navArrow} onClick={prevWeek} aria-label="Previous week">
                <ChevronLeft />
              </button>
              <span className={styles.navLabel}>{weekRangeLabel}</span>
              <button className={styles.navArrow} onClick={nextWeek} disabled={isCurrentWeek} aria-label="Next week">
                <ChevronRight />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className={styles.metricGrid}>
        <div className={`${styles.metricCard} ${styles.metricCardGreen}`}>
          <div className={styles.metricLabel}>Total income</div>
          <div className={`${styles.metricValue} ${styles.colorIncome}`}>{fmt(totalIncome)}</div>
          <div className={styles.metricSub}>{periodLabel}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Total expenses</div>
          <div className={`${styles.metricValue} ${styles.colorExpense}`}>{fmt(totalExpense)}</div>
          <div className={styles.metricSub}>{periodLabel}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Net profit</div>
          <div className={`${styles.metricValue} ${netProfit >= 0 ? styles.colorIncome : styles.colorExpense}`}>{fmt(netProfit)}</div>
          <div className={styles.metricSub}>Income minus expenses</div>
        </div>
      </div>

      {/* Bar chart */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>{chartTitle}</div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotIncome}`} />Income
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendDotExpense}`} />Expenses
            </span>
          </div>
        </div>
        <div className={`${styles.chartArea} ${period === 'month' ? styles.chartAreaDense : ''}`}>
          {chartData.map(({ label, showLabel, income, expense }, idx) => (
            <div key={idx} className={styles.barGroup}>
              <div className={styles.bars}>
                {income > 0 && (
                  <div className={styles.barTip} data-tooltip={fmt(income)}>
                    <div
                      className={`${styles.bar} ${styles.barIncome}`}
                      style={{ height: `${Math.round((income / maxChartVal) * 160)}px` }}
                    />
                  </div>
                )}
                {expense > 0 && (
                  <div className={styles.barTip} data-tooltip={fmt(expense)}>
                    <div
                      className={`${styles.bar} ${styles.barExpense}`}
                      style={{ height: `${Math.round((expense / maxChartVal) * 160)}px` }}
                    />
                  </div>
                )}
              </div>
              <div className={`${styles.barLabel} ${!showLabel ? styles.barLabelHidden : ''}`}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category breakdowns */}
      <div className={styles.twoCol}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Income by category</div>
          {incomeByCategory.length === 0 ? (
            <div className={styles.emptyCategories}>No income recorded for {periodLabel.toLowerCase()}.</div>
          ) : (
            <div className={styles.categoryList}>
              {incomeByCategory.map(({ cat, total }) => (
                <div key={cat} className={styles.categoryRow}>
                  <div className={styles.catMeta}>
                    <span className={styles.catName}>{cat}</span>
                    <span className={styles.catAmount}>{fmt(total)}</span>
                  </div>
                  <div className={styles.catBarTrack}>
                    <div
                      className={`${styles.catBarFill} ${styles.catBarIncome}`}
                      style={{ width: `${Math.round((total / totalIncome) * 100)}%` }}
                    />
                  </div>
                  <div className={styles.catPct}>{Math.round((total / totalIncome) * 100)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Expenses by category</div>
          {expenseByCategory.length === 0 ? (
            <div className={styles.emptyCategories}>No expenses recorded for {periodLabel.toLowerCase()}.</div>
          ) : (
            <div className={styles.categoryList}>
              {expenseByCategory.map(({ cat, total }) => (
                <div key={cat} className={styles.categoryRow}>
                  <div className={styles.catMeta}>
                    <span className={styles.catName}>{cat}</span>
                    <span className={styles.catAmount}>{fmt(total)}</span>
                  </div>
                  <div className={styles.catBarTrack}>
                    <div
                      className={`${styles.catBarFill} ${styles.catBarExpense}`}
                      style={{ width: `${Math.round((total / totalExpense) * 100)}%` }}
                    />
                  </div>
                  <div className={styles.catPct}>{Math.round((total / totalExpense) * 100)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
