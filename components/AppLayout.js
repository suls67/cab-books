import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import styles from '../styles/layout.module.css'

const PAGE_TITLES = {
  '/dashboard': 'Home',
  '/transactions': 'Transactions',
  '/customers': 'Customers',
  '/invoices': 'Invoices',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/hmrc': 'Income Tax',
  '/connect-hmrc': 'Connect HMRC',
  '/hmrc-obligations': 'Obligations',
  '/hmrc-submit': 'Submit Update',
  '/hmrc-calculations': 'Tax Calculations',
  '/hmrc-final': 'Final Declaration',
  '/hmrc-adjustments': 'Adjustments',
  '/hmrc-annual': 'Annual Summary',
  '/hmrc-income-summary': 'Income Summary',
  '/hmrc-businesses': 'Business Details',
  '/profile': 'Profile',
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  )
}

function IconTransactions() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M7 16l-4-4 4-4M17 8l4 4-4 4M14 4l-4 16" />
    </svg>
  )
}

function IconCustomers() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  )
}

function IconInvoices() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 17h8v-1H8v1zm0-3h8v-1H8v1zm0-3h5V10H8v1z" />
    </svg>
  )
}

function IconReports() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function IconTax() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.1 7.1 0 00-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58a7 7 0 00-.09.94c0 .31.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

const MAIN_NAV = [
  { href: '/dashboard', label: 'Home', Icon: IconHome },
  { href: '/transactions', label: 'Transactions', Icon: IconTransactions },
  { href: '/customers', label: 'Customers', Icon: IconCustomers },
  { href: '/invoices', label: 'Invoices', Icon: IconInvoices },
  { href: '/reports', label: 'Reports', Icon: IconReports },
]

const BOTTOM_NAV = [
  { href: '/hmrc', label: 'Income Tax', Icon: IconTax },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
]

const MOBILE_NAV = [
  { href: '/dashboard', label: 'Home', Icon: IconHome },
  { href: '/transactions', label: 'Transactions', Icon: IconTransactions },
  { href: '/customers', label: 'Customers', Icon: IconCustomers },
  { href: '/hmrc', label: 'Tax', Icon: IconTax },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
]

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function AppLayout({ children }) {
  const router = useRouter()
  const [driver, setDriver] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    async function loadDriver() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data } = await supabase
        .from('drivers')
        .select('id, name, nino')
        .eq('auth_user_id', session.user.id)
        .maybeSingle()

      if (data) setDriver(data)
    }
    loadDriver()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const pageTitle = PAGE_TITLES[router.pathname] || 'CabBooks'
  const initials = getInitials(driver?.name)

  function NavItem({ href, label, Icon }) {
    const isActive = router.pathname === href || (href !== '/dashboard' && router.pathname.startsWith(href))
    return (
      <Link
        href={href}
        className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
        onClick={() => setSidebarOpen(false)}
      >
        <span className={styles.navIcon}><Icon /></span>
        {label}
      </Link>
    )
  }

  return (
    <div className={styles.shell}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>
          <div className={styles.brandName}>CabBooks</div>
          <div className={styles.brandTagline}>Making Tax Digital</div>
        </div>

        <nav className={styles.nav}>
          <div className={styles.navGroup}>
            {MAIN_NAV.map(item => (
              <NavItem key={item.href} {...item} />
            ))}
          </div>

          <div className={styles.navDivider} />

          <div className={styles.navGroup}>
            {BOTTOM_NAV.map(item => (
              <NavItem key={item.href} {...item} />
            ))}
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          {driver && (
            <div className={styles.userRow}>
              <div className={styles.avatar}>{initials}</div>
              <div className={styles.userInfo}>
                <div className={styles.userName}>{driver.name}</div>
                <div className={styles.userSub}>Taxi driver</div>
              </div>
            </div>
          )}
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <IconLogout /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main area */}
      <div className={styles.mainArea}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => setSidebarOpen(prev => !prev)}
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <IconClose /> : <IconMenu />}
            </button>
            <span className={styles.pageTitle}>{pageTitle}</span>
          </div>
          <div className={styles.topBarRight}>
            {driver && (
              <>
                <span className={styles.topBarUser}>{driver.name}</span>
                <div className={styles.topBarAvatar}>{initials}</div>
              </>
            )}
          </div>
        </header>

        <main className={styles.pageContent}>
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className={styles.mobileNav}>
        {MOBILE_NAV.map(({ href, label, Icon }) => {
          const isActive = router.pathname === href || (href !== '/dashboard' && router.pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.mobileNavItem} ${isActive ? styles.mobileNavItemActive : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
