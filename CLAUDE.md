@AGENTS.md

# Project: Taximate (CabBooks)

A Next.js app for taxi drivers to manage their HMRC Making Tax Digital (MTD) obligations.

## Stack
- Next.js (Pages Router)
- Supabase (auth + database)
- HMRC sandbox API (test-api.service.hmrc.gov.uk)

## Key user
- Single test driver with a NINO stored in the `drivers` table
- HMRC OAuth tokens stored in `hmrc_tokens` (one row per driver, upserted on conflict)

## HMRC MTD workflow (steps in order)
1. Connect to HMRC — `/connect-hmrc` → OAuth via `/api/hmrc/oauth` → callback at `/api/hmrc/callback`
2. Business details — `/hmrc-businesses` → `/api/hmrc/listBusinesses`
3. Obligations — `/hmrc-obligations` → `/api/hmrc/obligations`
4. Submit quarterly update — `/hmrc-submit` → `/api/hmrc/submitIncome` (cumulative YTD figures)
5. Annual submission — `/hmrc-annual` → `/api/hmrc/annualSubmission` (trading income allowance)
6. Accounting adjustments (BSAS) — `/hmrc-adjustments` → `/api/hmrc/adjustments`
7. Income summary (BISS) — `/hmrc-income-summary` → `/api/hmrc/incomeSummary`
8. Tax calculations — `/hmrc-calculations` → `/api/hmrc/calculations`
9. Final declaration — `/hmrc-final` → `/api/hmrc/finalDeclaration`

## Where we left off (session: 2026-06-10)

### Test user (current)
- **Name**: Sidney Quirke
- **NINO**: YJ631833A (saved to Supabase `drivers` table)
- **MTD Income Tax ID**: XPIT00878209303
- **businessId**: XBIS12345678901 (DEFAULT canned value — returned by business list with DEFAULT scenario)
- **Login**: User ID `316489526302` / Password `myal12nY3pR3`
- **Obligations**: HMRC sandbox returns 2018-19 dates for all test users via `Gov-Test-Scenario: DEFAULT` — hardcoded test data, not tied to the specific user

### Cumulative submission — now working with DEFAULT
- The root bug was the HTTP method: cumulative endpoint is **PUT** not POST. Confirmed from HMRC Developer Hub.
- DEFAULT scenario for the cumulative PUT endpoint returns a simulated success response (204).
- STATEFUL was attempted but Create Test User API does NOT create a self-employment business in the STATEFUL environment. Business list with STATEFUL returns empty for all dynamically created test users.
- To use STATEFUL properly: must use the **Self Assessment Test Support API → "Create a Test Business"** endpoint first to register a business in the STATEFUL store. Not yet implemented.
- For now: all endpoints use DEFAULT. STATEFUL is a future improvement.

### Gov-Test-Scenario per endpoint (current state)
| Endpoint | Scenario |
|---|---|
| Business details list | DEFAULT |
| Obligations | DEFAULT |
| Cumulative GET | DEFAULT |
| Cumulative PUT | DEFAULT |
| BSAS trigger | DEFAULT |
| BSAS retrieve | SELF_EMPLOYMENT_PROFIT |
| BSAS submit | DEFAULT |
| All other endpoints | DEFAULT |

### BSAS (adjustable summary) — confirmed working
- Trigger: `POST .../trigger` — send `typeOfBusiness`, `businessId`, `taxYear`, `accountingPeriod` (inline: startDate `{year}-04-06`, endDate `{year+1}-04-05`). DEFAULT returns canned `calculationId: 717f3a7a-db8e-11e9-8a34-2a2ae2dbcce4`.
- Retrieve: `GET .../self-employment/{calculationId}/{taxYear}` — must use `SELF_EMPLOYMENT_PROFIT` scenario (DEFAULT returns "no data found").
- Submit: `POST .../self-employment/{calculationId}/adjust/{taxYear}` — `income.turnover` must always be present even if 0 (omitting it causes `RULE_INCORRECT_OR_EMPTY_BODY_SUBMITTED`). Fixed in `pages/api/hmrc/adjustments.js`.

