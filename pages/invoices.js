import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/invoices.module.css'

const STATUS_TABS = ['all', 'draft', 'sent', 'paid', 'overdue']
const STATUS_LABELS = { all: 'All', draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue' }

const fmt = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0)
const fmtDate = v => v ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v)) : '—'

function padInvoiceNumber(n) { return `INV-${String(n).padStart(3, '0')}` }
function today() { return new Date().toISOString().split('T')[0] }
function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function TrashIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={size} height={size}>
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

const BLANK_ITEM = { description: '', amount: '' }
const BLANK_TRIP = { date: '', job_no: '', passenger_name: '', pickup: '', dropoff: '', description: '' }

function blankForm(nextNumber, dateStr) {
  return {
    invoice_number: padInvoiceNumber(nextNumber),
    customer_id: '',
    customer_name: '',
    date: dateStr,
    due_date: addDays(dateStr, 30),
    notes: '',
    items: [{ ...BLANK_ITEM }],
    trips: [],
    bank_name: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_sort_code: '',
  }
}

export default function Invoices() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [tab, setTab] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadInvoices = useCallback(async (driverId) => {
    const { data } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('driver_id', driverId)
      .order('date', { ascending: false })
    setInvoices(data || [])
  }, [])

  const loadCustomers = useCallback(async (driverId) => {
    const { data } = await supabase
      .from('customers')
      .select('id, name')
      .eq('driver_id', driverId)
      .eq('status', 'active')
      .order('name')
    setCustomers(data || [])
  }, [])

  useEffect(() => {
    async function init() {
      try {
        const d = await getCurrentDriver(supabase)
        setDriver(d)
        await Promise.all([loadInvoices(d.id), loadCustomers(d.id)])
      } catch (err) {
        const text = err instanceof Error ? err.message : ''
        if (text === 'No signed-in user was found') router.push('/login')
      }
    }
    init()
  }, [router, loadInvoices, loadCustomers])

  function openNew() {
    const nextNum = invoices.length + 1
    setEditing(null)
    setForm(blankForm(nextNum, today()))
    setFormError('')
    setShowModal(true)
  }

  function openEdit(invoice) {
    setEditing(invoice)
    setForm({
      invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_id || '',
      customer_name: invoice.customer_name,
      date: invoice.date,
      due_date: invoice.due_date || '',
      notes: invoice.notes || '',
      items: invoice.invoice_items?.length > 0
        ? invoice.invoice_items.map(i => ({ id: i.id, description: i.description, amount: String(i.amount) }))
        : [{ ...BLANK_ITEM }],
      trips: invoice.trips?.length > 0 ? invoice.trips : [],
      bank_name: invoice.bank_name || '',
      bank_account_name: invoice.bank_account_name || '',
      bank_account_number: invoice.bank_account_number || '',
      bank_sort_code: invoice.bank_sort_code || '',
    })
    setFormError('')
    setShowModal(true)
  }

  function closeModal() { setShowModal(false); setEditing(null); setFormError('') }

  function setItem(i, field, value) {
    setForm(f => { const items = [...f.items]; items[i] = { ...items[i], [field]: value }; return { ...f, items } })
  }
  function addItem() { setForm(f => ({ ...f, items: [...f.items, { ...BLANK_ITEM }] })) }
  function removeItem(i) { setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })) }

  function setTrip(i, field, value) {
    setForm(f => { const trips = [...f.trips]; trips[i] = { ...trips[i], [field]: value }; return { ...f, trips } })
  }
  function addTrip() { setForm(f => ({ ...f, trips: [...f.trips, { ...BLANK_TRIP }] })) }
  function removeTrip(i) { setForm(f => ({ ...f, trips: f.trips.filter((_, idx) => idx !== i) })) }

  function onCustomerChange(customerId) {
    const customer = customers.find(c => String(c.id) === customerId)
    setForm(f => ({ ...f, customer_id: customerId, customer_name: customer ? customer.name : f.customer_name }))
  }

  const formTotal = (form?.items || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)

  async function handleSave() {
    if (!form.customer_name.trim()) { setFormError('Customer name is required.'); return }
    if (!form.invoice_number.trim()) { setFormError('Invoice number is required.'); return }
    if (form.items.length === 0 || form.items.every(i => !i.description.trim())) {
      setFormError('Add at least one line item.'); return
    }

    setIsSaving(true)
    setFormError('')

    const invoicePayload = {
      driver_id: driver.id,
      invoice_number: form.invoice_number.trim(),
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      customer_name: form.customer_name.trim(),
      date: form.date,
      due_date: form.due_date || null,
      notes: form.notes.trim() || null,
      total: formTotal,
      trips: form.trips.filter(t => t.date || t.job_no || t.passenger_name || t.pickup || t.dropoff),
      bank_name: form.bank_name.trim() || null,
      bank_account_name: form.bank_account_name.trim() || null,
      bank_account_number: form.bank_account_number.trim() || null,
      bank_sort_code: form.bank_sort_code.trim() || null,
    }

    let invoiceId = editing?.id

    if (editing) {
      const { error } = await supabase.from('invoices').update(invoicePayload).eq('id', editing.id)
      if (error) { setFormError(`Could not save: ${error.message}`); setIsSaving(false); return }
      await supabase.from('invoice_items').delete().eq('invoice_id', editing.id)
    } else {
      const { data, error } = await supabase.from('invoices').insert([{ ...invoicePayload, status: 'draft' }]).select().single()
      if (error) { setFormError(`Could not save: ${error.message}`); setIsSaving(false); return }
      invoiceId = data.id
    }

    const itemRows = form.items
      .filter(i => i.description.trim())
      .map(i => ({ invoice_id: invoiceId, description: i.description.trim(), amount: parseFloat(i.amount) || 0 }))

    if (itemRows.length > 0) {
      const { error } = await supabase.from('invoice_items').insert(itemRows)
      if (error) { setFormError(`Could not save items: ${error.message}`); setIsSaving(false); return }
    }

    setIsSaving(false)
    closeModal()
    await loadInvoices(driver.id)
  }

  async function handleStatusChange(invoice, newStatus) {
    await supabase.from('invoices').update({ status: newStatus }).eq('id', invoice.id)
    await loadInvoices(driver.id)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this invoice?')) return
    await supabase.from('invoices').delete().eq('id', id)
    await loadInvoices(driver.id)
  }

  const visible = tab === 'all' ? invoices : invoices.filter(i => i.status === tab)
  const counts = STATUS_TABS.reduce((acc, s) => {
    acc[s] = s === 'all' ? invoices.length : invoices.filter(i => i.status === s).length
    return acc
  }, {})

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Invoices</h1>
          <p className={styles.pageSubtitle}>Create and send invoices to your customers.</p>
        </div>
        <button className={styles.addBtn} onClick={openNew}>+ New invoice</button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {STATUS_TABS.map(s => (
          <button
            key={s}
            className={`${styles.tab} ${tab === s ? styles.tabActive : ''}`}
            onClick={() => setTab(s)}
          >
            {STATUS_LABELS[s]}
            {counts[s] > 0 && <span className={styles.tabCount}>{counts[s]}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div className={styles.listCard}>
        {visible.length > 0 ? (
          <>
            <div className={styles.listHeader}>
              <div className={styles.colNum}>Invoice #</div>
              <div className={styles.colCustomer}>Customer</div>
              <div className={styles.colDate}>Date</div>
              <div className={styles.colDue}>Due</div>
              <div className={styles.colAmount}>Amount</div>
              <div className={styles.colStatus}>Status</div>
              <div className={styles.colActions} />
            </div>
            {visible.map(inv => (
              <div key={inv.id} className={styles.row}>
                <div className={styles.colNum}><span className={styles.invoiceNum}>{inv.invoice_number}</span></div>
                <div className={styles.colCustomer}><span className={styles.customerName}>{inv.customer_name}</span></div>
                <div className={styles.colDate}><span className={styles.dateText}>{fmtDate(inv.date)}</span></div>
                <div className={styles.colDue}><span className={styles.dateText}>{fmtDate(inv.due_date)}</span></div>
                <div className={styles.colAmount}><span className={styles.amount}>{fmt(inv.total)}</span></div>
                <div className={styles.colStatus}>
                  <span className={`${styles.statusBadge} ${styles[`status_${inv.status}`]}`}>{STATUS_LABELS[inv.status]}</span>
                </div>
                <div className={styles.colActions}>
                  {inv.status === 'draft' && (
                    <button className={styles.actionBtn} onClick={() => handleStatusChange(inv, 'sent')} title="Mark as sent">✉</button>
                  )}
                  {inv.status === 'sent' && (
                    <button className={styles.actionBtn} onClick={() => handleStatusChange(inv, 'paid')} title="Mark as paid">✓</button>
                  )}
                  <button className={styles.actionBtn} onClick={() => window.open(`/invoices/${inv.id}`, '_blank')} title="View / Print">
                    <PrintIcon />
                  </button>
                  <button className={styles.actionBtn} onClick={() => openEdit(inv)} title="Edit"><EditIcon /></button>
                  <button className={`${styles.actionBtn} ${styles.actionBtnDelete}`} onClick={() => handleDelete(inv.id)} title="Delete"><TrashIcon /></button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📄</div>
            <div className={styles.emptyTitle}>{tab === 'all' ? 'No invoices yet' : `No ${STATUS_LABELS[tab].toLowerCase()} invoices`}</div>
            <div className={styles.emptySub}>{tab === 'all' ? 'Create your first invoice to get started.' : `Invoices marked as ${STATUS_LABELS[tab].toLowerCase()} will appear here.`}</div>
            {tab === 'all' && <button className={styles.addBtn} onClick={openNew}>+ New invoice</button>}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && form && (
        <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>{editing ? 'Edit invoice' : 'New invoice'}</span>
              <button className={styles.closeBtn} onClick={closeModal}><CloseIcon /></button>
            </div>

            {formError && <div className={styles.formError}>{formError}</div>}

            {/* Invoice number + date */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label}>Invoice number</label>
                <input className={styles.input} type="text" value={form.invoice_number}
                  onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Issue date</label>
                <input className={styles.input} type="date" value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
            </div>

            {/* Customer + due date */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label}>Customer</label>
                {customers.length > 0 && (
                  <select className={styles.select} value={form.customer_id} onChange={e => onCustomerChange(e.target.value)}
                    style={{ marginBottom: 6 }}>
                    <option value="">Select or type below...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <input className={styles.input} type="text" placeholder="Customer name" value={form.customer_name}
                  onChange={e => setForm(f => ({ ...f, customer_name: e.target.value, customer_id: '' }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Due date</label>
                <input className={styles.input} type="date" value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
            </div>

            {/* ── Trips section ── */}
            <div className={styles.sectionBlock}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Trips <span className={styles.optional}>(optional)</span></span>
                <button className={styles.addItemBtn} onClick={addTrip}><PlusIcon /> Add trip</button>
              </div>

              {form.trips.length > 0 && (
                <div className={styles.tripsList}>
                  {form.trips.map((trip, i) => (
                    <div key={i} className={styles.tripCard}>
                      <div className={styles.tripCardHeader}>
                        <span className={styles.tripCardLabel}>Trip {i + 1}</span>
                        <button className={styles.removeItemBtn} onClick={() => removeTrip(i)} title="Remove trip">
                          <TrashIcon />
                        </button>
                      </div>
                      <div className={styles.tripGrid}>
                        <div className={styles.tripField}>
                          <label className={styles.tripLabel}>Date</label>
                          <input className={styles.input} type="date" value={trip.date}
                            onChange={e => setTrip(i, 'date', e.target.value)} />
                        </div>
                        <div className={styles.tripField}>
                          <label className={styles.tripLabel}>Job No</label>
                          <input className={styles.input} type="text" placeholder="e.g. 2605260186"
                            value={trip.job_no} onChange={e => setTrip(i, 'job_no', e.target.value)} />
                        </div>
                        <div className={`${styles.tripField} ${styles.tripFieldFull}`}>
                          <label className={styles.tripLabel}>Passenger name</label>
                          <input className={styles.input} type="text" placeholder="e.g. Mr John Smith"
                            value={trip.passenger_name} onChange={e => setTrip(i, 'passenger_name', e.target.value)} />
                        </div>
                        <div className={`${styles.tripField} ${styles.tripFieldFull}`}>
                          <label className={styles.tripLabel}>Pick up</label>
                          <input className={styles.input} type="text" placeholder="e.g. 14 West View Ave, Leicester"
                            value={trip.pickup} onChange={e => setTrip(i, 'pickup', e.target.value)} />
                        </div>
                        <div className={`${styles.tripField} ${styles.tripFieldFull}`}>
                          <label className={styles.tripLabel}>Drop off</label>
                          <input className={styles.input} type="text" placeholder="e.g. Birmingham Airport"
                            value={trip.dropoff} onChange={e => setTrip(i, 'dropoff', e.target.value)} />
                        </div>
                        <div className={`${styles.tripField} ${styles.tripFieldFull}`}>
                          <label className={styles.tripLabel}>Notes</label>
                          <input className={styles.input} type="text" placeholder="e.g. Return journey, meet & greet"
                            value={trip.description} onChange={e => setTrip(i, 'description', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Charges (line items) ── */}
            <div className={styles.itemsSection}>
              <div className={styles.itemsHeader}>
                <span className={styles.label} style={{ margin: 0 }}>Charges</span>
              </div>
              <div className={styles.itemsHead}>
                <span className={styles.itemDescHead}>Description</span>
                <span className={styles.itemAmountHead}>Amount</span>
                <span style={{ width: 28 }} />
              </div>
              {form.items.map((item, i) => (
                <div key={i} className={styles.itemRow}>
                  <input className={`${styles.input} ${styles.itemDescInput}`} type="text"
                    placeholder="e.g. Fare, Parking, Waiting time"
                    value={item.description} onChange={e => setItem(i, 'description', e.target.value)} />
                  <div className={styles.amountWrap}>
                    <span className={styles.amountPrefix}>£</span>
                    <input className={`${styles.input} ${styles.itemAmountInput}`} type="number" step="0.01" min="0"
                      placeholder="0.00" value={item.amount} onChange={e => setItem(i, 'amount', e.target.value)} />
                  </div>
                  <button className={styles.removeItemBtn} onClick={() => removeItem(i)} disabled={form.items.length === 1} title="Remove">
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button className={styles.addItemBtn} onClick={addItem}><PlusIcon /> Add line item</button>
            </div>

            {/* Total */}
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Total</span>
              <span className={styles.totalValue}>{fmt(formTotal)}</span>
            </div>

            {/* ── Bank details ── */}
            <div className={styles.sectionBlock}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>Bank details <span className={styles.optional}>(optional)</span></span>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Bank</label>
                  <input className={styles.input} type="text" placeholder="e.g. Starling, Barclays"
                    value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Account name</label>
                  <input className={styles.input} type="text" placeholder="Name on account"
                    value={form.bank_account_name} onChange={e => setForm(f => ({ ...f, bank_account_name: e.target.value }))} />
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.label}>Account number</label>
                  <input className={styles.input} type="text" placeholder="12345678"
                    value={form.bank_account_number} onChange={e => setForm(f => ({ ...f, bank_account_number: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Sort code</label>
                  <input className={styles.input} type="text" placeholder="00-00-00"
                    value={form.bank_sort_code} onChange={e => setForm(f => ({ ...f, bank_sort_code: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className={styles.field}>
              <label className={styles.label}>Notes <span className={styles.optional}>(optional)</span></label>
              <textarea className={`${styles.input} ${styles.textarea}`}
                placeholder="e.g. Payment by BACS. Please quote invoice number."
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>

            <div className={styles.formActions}>
              <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : editing ? 'Save changes' : 'Create invoice'}
              </button>
              <button className={styles.cancelBtn} onClick={closeModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
