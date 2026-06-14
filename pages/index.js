import Link from 'next/link'
import styles from '../styles/home.module.css'

export default function Home() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>CabBooks</h1>

      <p className={styles.subtitle}>
        Making Tax Digital for Taxi Drivers
      </p>

      <p className={styles.description}>
        Simple income and expense tracking with automatic HMRC submissions. Built
        specifically for taxi drivers.
      </p>

      <div className={styles.buttons}>
        <Link href="/login" className={styles.login}>
          Login
        </Link>
        <Link href="/signup" className={styles.signup}>
          Sign Up Free
        </Link>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.icon}>📊</div>
          <h3>Track Income & Expenses</h3>
          <p>Manually enter your fares and costs throughout the quarter</p>
        </div>

        <div className={styles.card}>
          <div className={styles.icon}>📅</div>
          <h3>Quarterly Submissions</h3>
          <p>Submit to HMRC with one click when ready</p>
        </div>

        <div className={styles.card}>
          <div className={styles.icon}>✅</div>
          <h3>HMRC Compliant</h3>
          <p>Meets all Making Tax Digital requirements</p>
        </div>
      </div>
    </div>
  )
}
    


// import styles from '../styles/home.module.css'

// export default function Home() {
//   return (
//     <div className={styles.container}>

//       <h1 className={styles.title}>CabBooks</h1>

//       <p className={styles.subtitle}>
//         Making Tax Digital for Taxi Drivers
//       </p>

//       <p className={styles.description}>
//         Simple income and expense tracking with automatic HMRC submissions.
//         Built specifically for taxi drivers and private hire operators.
//       </p>

//       <div className={styles.buttons}>
//         <button className={styles.login}>Login</button>
//         <button className={styles.signup}>Sign Up Free</button>
//       </div>

//       <div className={styles.cards}>

//         <div className={styles.card}>
//           <div className={styles.icon}>📊</div>
//           <h3>Track Income & Expenses</h3>
//           <p>
//             Manually enter your fares and costs throughout the quarter
//           </p>
//         </div>

//         <div className={styles.card}>
//           <div className={styles.icon}>📅</div>
//           <h3>Quarterly Submissions</h3>
//           <p>
//             Submit to HMRC with one click when ready
//           </p>
//         </div>

//         <div className={styles.card}>
//           <div className={styles.icon}>✅</div>
//           <h3>HMRC Compliant</h3>
//           <p>
//             Meets all Making Tax Digital requirements
//           </p>
//         </div>

//       </div>

//     </div>
//   )
// }
