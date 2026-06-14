import AppLayout from '../components/AppLayout'
import '../styles/globals.css'
import { useRouter } from 'next/router'

const NO_LAYOUT = ['/', '/login', '/signup']

export default function App({ Component, pageProps }) {
  const router = useRouter()
  // Invoice view pages render without the sidebar so they print cleanly
  const showLayout = !NO_LAYOUT.includes(router.pathname) && !router.pathname.startsWith('/invoices/')

  if (showLayout) {
    return (
      <AppLayout>
        <Component {...pageProps} />
      </AppLayout>
    )
  }

  return <Component {...pageProps} />
}
