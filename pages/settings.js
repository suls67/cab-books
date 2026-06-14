import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getCurrentDriver } from '../lib/driverAuth'
import { supabase } from '../supabaseClient'
import styles from '../styles/settings.module.css'

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function getInitials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
}

export default function Settings() {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const d = await getCurrentDriver(supabase)
        setDriver(d)
        setForm({ name: d.name || '', phone: d.phone || '', address: d.address || '' })
      } catch (err) {
        const text = err instanceof Error ? err.message : ''
        if (text === 'No signed-in user was found') router.push('/login')
      }
    }
    load()
  }, [router])

  function startEdit() {
    setForm({ name: driver.name || '', phone: driver.phone || '', address: driver.address || '' })
    setError('')
    setSaved(false)
    setEditingProfile(true)
  }

  function cancelEdit() {
    setEditingProfile(false)
    setError('')
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required.'); return }

    setIsSaving(true)
    setError('')

    const { error: saveError } = await supabase
      .from('drivers')
      .update({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
      })
      .eq('id', driver.id)

    setIsSaving(false)

    if (saveError) { setError(`Could not save: ${saveError.message}`); return }

    setDriver(d => ({ ...d, name: form.name.trim(), phone: form.phone.trim() || null, address: form.address.trim() || null }))
    setEditingProfile(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!driver) return null

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.avatar}>{getInitials(driver.name)}</div>
        <div>
          <h1 className={styles.pageTitle}>{driver.name}</h1>
          <p className={styles.pageSubtitle}>Taxi driver</p>
        </div>
        {saved && <span className={styles.savedMsg}>✓ Changes saved</span>}
      </div>

      {/* Profile information section */}
      <div className={styles.sectionTitle}>Profile information</div>
      <div className={styles.cardsRow}>

        {/* Details card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Personal details</span>
            {!editingProfile && (
              <button className={styles.editLink} onClick={startEdit}>
                <EditIcon /> Edit details
              </button>
            )}
          </div>

          {editingProfile ? (
            <form onSubmit={handleSave}>
              {error && <div className={styles.errorBanner}>{error}</div>}

              <div className={styles.field}>
                <label className={styles.label}>Full name <span className={styles.req}>*</span></label>
                <input className={styles.input} type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Phone</label>
                <input className={styles.input} type="tel" placeholder="07700 900000" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Address</label>
                <p className={styles.hint}>Each line will appear separately on your invoices.</p>
                <textarea className={`${styles.input} ${styles.textarea}`}
                  placeholder={'24 Abc Road\nLeicester\nLE5 4AH'}
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  rows={4} />
              </div>
              <div className={styles.formActions}>
                <button className={styles.saveBtn} type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save changes'}
                </button>
                <button className={styles.cancelBtn} type="button" onClick={cancelEdit}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className={styles.detailsList}>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Name</span>
                <span className={styles.detailValue}>{driver.name || '—'}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Phone</span>
                <span className={styles.detailValue}>{driver.phone || <span className={styles.notSet}>Not set</span>}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Address</span>
                <span className={styles.detailValue}>
                  {driver.address
                    ? driver.address.split('\n').map((line, i) => <span key={i} className={styles.addressLine}>{line}</span>)
                    : <span className={styles.notSet}>Not set</span>
                  }
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Account card */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Account</span>
          </div>
          <div className={styles.detailsList}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Email</span>
              <span className={styles.detailValue}>{driver.email || '—'}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Role</span>
              <span className={styles.detailValue}>Taxi driver</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
