import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getCurrentDriver } from '../../lib/driverAuth'
import { supabase } from '../../supabaseClient'
import styles from '../../styles/invoice-view.module.css'

const fmt = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v || 0)
const fmtDate = v => v ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v + 'T00:00:00')) : '—'
const fmtDateShort = v => v ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(v + 'T00:00:00')) : '—'

function buildShareText(invoice, driver) {
  const lines = []
  lines.push(`Invoice ${invoice.invoice_number}`)
  if (driver?.name) lines.push(`From: ${driver.name}`)
  lines.push(`To: ${invoice.customer_name}`)
  lines.push(`Date: ${fmtDateShort(invoice.date)}`)
  if (invoice.due_date) lines.push(`Due: ${fmtDateShort(invoice.due_date)}`)
  if (invoice.invoice_items?.length > 0) {
    lines.push('')
    invoice.invoice_items.forEach(item => {
      lines.push(`${item.description}: ${fmt(item.amount)}`)
    })
  }
  lines.push('')
  lines.push(`Total: ${fmt(invoice.total)}`)
  if (invoice.bank_name || invoice.bank_account_number) {
    lines.push('')
    lines.push('Payment details:')
    if (invoice.bank_name) lines.push(`Bank: ${invoice.bank_name}`)
    if (invoice.bank_account_name) lines.push(`Account Name: ${invoice.bank_account_name}`)
    if (invoice.bank_account_number) lines.push(`Account Number: ${invoice.bank_account_number}`)
    if (invoice.bank_sort_code) lines.push(`Sort Code: ${invoice.bank_sort_code}`)
  }
  return lines.join('\n')
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

export default function InvoiceView() {
  const router = useRouter()
  const { id } = router.query
  const [invoice, setInvoice] = useState(null)
  const [driver, setDriver] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    async function load() {
      try {
        const d = await getCurrentDriver(supabase)
        setDriver(d)
        const { data, error } = await supabase
          .from('invoices')
          .select('*, invoice_items(*)')
          .eq('id', id)
          .eq('driver_id', d.id)
          .single()
        if (error || !data) { router.push('/invoices'); return }
        setInvoice(data)
      } catch {
        router.push('/invoices')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, router])

  async function handleDownload() {
    const { default: html2canvas } = await import('html2canvas')
    const { default: jsPDF } = await import('jspdf')

    const element = document.getElementById('invoice-document')
    const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
    pdf.save(`${invoice.invoice_number}.pdf`)
  }

  function handleEmail() {
    const subject = encodeURIComponent(`Invoice ${invoice.invoice_number}`)
    const body = encodeURIComponent(buildShareText(invoice, driver))
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  function handleWhatsApp() {
    const text = encodeURIComponent(buildShareText(invoice, driver))
    window.open(`https://wa.me/?text=${text}`)
  }

  if (loading) {
    return <div className={styles.loading}>Loading invoice...</div>
  }

  if (!invoice) return null

  const hasBank = invoice.bank_name || invoice.bank_account_name || invoice.bank_account_number || invoice.bank_sort_code

  return (
    <div className={styles.page}>

      {/* Action bar — hidden on print */}
      <div className={styles.actionBar}>
        <button className={styles.backBtn} onClick={() => router.push('/invoices')}>
          ← Back to invoices
        </button>
        <div className={styles.actionBtns}>
          <button className={styles.shareBtn} onClick={handleEmail}>
            ✉ Email
          </button>
          <button className={styles.whatsappBtn} onClick={handleWhatsApp}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.99 2C6.477 2 2 6.477 2 11.99c0 1.785.467 3.466 1.284 4.926L2 22l5.232-1.268A9.953 9.953 0 0 0 11.99 22C17.523 22 22 17.523 22 11.99 22 6.477 17.523 2 11.99 2zm0 18.18a8.174 8.174 0 0 1-4.17-1.141l-.299-.177-3.1.812.827-3.022-.196-.31A8.17 8.17 0 0 1 3.82 11.99c0-4.508 3.663-8.17 8.17-8.17s8.17 3.662 8.17 8.17-3.662 8.17-8.17 8.17z"/></svg>
            WhatsApp
          </button>
          <button className={styles.downloadBtn} onClick={handleDownload}>
            <DownloadIcon /> Download PDF
          </button>
          <button className={styles.printBtn} onClick={() => window.print()}>
            <PrintIcon /> Print
          </button>
        </div>
      </div>

      {/* Invoice document */}
      <div id="invoice-document" className={styles.document}>

        {/* From block */}
        <div className={styles.docHeader}>
          <div className={styles.fromBlock}>
            <div className={styles.fromName}>{driver?.name}</div>
            {driver?.address
              ? driver.address.split('\n').map((line, i) => (
                  <div key={i} className={styles.fromDetail}>{line}</div>
                ))
              : <div className={styles.fromDetailMuted}>Add your address in Settings</div>
            }
            {driver?.phone
              ? <div className={styles.fromDetail}>Phone: {driver.phone}</div>
              : <div className={styles.fromDetailMuted}>Add your phone in Settings</div>
            }
          </div>
        </div>

        {/* Invoice To + Invoice # */}
        <div className={styles.metaRow}>
          <div className={styles.metaBlock}>
            <div className={styles.metaLabel}>Invoice To</div>
            <div className={styles.metaValue}>{invoice.customer_name}</div>
          </div>
          <div className={styles.metaBlock} style={{ textAlign: 'right' }}>
            <div className={styles.metaLabel}>Invoice #</div>
            <div className={styles.metaValue}>{invoice.invoice_number}</div>
            <div className={styles.metaSmall}>Date: {fmtDate(invoice.date)}</div>
            {invoice.due_date && <div className={styles.metaSmall}>Due: {fmtDate(invoice.due_date)}</div>}
          </div>
        </div>

        {/* Trips table */}
        {invoice.trips?.length > 0 && (
          <div className={styles.tripsSection}>
            <table className={styles.tripsTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Job No</th>
                  <th>Name</th>
                  <th>Pick Up</th>
                  <th>Drop Off</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {invoice.trips.map((trip, i) => (
                  <tr key={i}>
                    <td>{trip.date ? fmtDateShort(trip.date) : '—'}</td>
                    <td>{trip.job_no || '—'}</td>
                    <td>{trip.passenger_name || '—'}</td>
                    <td>{trip.pickup || '—'}</td>
                    <td>{trip.dropoff || '—'}</td>
                    <td>{trip.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.divider} />

        {/* Charges */}
        <div className={styles.chargesSection}>
          {invoice.invoice_items?.map(item => (
            <div key={item.id} className={styles.chargeRow}>
              <span className={styles.chargeDesc}>{item.description}</span>
              <span className={styles.chargeAmount}>{fmt(item.amount)}</span>
            </div>
          ))}
        </div>

        <div className={styles.divider} />

        {/* Totals */}
        <div className={styles.totalsSection}>
          <div className={styles.totalRow}>
            <span className={styles.subtotalLabel}>Subtotal</span>
            <span className={styles.subtotalValue}>{fmt(invoice.total)}</span>
          </div>
          <div className={styles.totalRowFinal}>
            <span className={styles.totalLabel}>Total</span>
            <span className={styles.totalValue}>{fmt(invoice.total)}</span>
          </div>
        </div>

        {/* Bank details */}
        {hasBank && (
          <div className={styles.bankSection}>
            <div className={styles.bankTitle}>Bank Details</div>
            {invoice.bank_name && (
              <div className={styles.bankRow}><span className={styles.bankLabel}>Bank</span><span className={styles.bankValue}>{invoice.bank_name}</span></div>
            )}
            {invoice.bank_account_name && (
              <div className={styles.bankRow}><span className={styles.bankLabel}>Account Name</span><span className={styles.bankValue}>{invoice.bank_account_name}</span></div>
            )}
            {invoice.bank_account_number && (
              <div className={styles.bankRow}><span className={styles.bankLabel}>Account Number</span><span className={styles.bankValue}>{invoice.bank_account_number}</span></div>
            )}
            {invoice.bank_sort_code && (
              <div className={styles.bankRow}><span className={styles.bankLabel}>Sort Code</span><span className={styles.bankValue}>{invoice.bank_sort_code}</span></div>
            )}
          </div>
        )}

        {/* Notes */}
        {invoice.notes && (
          <div className={styles.notesSection}>
            <div className={styles.notesText}>{invoice.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}
