import { useRouter } from 'next/router'
import { useCallback, useEffect, useState } from 'react'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/transactions.module.css'

const INCOME_CATEGORIES = ['Fares (cash)', 'Fares (card)', 'App fares (Uber/Bolt)', 'Private hire', 'Airport run', 'School run', 'Account work', 'Other income']
const EXPENSE_CATEGORIES = [
  'Badge renewal',
  'Car Rent',
  'Car Wash',
  'Finance payments',
  'Fines',
  'Fuel',
  'Insurance',
  'Lease Payments',
  'MOT',
  'Phone Contracts',
  'Repairs',
  'Road tax',
  'Service',
  'Tolls',
  'Vehicle Licence renewal',
  'Parking',
  'Food/Snacks',
  'Other',
]

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const fmt = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0)
const fmtDate = v => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v))

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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  )
}

const now = new Date()

export default function Transactions() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [entries, setEntries] = useState([])
  const [filter, setFilter] = useState('all')
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [showModal, setShowModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [form, setForm] = useState({
    type: 'income',
    amount: '',
    category: '',
    description: '',
    date: new Date().toISOString().split('T')[0]
  })

  const loadEntries = useCallback(async (driverId) => {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('driver_id', driverId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (!error) setEntries(data || [])
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const currentDriver = await getCurrentDriver(supabase)
        setDriver(currentDriver)
        await loadEntries(currentDriver.id)
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not load your profile.'
        if (text === 'No signed-in user was found') router.push('/login')
      }
    }
    init()
  }, [router, loadEntries])

  // Open modal pre-filled from query param (?add=income or ?add=expense)
  useEffect(() => {
    if (router.query.add === 'income' || router.query.add === 'expense') {
      setForm(f => ({ ...f, type: router.query.add }))
      setShowModal(true)
    }
  }, [router.query.add])

  function prevMonth() {
    setMonth(m => {
      if (m.month === 0) return { year: m.year - 1, month: 11 }
      return { year: m.year, month: m.month - 1 }
    })
  }

  function nextMonth() {
    setMonth(m => {
      if (m.month === 11) return { year: m.year + 1, month: 0 }
      return { year: m.year, month: m.month + 1 }
    })
  }

  const isCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth()

  function openModal(type = 'income') {
    setForm({ type, amount: '', category: '', description: '', date: new Date().toISOString().split('T')[0] })
    setFormError('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setFormError('')
    if (router.query.add) router.replace('/transactions', undefined, { shallow: true })
  }

  async function handleSave() {
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError('Enter a valid amount greater than 0.')
      return
    }
    if (!form.category) {
      setFormError('Select a category.')
      return
    }

    setIsSaving(true)
    setFormError('')

    const { error } = await supabase.from('entries').insert([{
      driver_id: driver.id,
      type: form.type,
      amount: Number(form.amount),
      category: form.category,
      description: form.description || null,
      date: form.date
    }])

    setIsSaving(false)

    if (error) {
      setFormError(`Could not save: ${error.message}`)
      return
    }

    closeModal()
    await loadEntries(driver.id)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('entries').delete().eq('id', id)
    await loadEntries(driver.id)
  }

  // Filter entries to the selected month
  const monthEntries = entries.filter(e => {
    const d = new Date(e.date)
    return d.getFullYear() === month.year && d.getMonth() === month.month
  })

  const filtered = filter === 'all' ? monthEntries : monthEntries.filter(e => e.type === filter)
  const totalIncome = monthEntries.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount), 0)
  const totalExpense = monthEntries.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount), 0)
  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {/* Month navigator */}
          <div className={styles.monthNav}>
            <button className={styles.monthNavBtn} onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft />
            </button>
            <span className={styles.monthLabel}>
              {MONTH_NAMES[month.month]} {month.year}
            </span>
            <button
              className={styles.monthNavBtn}
              onClick={nextMonth}
              disabled={isCurrentMonth}
              aria-label="Next month"
            >
              <ChevronRight />
            </button>
          </div>

          {/* Filter tabs */}
          <div className={styles.filterTabs}>
            {[['all', 'All'], ['income', 'Income'], ['expense', 'Expenses']].map(([key, label]) => (
              <button
                key={key}
                className={`${styles.filterTab} ${filter === key ? styles.filterTabActive : ''} ${key === 'income' ? styles.filterTabIncome : ''} ${key === 'expense' ? styles.filterTabExpense : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button className={styles.addBtn} onClick={() => openModal('income')}>
          + Add transaction
        </button>
      </div>

      {/* Summary */}
      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Income</div>
          <div className={`${styles.summaryValue} ${styles.summaryIncome}`}>{fmt(totalIncome)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Expenses</div>
          <div className={`${styles.summaryValue} ${styles.summaryExpense}`}>{fmt(totalExpense)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>Net profit</div>
          <div className={`${styles.summaryValue} ${styles.summaryNet}`}>{fmt(totalIncome - totalExpense)}</div>
        </div>
      </div>

      {/* Transaction list */}
      <div className={styles.listCard}>
        <div className={styles.listHeader}>
          <div className={`${styles.listHeaderDate} ${styles.listHeaderLabel}`}>Date</div>
          <div className={`${styles.listHeaderDesc} ${styles.listHeaderLabel}`}>Description</div>
          <div className={`${styles.listHeaderCategory} ${styles.listHeaderLabel}`}>Category</div>
          <div className={`${styles.listHeaderAmount} ${styles.listHeaderLabel}`}>Amount</div>
          <div className={styles.listHeaderActions} />
        </div>

        {filtered.length > 0 ? (
          filtered.map(entry => (
            <div key={entry.id} className={styles.txRow}>
              <div className={styles.txDateCol}>
                <span className={styles.txDate}>{fmtDate(entry.date)}</span>
              </div>
              <div className={styles.txDescCol}>
                <span className={entry.description ? styles.txDescription : `${styles.txDescription} ${styles.txDescriptionEmpty}`}>
                  {entry.description || '—'}
                </span>
              </div>
              <div className={styles.txCategoryCol}>
                <span className={`${styles.txCategoryBadge} ${entry.type === 'income' ? styles.txCategoryIncome : styles.txCategoryExpense}`}>
                  {entry.category}
                </span>
              </div>
              <div className={styles.txAmountCol}>
                <span className={`${styles.txAmount} ${entry.type === 'income' ? styles.txAmountIncome : styles.txAmountExpense}`}>
                  {entry.type === 'income' ? '+' : '-'}{fmt(entry.amount)}
                </span>
              </div>
              <div className={styles.txActionsCol}>
                <button className={styles.deleteBtn} onClick={() => handleDelete(entry.id)} title="Delete">
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>💳</div>
            <div className={styles.emptyTitle}>
              No {filter === 'all' ? '' : filter + ' '}entries for {MONTH_NAMES[month.month]} {month.year}
            </div>
            <div className={styles.emptySub}>
              Use the arrows to browse other months, or add a new entry.
            </div>
            <button className={styles.addBtn} onClick={() => openModal(filter === 'expense' ? 'expense' : 'income')}>
              + Add {filter === 'expense' ? 'expense' : 'income'}
            </button>
          </div>
        )}
      </div>

      {/* Add transaction modal */}
      {showModal && (
        <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Add transaction</span>
              <button className={styles.closeBtn} onClick={closeModal}><CloseIcon /></button>
            </div>

            {/* Type toggle */}
            <div className={styles.typeToggle}>
              <button
                className={`${styles.typeBtn} ${form.type === 'income' ? styles.typeBtnIncomeActive : ''}`}
                onClick={() => setForm(f => ({ ...f, type: 'income', category: '' }))}
              >
                Income
              </button>
              <button
                className={`${styles.typeBtn} ${form.type === 'expense' ? styles.typeBtnExpenseActive : ''}`}
                onClick={() => setForm(f => ({ ...f, type: 'expense', category: '' }))}
              >
                Expense
              </button>
            </div>

            {formError && <div className={styles.formError}>{formError}</div>}

            {/* Amount */}
            <div className={styles.field}>
              <label className={styles.label}>Amount</label>
              <div className={styles.amountInput}>
                <span className={styles.amountPrefix}>£</span>
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  autoFocus
                />
              </div>
            </div>

            <div className={styles.fieldRow}>
              {/* Category */}
              <div className={styles.field}>
                <label className={styles.label}>Category</label>
                <select
                  className={styles.select}
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  <option value="">Select...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Date */}
              <div className={styles.field}>
                <label className={styles.label}>Date</label>
                <input
                  className={styles.input}
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
            </div>

            {/* Description */}
            <div className={styles.field}>
              <label className={styles.label}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <input
                className={styles.input}
                type="text"
                placeholder={form.type === 'income' ? 'e.g. Evening fares, Heathrow run' : 'e.g. Shell garage, MOT at garage'}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className={styles.formActions}>
              <button
                className={`${styles.saveBtn} ${form.type === 'income' ? styles.saveBtnIncome : styles.saveBtnExpense}`}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : `Save ${form.type}`}
              </button>
              <button className={styles.cancelBtn} onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