### Supabase period date fix (important)
`hmrc_submissions` stores **original obligation dates** (2018-19) in `period_start`/`period_end`, NOT the shifted 2025-26 dates sent to HMRC. The shifted dates are stored inside `hmrc_response.hmrcPeriodStartDate/EndDate` for reference.

This is required because `isPeriodSubmitted()` compares `submission.period_start === period.start` where `period.start` comes from the obligations API (2018-19 dates). If we stored shifted dates, the match would never succeed and every period would always look open.

### Current Supabase state (session: 2026-06-10)
`hmrc_submissions` has 2 rows (correct period dates):
- id 21: Q2 (2018-07-06 → 2018-10-05), cumulative turnover 5000, expenses 1000
- id 22: Q3 (2018-10-06 → 2019-01-05), cumulative turnover 11000, expenses 2200
- Q4 also submitted this session (cumulative total: £43,000 turnover, £8,400 expenses)

### Known cosmetic bug (low priority)
"Submitted income so far" in the `/hmrc-submit` review section shows £0.00 for Q3+ because the HMRC cumulative GET (DEFAULT scenario) returns canned data with 0 turnover, and `hmrcBaseTurnover = 0` overrides the Supabase value via `??`. The **actual submission is correct** — the API reads from Supabase directly and calculates the right cumulative. Fix: prefer `previousSubmission` (Supabase) over `currentHmrcSummary` in the `previousTurnover` derivation on `hmrc-submit.js` lines 274-281.

### Completed (session: 2026-06-10, continued)
All 9 steps of the HMRC MTD workflow are now fully tested end-to-end:
- Q1–Q4 quarterly submissions ✓
- Annual submission ✓
- BSAS trigger, retrieve, submit ✓ (submit tested; turnover field is adjusted total, not delta)
- Income summary (BISS) ✓ — display fixed: response uses `total.income`, `profit.net` etc. not `totalIncome.turnover`
- Tax calculations ✓ — DEFAULT always returns validation error messages (canned); status saves as `error` not `complete`
- Final declaration ✓ — submitted to HMRC, correlation ID `ce0df992-52f6-4ac3-afee-c6f937cda2f3`

### Fixes applied this session
- `pages/hmrc-income-summary.js`: updated field mapping to match actual BISS v3 response shape
- `pages/api/hmrc/finalDeclaration.js`: preflight obligations check now reads Supabase `hmrc_submissions` count (>= 3) instead of HMRC API (DEFAULT returns canned unfulfilled data); preflight calculation check now accepts `status = 'error'` as well as `complete`; Supabase save uses `upsert` instead of `insert` to handle DEFAULT returning duplicate `calculationId`

### Current Supabase state (session: 2026-06-10, end)
`hmrc_submissions` has 3 rows (Q2, Q3, Q4 — Q1 submitted to HMRC but not saved to Supabase):
- id 21: Q2 (2018-07-06 → 2018-10-05), cumulative turnover 5000, expenses 1000
- id 22: Q3 (2018-10-06 → 2019-01-05), cumulative turnover 11000, expenses 2200
- Q4: (2019-01-06 → 2019-04-05), cumulative turnover 43000, expenses 8400
`hmrc_calculations` has final-declaration record with `calculation_id: c75dbb53-6237-49e2-b05a-60ef221f0260`

## HMRC API versions confirmed
- Business details list: `application/vnd.hmrc.2.0+json`
- BISS (income summary): `application/vnd.hmrc.3.0+json`
- BSAS (adjustable summary trigger/retrieve/submit): `application/vnd.hmrc.7.0+json`
- Annual submission (create/amend/retrieve): `application/vnd.hmrc.5.0+json`
- Cumulative period summary (retrieve/create/amend): `application/vnd.hmrc.5.0+json`
- Calculations: `application/vnd.hmrc.8.0+json`

## Cumulative submission model (confirmed from HMRC docs)
- Endpoint: **`PUT`** `.../self-employment/{nino}/{businessId}/cumulative/{taxYear}` — 2025-26 onwards only
- `periodStartDate` is always `{year}-04-06`, never changes
- `periodEndDate` is the obligation period end date — year-shifted to match the submitted `taxYear` via `shiftEndDateToTaxYear()`
- Figures are always cumulative YTD totals, not just the quarter's figures
- Each submission replaces the previous — no separate amend flow
- Payload uses nested format: `periodDates`, `periodIncome`, `periodExpenses`

## Key decisions
- Tax years are always entered by the user or derived from obligation dates — never hardcoded
- Submit page shows derived tax year but allows manual override (needed because sandbox obligations return 2018-19 dates)
- Only non-zero fields are sent in BSAS adjustment payloads
- OAuth scope `read:self-assessment write:self-assessment` requested at connect time — covers all current endpoints
- HMRC is the source of truth for submitted data — retrieve endpoints used instead of Supabase where possible
- `hmrc_submissions.period_start/end` = original obligation dates (for matching), shifted HMRC dates stored in `hmrc_response` only

## App redesign (session: 2026-06-11)

Full Sage Business Cloud-inspired UI has been built. Dark sidebar (#111827), white content area, green accents (#4ade80 / #16a34a). CSS Modules throughout (no Tailwind).

### App shell
- `components/AppLayout.js` — sidebar + top bar wrapping all authenticated pages
- `styles/layout.module.css` — layout styles including mobile bottom nav
- `pages/_app.js` — imports globals.css, wraps all non-auth pages in AppLayout; invoice view pages (`/invoices/[id]`) excluded from AppLayout for clean print layout
- `styles/globals.css` — base reset and font stack
- Driver loaded via `getDriverByAuthUserId` using `auth_user_id` (NOT `user_id` — that column doesn't exist)
- NO_LAYOUT pages: `['/','login','signup']` + any path starting with `/invoices/`

### Pages built
| Route | File | Status |
|---|---|---|
| /dashboard | pages/dashboard.js | Full — reads `entries` table |
| /transactions | pages/transactions.js | Full — full CRUD on `entries`, monthly pagination |
| /customers | pages/customers.js | Full — Active/Inactive tabs, add/edit/delete, type badges |
| /reports | pages/reports.js | Stub — "coming soon" |
| /invoices | pages/invoices.js | Full — All/Draft/Sent/Paid/Overdue tabs, create/edit modal with trips + line items + bank details, print icon per row |
| /invoices/[id] | pages/invoices/[id].js | Full — printable view, Email/WhatsApp/Download PDF/Print actions |
| /settings | pages/settings.js | Full — Sage-style card layout, editable Personal details card, read-only Account card |

### Database schema
Key schema gotchas:
- `drivers.id` is BIGINT (integer), not UUID — all foreign keys must use BIGINT
- `drivers.auth_user_id` is the UUID column linking to auth.users — NOT `user_id`

**SQL migrations run in Supabase:**
- `sql/007_create_entries.sql` — entries table (BIGINT driver_id, auth_user_id in RLS) ✓
- `sql/008_create_customers.sql` — customers table ✓
- `sql/009_create_invoices.sql` — invoices + invoice_items tables ✓
- `sql/010_add_invoice_trips_and_bank.sql` — trips (JSONB), bank_name, bank_account_name, bank_account_number, bank_sort_code columns on invoices ✓
- **PENDING**: `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone TEXT; ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT;` — must be run in Supabase before Settings edit or invoice print view shows driver address/phone

```
entries (id BIGSERIAL, driver_id BIGINT, type TEXT, amount DECIMAL(10,2), category TEXT, description TEXT, date DATE)
customers (id BIGSERIAL, driver_id BIGINT, name TEXT, phone TEXT, email TEXT, type TEXT, area TEXT, notes TEXT, status TEXT)
invoices (id BIGSERIAL, driver_id BIGINT, invoice_number TEXT, customer_name TEXT, customer_email TEXT, date DATE, due_date DATE, status TEXT, notes TEXT, total DECIMAL(10,2), trips JSONB, bank_name TEXT, bank_account_name TEXT, bank_account_number TEXT, bank_sort_code TEXT)
invoice_items (id BIGSERIAL, invoice_id BIGINT, description TEXT, amount DECIMAL(10,2))
```

### Transaction categories
- Income: Fares (cash), Fares (card), App fares (Uber/Bolt), Private hire, Airport run, School run, Account work, Other income
- Expenses (updated 2026-06-12): Badge renewal, Car Rent, Car Wash, Finance payments, Fines, Fuel, Insurance, Lease Payments, MOT, Phone Contracts, Repairs, Road tax, Service, Tolls, Vehicle Licence renewal, Parking, Food/Snacks, Other

### Transactions — monthly pagination
- All entries fetched once; filtered client-side by `{ year, month }` state
- `prevMonth()` / `nextMonth()` handlers; next disabled at current month
- Month navigator displayed in toolbar with chevron arrows

### Customers page
- Active/Inactive tabs; initials avatar; type badges (Private hire=blue, Account work=amber, School=green, Business=purple)
- Add/edit modal; toggle active/inactive; delete with confirmation

### Invoices page
- Status tabs: All / Draft / Sent / Paid / Overdue
- Create/edit modal: customer (free-text, not linked to customers table), date, due date, status, trips (optional card layout per trip), line items (charges), bank details, notes
- Trips fields per card: Date, Job No, Passenger Name, Pick Up, Drop Off, Description — all optional
- Print icon on each row opens `/invoices/[id]`

### Invoice print view (`/invoices/[id]`)
- Excluded from AppLayout — renders as standalone page
- Action bar (hidden on print): Back, Email (mailto), WhatsApp (wa.me), Download PDF (jspdf + html2canvas), Print
- Shows driver name + address + phone at top (reads from `drivers` table via driverAuth)
- **NINO must NEVER appear on invoices** — this is a hard rule
- PDF: dynamic import of jspdf + html2canvas to avoid loading on every page
- `id="invoice-document"` on document div for html2canvas capture

### Settings page
- Page header: green initials avatar, driver name, "Taxi driver" subtitle
- "Profile information" section heading with divider
- Two-card grid: Personal details (editable name/phone/address) | Account (read-only email/role)
- Display mode with "Edit details" button → inline form → save/cancel
- Saves to `drivers` table; "✓ Changes saved" flash for 3 seconds
- **NINO must NEVER appear in Settings** — this is a hard rule

### Dashboard features
- Period filter: week / month / quarter / year (using tax year bounds)
- Metric cards: total income, total expenses, net profit, entry count
- Recent transactions list (last 8 entries)
- Right panel: quick-add buttons, all-time stats, HMRC status card (reads `hmrc_tokens`)

### lib/driverAuth.js
- `getDriverByEmail` selects: `id, name, email, nino, phone, address`
- `getDriverByAuthUserId` selects: `id, name, email, nino, auth_user_id, phone, address`

## Next steps (pick up here next session)
1. **Run pending SQL** — `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone TEXT; ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT;` in Supabase
2. **Reports page** — income vs expenses charts, category breakdowns, tax year summaries
3. **AI receipt scanning** — camera/upload on transactions page to auto-fill amount/category
4. **Subscription/payment** — user onboarding and payment gate
5. **(Optional)** Fix cosmetic "Submitted income so far: £0.00" bug in `/hmrc-submit` — prefer `previousSubmission` (Supabase) over `currentHmrcSummary` in `previousTurnover` derivation on `hmrc-submit.js` lines 274-281
6. **Future improvement**: implement Self Assessment Test Support API → "Create a Test Business" to enable STATEFUL testing
