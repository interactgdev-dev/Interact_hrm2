# Interact HRM2 — Comprehensive Technical Report

**Document purpose:** Single reference for all major features, UI entry points, API routes, data flows, and **code-level mechanics** (kis feature ka implementation kahan aur kis order me chalta hai).

**Part A:** high-level modules and inventory. **Part B (§20):** deep technical walkthrough in **paragraph form** (Urdu/English mix) under numbered subheadings — tables hata kar descriptive flow rakha gaya hai.

**How to use this file as a Word document:** Open Microsoft Word → **File → Open** → select this `.md` file, or copy sections into a `.docx`. You can also print to PDF from Word or a Markdown viewer.

**Stack:** Next.js (App Router), React client components, MySQL (`mysql2` pool), server API routes under `app/api/*`.

**Repository root:** `interact-hrm2`

---

## 1. Executive Summary

The system is an internal HR / workforce management suite covering:

- **Authentication** (admin shortcut + employee DB login)
- **Employee lifecycle** (CRUD, import, contacts, jobs, emergency, credentials)
- **Time & attendance** (clock in/out, summaries, admin corrections, monthly views)
- **Breaks** (lunch/meal-style breaks) and **prayer breaks** (separate module)
- **Leaves** (request, approval, balances, allowances, calendar)
- **Shifts** (master definitions, per-employee assignments, related shift settings)
- **Payroll-related** (monthly payroll UI, salaries, advance, loan, commissions)
- **Company content** (policies, reminders, events)
- **Integrations / ops** (ZKBio sync, punch logs, Tungsten summaries, employment status automation)

**Critical cross-cutting behavior:**

- **Server timezone:** `Asia/Karachi` (`SERVER_TIMEZONE` in `lib/timezone.ts`). Many APIs and UIs normalize dates/times using this zone to avoid client PC timezone drift.
- **Concurrency:** Attendance clock-in, break start, and prayer break start use MySQL `GET_LOCK` / `RELEASE_LOCK` plus checks for existing open sessions to reduce duplicate taps.
- **Overnight shifts:** Shift assignment resolution for breaks/prayers uses `lib/get-active-shift.ts` (normal vs overnight continuation on next calendar day).

---

## 2. Application Surfaces (Who Sees What)

### 2.1 Admin / HR dashboard shell

- **Layout:** `app/layout-dashboard.tsx`
- **Navigation:** Static sidebar groups — **Main**, **HR** (PTO, Attendance, Recruitment, Onboard, Shifts, Payroll, Events, Departments, Roles & Permissions), **Personal** (My Info, Performance).
- **Auth pattern:** Client-side; pages assume user reached dashboard after login (see §3).

### 2.2 Employee self-service shell

- **Layout:** `app/employee-dashboard/layout.tsx`
- **Tabs:** Dashboard, My Info, Time, Leave (`/employee-dashboard`, `/employee-dashboard/my-info`, `/employee-dashboard/time`, `/employee-dashboard/leave`).
- **Additional employee route:** `app/employee-dashboard/my-credentials/page.tsx` (credentials management for employee).

### 2.3 Standalone / mixed routes

- **Auth:** `app/auth/page.tsx`, root `app/page.tsx` (legacy/alternate login)
- **Public-ish HR pages** used from admin sidebar: e.g. `/leave`, `/add-employee`, `/recruitment`, `/performance`, `/my-info`

---

## 3. Authentication & Session Model

### 3.1 Employee login

- **API:** `POST /api/employee-login` — `app/api/employee-login/route.ts`
- **Behavior:** Looks up `hrm_employees` joined with `employee_contacts` by username, work email, or numeric id. Password supports **bcrypt** hashes (`$2a$` / `$2b$`) or legacy **plain text** match. Inactive accounts rejected unless status is `active` or `enabled`.
- **Client:** `app/auth/page.tsx` stores `loginId` and `userRole` in `localStorage`, routes by role string (e.g. BOD/CEO → `/bod-dashboard`, HOD → `/hod-dashboard`, Management → `/management-dashboard`, Leader → `/leader-dashboard`, else → `/employee-dashboard`).

### 3.2 Legacy / alternate auth

- **`POST /api/auth`** — `app/api/auth/route.ts`: hard-coded admin check + older employee query path.
- **Root `app/page.tsx`:** alternate login UI pushing `/admin` for admin credentials.

### 3.3 Security note (documentation honesty)

Role-based **server-side authorization** for every API is not uniformly enforced across all routes; many endpoints are callable if URL is known. Planned RBAC is described separately in product discussions; this report reflects **current** code paths.

---

## 4. Global Technical Building Blocks

### 4.1 Database access

- **`lib/db.ts`:** `pool` (mysql2 promise pool) and `query` helper used by API routes.

### 4.2 Timezone utilities

- **`lib/timezone.ts`:** `SERVER_TIMEZONE`, `getParts`, `getDateStringInTimeZone`, `getTimeStringInTimeZone`, `getTimeInMinutesInTimeZone`, etc.
- **Usage:** Attendance POST date derivation; break/prayer date fields; sorting helpers (`lib/attendance-sort.ts`); multiple admin/employee pages.

### 4.3 Active shift resolution

- **`lib/get-active-shift.ts`:** `getActiveShiftAssignment(employeeId, timestamp)` returns `shift_assignments.id` when the event time falls in:
  - same-day shift window, or
  - overnight shift spanning midnight (including “continuation” on the day after `assigned_date`).

### 4.4 Active break validation (clock-out gate)

- **`lib/check-active-breaks.ts`:** Used from attendance clock-out path to block clock-out while an open break or prayer break exists.

### 4.5 UI clock state sync

- **`lib/ui-sync/forceSyncClockState.js`:** Fetches `/api/attendance?employeeId=…`, finds any row with `clock_in` and no `clock_out`, drives timer / “clocked in” UI.

---

## 5. Time & Attendance Module

### 5.1 Primary data store

- **Table:** `employee_attendance` (created if missing via `ensureAttendanceTable` in `app/api/attendance/route.ts`).
- **Columns (minimum):** `id`, `employee_id`, `employee_name`, `date` (DATE), `clock_in`, `clock_out`, `total_hours`.

### 5.2 API — `app/api/attendance/route.ts`

| Method | Purpose |
|--------|---------|
| **GET** | List attendance with filters: `employeeId`, `date`, `fromDate`+`toDate`, or default capped list. Joins `hrm_employees`, `employee_jobs`, `departments`, and **latest applicable** `shift_assignments` row (`assigned_date <= attendance.date`). Returns ISO strings for `clock_in`/`clock_out` (UTC parsing via `+ 'Z'`). Computes **late** vs shift start + grace (`GRACE_MINUTES = 10`) using Karachi-local clock-in minutes. |
| **POST** | **Clock in:** per-employee `GET_LOCK`, reject if open row exists (`clock_out IS NULL`), then `INSERT` new row. **Clock out:** rejects if active break/prayer; finds latest open row, `UPDATE` with `clock_out` and `total_hours` from `TIMESTAMPDIFF`. |
| **PUT** | Admin manual edit of a row **or** `autoCloseOldRecords` branch (legacy: closes old open rows with fixed duration — see code before changing policy). |
| **DELETE** | Deletes row by `id`. |

**Query param:** `activeBreakCheck=1` with `employeeId` returns JSON from break checker without full attendance list.

### 5.3 UI — Admin

| Page | Path | Role |
|------|------|------|
| Manage Attendance | `/admin/manage-attendance` | `app/admin/manage-attendance/page.tsx` — edit/delete/correct records (uses attendance API). |
| Monthly Attendance | `/admin/monthly-attendance` | `app/admin/monthly-attendance/page.tsx` — calendar/month grid, overtime vs assigned shift seconds, weekend/off-day logic for display vs absence. |
| Tungsten IN/OUT | `/admin/tungsten-in-out` | `app/admin/tungsten-in-out/page.tsx` — integration-style attendance view (TW days APIs). |

### 5.4 UI — Summaries (HR-wide)

| Page | Path | Data source |
|------|------|-------------|
| Attendance Summary | `/attendance-summary` | `GET /api/attendance?fromDate&toDate` — filters, export CSV, `Running...` when no `clock_out`. |

### 5.5 UI — Employee

| Page | Path | Notes |
|------|------|-------|
| Time & Attendance | `/employee-dashboard/time` | `app/employee-dashboard/time/page.tsx` — clock widget, lists, CSV export; uses same attendance/break/prayer APIs. |

### 5.6 Widget

- **`app/components/ClockBreakPrayer.tsx`:** Clock in/out + break + prayer controls; pending flags to reduce double-submit; syncs with server state.

---

## 6. Breaks Module (Lunch / Meal Break)

### 6.1 Data

- **Table:** `breaks` (assumed existing; joined to employees, departments, `shift_assignments` when `shift_assignment_id` set).

### 6.2 API — `app/api/breaks/route.ts`

| Method | Purpose |
|--------|---------|
| **GET** | Filter by `employeeId`, `date`, or `fromDate`/`toDate`. Returns breaks with **derived** `attendance_session_id` and **`session_clock_in`** (attendance row that contains `break_start` between `clock_in` and `clock_out` or open session). Used for overnight “shift date” display on summaries. |
| **POST** | Start/end break. Date in Karachi. Resolves `shift_assignment_id` via `getActiveShiftAssignment`. **Lock** on break start + reject if open break exists. |
| **PUT** / **DELETE** | Admin corrections / deletions (see file for exact rules). |

### 6.3 UI

| Page | Path |
|------|------|
| Break Summary | `/break-summary` — `app/break-summary/page.tsx` |
| Manage Breaks | `/admin/manage-breaks` — `app/admin/manage-breaks/page.tsx` |

### 6.4 Display logic (overnight)

Summary pages prefer **`session_clock_in`** (Karachi date) for `date_display` when present so post-midnight breaks still “belong” to the shift that started the prior evening.

---

## 7. Prayer Breaks Module

### 7.1 Data

- **Table:** `prayer_breaks`

### 7.2 API — `app/api/prayer_breaks/route.ts`

Same structural pattern as breaks:

- **GET** with filters + `session_clock_in` / `attendance_session_id`
- **POST** with lock + duplicate open prayer session prevention
- **PUT** / **DELETE** for admin maintenance

### 7.3 UI

| Page | Path |
|------|------|
| Prayer Break Summary | `/prayer-summary` — `app/prayer-summary/page.tsx` |
| **Employee:** prayer controls embedded in `ClockBreakPrayer` / `PrayerButton` | `app/components/PrayerButton.tsx` |

---

## 8. Leaves Module

### 8.1 Core tables (inferred from SQL usage)

- **`employee_leaves`:** leave requests (`status` includes `pending`, approve/reject via PATCH).
- **`employee_leave_allowances`:** manual adjustments to balances — `app/api/employee-leave-allowances/route.ts`.

### 8.2 API — `app/api/leaves/route.ts`

| Method | Purpose |
|--------|---------|
| **POST** | Create leave: `employee_id`, `employee_name`, `leave_category`, `start_date`, `end_date`, `total_days`, `reason`, `document_paths` (JSON). Initial status `pending`. Optional WebSocket broadcast `leave_update` if `globalThis.wss` exists. |
| **GET** | Filters: `status`, comma `employees`, `fromDate`/`toDate` with overlap logic (`start_date <= toDate AND end_date >= fromDate`). |
| **PATCH** | Approve/reject (admin flow — see file for fields). |

### 8.3 Leave balance API — `app/api/leave-balance/route.ts`

- **GET** `?employee_id=…` resolves employee by code / id / username.
- Pulls `employee_jobs.joined_date`, employment status, **`lib/leave-cycle`** cycle start.
- Base allowances: **Probation → 3** annual days; **Permanent → 20**; bereavement default **3** (see code for full formulas and consumed-day calculations from approved leaves).

### 8.4 UI

| Page | Path | Audience |
|------|------|------------|
| Leave (HR) | `/leave` | `app/leave/page.tsx` |
| Employee Leave | `/employee-dashboard/leave` | `app/employee-dashboard/leave/page.tsx` |
| Manage Leaves | `/admin/manage-leaves` | `app/admin/manage-leaves/page.tsx` |
| Leave Calendar | `/admin/calendar` | `app/admin/calendar/page.tsx` |
| Monthly Leave Summary | `/admin/monthly-leave-summary` | `app/admin/monthly-leave-summary/page.tsx` |

### 8.5 Calendar API — `app/api/calendar/route.ts`

- Feeds calendar UI with leave-related events (GET/POST — see file).

---

## 9. Shifts & Scheduling

### 9.1 Master shifts (templates)

- **API:** `app/api/master-shifts/route.ts` — GET/POST/PUT/DELETE master shift definitions used by scheduler UI.

### 9.2 Per-employee assignments

- **API:** `app/api/hrm-shifts-assignments/route.ts` — bulk assign by all employees, department, or `employee_ids`; PATCH for overtime flags and timing edits; DELETE assignment.
- **UI:** `app/admin/shift-management/page.tsx` — rich UI merging `/api/hrm-shifts-assignments`, `/api/employee-list`, `/api/departments`, `/api/master-shifts`, optional attendance pseudonym enrichment.

### 9.3 Legacy / alternate shift API

- **`app/api/shift-management/route.ts`:** Older GET listing employees with `shift_assignments` join; POST single-row upsert style assignment.

### 9.4 Shift configuration satellites

These APIs attach policy data to shift / master shift workflows (used by shift setup UIs and `MasterShiftsTable` patterns):

| API path | Role |
|----------|------|
| `/api/shift-working-days` | GET/POST working days |
| `/api/shift-late-early-relaxation` | GET/POST late/early relaxation |
| `/api/shift-late-sitting-overtime` | GET/POST late sitting / OT rules |
| `/api/shift-leave-settings` | GET/POST leave-related shift settings |

### 9.5 UI entry points

- **Shift Scheduler:** `/admin/shift-scheduler` — `app/admin/shift-scheduler/page.tsx`
- **Shift Management:** `/admin/shift-management` — above
- **Shift setup hub:** `app/shift-setup/*` — create shift, assign shift pages wrapping shared components

---

## 10. Employee & Organization Data

### 10.1 Employees

- **`/api/hrm_employees`** — `app/api/hrm_employees/route.ts` — GET (filters), POST create, PUT update.
- **`/api/employee-list`** — `app/api/employee-list/route.ts` — listing + admin PATCH/DELETE operations as implemented.
- **`/api/employees`** — `app/api/employees/route.ts` — simplified list endpoint.
- **Add Employee UI:** `/add-employee` — `app/add-employee/page.tsx` + `AddEmployeeForm.tsx`

### 10.2 Related employee satellites

| API | Purpose |
|-----|---------|
| `/api/employee_jobs` | Job info GET/PUT/POST |
| `/api/employee_jobs_all` | Aggregated jobs |
| `/api/employee_contacts` | Work/personal contacts |
| `/api/employee_emergency_contacts` | Emergency contacts |
| `/api/employee-credentials` | Credential listing / PATCH updates |
| `/api/my-info` | Self-service profile bundle |
| `/api/employee-import` | GET template / POST import |

### 10.3 Departments

- **`/api/departments`** — `app/api/departments/route.ts` — full CRUD
- **UI:** `/admin/departments` — `app/admin/departments/page.tsx`

---

## 11. Payroll, Compensation & Loans

> **Note:** Payroll UIs are under admin navigation; exact business formulas may live in page logic and `Overtime_Salary_Formula.txt` (root). This section maps **routes**.

| Feature | Page path | API highlights |
|---------|-----------|----------------|
| Monthly Payroll | `/admin/monthly-payroll` | Uses attendance summary APIs + salary endpoints |
| Commissions | `/admin/commissions` | `/api/commissions`, upload/download template routes |
| Advance | `/admin/advance` | `/api/advance-salary` |
| Loan | `/admin/loan` | `/api/loan-records`, `/api/loan-installments` |
| Salaries | Employee detail salary | `/api/employee_salaries`, `/api/employee_salaries/all` |

---

## 12. Recruitment & Performance

| Area | Page | File |
|------|------|------|
| Recruitment | `/recruitment` | `app/recruitment/page.tsx` |
| Performance | `/performance` | `app/performance/page.tsx` |

*(Domain-specific APIs may be embedded in page server actions or external links — grep `recruitment` in `app` for extensions.)*

---

## 13. Company Policies, Reminders, Events

| Feature | API | UI |
|---------|-----|-----|
| Policies | `GET/POST/PUT/DELETE /api/company-policies` | `/admin/company-policy` |
| Reminders | `/api/reminders` | Dashboard widgets / admin |
| Upcoming Events | `/api/events` | `/admin/events` |

**Implementation note:** `events` POST normalizes optional datetime fields for strict MySQL mode (empty string → NULL).

---

## 14. Attachments

- **`POST /api/attachments`** — upload metadata / handling
- **`GET /api/attachments/download`** — download by reference

Used by flows that store document paths (e.g. leave attachments).

---

## 15. Integrations & Operational Tools

| Tool | API / Script | Purpose |
|------|--------------|---------|
| ZKBio sync | `POST /api/admin/zkbio-sync` | Biometric / device sync trigger |
| Punch log | `GET /api/zkbio-punch-log` | Punch ingestion / review |
| Tungsten summaries | `GET /api/tw-days-summary`, `GET /api/tw-days-shared-summary` | TW reporting |
| Employment status auto | `GET/POST /api/auto-update-employment-status` | Probation → Permanent promotion |
| Employment checks | `/api/employment-status-check`, `/api/employment-status-debug` | Diagnostics |

**Scripts folder:** `scripts/*` includes maintenance (e.g. `close-open-attendance.js`, `close-open-breaks.js`, sync env samples). Treat as **operational** — review before running against production.

---

## 16. Roles & Permissions (Current State)

- **UI:** `/admin/roles-permissions` — `app/admin/roles-permissions/page.tsx`
- **Current behavior:** Static matrix of modules × roles with checkboxes (mostly non-functional placeholders except Super Admin column forced checked/disabled).
- **Future (per product plan):** dynamic RBAC, department scope, API enforcement — not implemented in this report’s baseline unless separately merged.

---

## 17. Dashboards & Misc Admin

| Page | Path |
|------|------|
| Main dashboard | `/dashboard` — `app/dashboard/page.tsx` |
| Admin home | `/admin` — `app/admin/page.tsx` |
| Employee list | `/admin/employee-list` |
| Employee credentials admin | `/admin/employee-credentials` |
| Employment status tool | `/admin/employment-status-update` |
| My Info (admin shell) | `/my-info` |

---

## 18. Employee Detail Sub-routes

Under `app/employee-details/*` — personal, contact, job, dependents, emergency, credentials, salary. These compose full employee record management from HR perspective.

---

## 19. Complete API Inventory (Quick Reference)

Alphabetical by folder name under `app/api`:

| Route folder | HTTP methods (from codebase) |
|--------------|------------------------------|
| `admin/zkbio-sync` | POST |
| `advance-salary` | GET, POST, DELETE |
| `attachments` | POST |
| `attachments/download` | GET |
| `attendance` | GET, POST, PUT, DELETE |
| `auth` | POST |
| `auto-update-employment-status` | GET, POST |
| `breaks` | GET, POST, PUT, DELETE |
| `calendar` | GET, POST |
| `commissions` | GET |
| `commissions/download-template` | GET |
| `commissions/upload-template` | POST |
| `company-policies` | GET, POST, PUT, DELETE |
| `departments` | GET, POST, PUT, DELETE |
| `employee-credentials` | GET, PATCH |
| `employee-import` | GET, POST |
| `employee-leave-allowances` | GET, POST |
| `employee-list` | GET, PATCH, DELETE |
| `employee-login` | POST |
| `employee_contacts` | GET, PUT, POST |
| `employee_emergency_contacts` | GET, PUT, POST |
| `employee_jobs` | GET, PUT, POST |
| `employee_jobs_all` | GET |
| `employee_salaries` | GET, PUT, POST (+ internal GET_ALL) |
| `employee_salaries/all` | GET |
| `employees` | GET |
| `employment-status-check` | GET |
| `employment-status-debug` | GET |
| `events` | GET, POST, PUT, DELETE |
| `hrm-shifts-assignments` | GET, POST, PATCH, DELETE |
| `hrm_employees` | GET, POST, PUT |
| `leave-balance` | GET |
| `leaves` | POST, GET, PATCH |
| `loan-installments` | GET, POST, PATCH, DELETE |
| `loan-records` | POST, GET, DELETE |
| `master-shifts` | GET, POST, PUT, DELETE |
| `monthly-attendance-accurate-summary` | GET |
| `monthly-attendance-employee-summary` | GET |
| `monthly-attendance-summary` | GET |
| `monthly-attendance-working-days` | GET |
| `my-info` | GET |
| `prayer_breaks` | GET, POST, PUT, DELETE |
| `reminders` | GET, POST, PUT, DELETE |
| `shift-late-early-relaxation` | GET, POST |
| `shift-late-sitting-overtime` | GET, POST |
| `shift-leave-settings` | GET, POST |
| `shift-management` | GET, POST |
| `shift-working-days` | GET, POST |
| `tw-days-shared-summary` | GET |
| `tw-days-summary` | GET |
| `zkbio-punch-log` | GET |

---

## 20. Code-level feature mechanics (deep dive — descriptive)

Yeh section ab **headings + paragraphs** ki form me hai taake har feature ka *code flow* samajh aaye: pehle kya hota hai, phir database / API par kya asar parta hai. Technical terms (file paths, SQL ideas) waisay hi rakhe gaye hain taake developer ko seedha trace mile.

### 20.1 Timezone layer — [`lib/timezone.ts`](lib/timezone.ts)

Poori application me “official” time zone **`Asia/Karachi`** (`SERVER_TIMEZONE`) treat hota hai. `getParts` function `Intl.DateTimeFormat` ke `formatToParts` se usi zone mein saal, mahina, din, ghanta, minute nikalta hai; invalid value par `null` return hota hai. `getDateStringInTimeZone` isi basis par `YYYY-MM-DD` banata hai aur `getTimeStringInTimeZone` / `getTimeInMinutesInTimeZone` clock-in late logic aur UI labels ke liye use hotay hain.

Attendance, breaks, aur prayer breaks ke `POST` handlers aksar **`date` column** seedha client string se nahi balkay **event timestamp** (clock in, break start, etc.) se `getDateStringInTimeZone(..., SERVER_TIMEZONE)` se derive karte hain. Iska faida yeh hai ke employee ka browser kisi bhi local timezone par ho, DB mein save hone wala “din” company ke Karachi calendar ke mutabiq rehta hai.

### 20.2 Active shift resolution — [`lib/get-active-shift.ts`](lib/get-active-shift.ts)

Jab employee break ya prayer start karta hai, system ko pata hona chahiye ke us waqt **kaun sa shift assignment** apply ho raha tha taake `breaks.shift_assignment_id` ya `prayer_breaks.shift_assignment_id` populate ho sake. `getActiveShiftAssignment` employee id aur event ke ISO timestamp par Karachi ka `dateOnly` aur `timeOnly` nikal kar **ek hi SQL query** me teen cases cover karta hai.

Pehla case **normal shift** hai jahan `start_time < end_time` ho: wahi `assigned_date` jis din event pada, aur wall-clock time start aur end ke darmiyan hona chahiye. Doosra case **overnight shift ka pehla hissa** hai: `start_time > end_time` aur event usi assigned date par shift start ke baad ka time ho. Teesra case **raat ke baad wala hissa** hai: event agle calendar din subah shift end se pehle ho, lekin assignment previous din ki row par lagi ho (`DATE_SUB` se match). Jo pehli matching row `ORDER BY assigned_date DESC, id DESC` se aaye, uska `id` return hota hai; warna `null` aur phir break row me `shift_assignment_id` null reh sakta hai.

### 20.3 Attendance API — [`app/api/attendance/route.ts`](app/api/attendance/route.ts)

Har request par route pehle `ensureAttendanceTable` chalata hai jo `employee_attendance` table create kar deta hai agar pehle se na ho. **GET** par base query attendance row ko employee name (concat), pseudonym, department, aur shift se enrich karti hai. Shift join ka andar se rule yeh hai ke har attendance row ki apni `ea.date` ke liye woh shift row lo jiska `assigned_date` **maximum** ho magar `ea.date` se zyada na ho — yani us din ke liye “effective” shift version.

Response banate waqt MySQL se aane wale `clock_in` / `clock_out` strings par literal `'Z'` laga kar UTC instant banaya jata hai phir JSON me ISO string bheji jati hai. **Late** status shift ke `start_time` ko minutes me convert karke, clock-in ko Karachi minutes me convert karke, aur **10 minute grace** ke baad ka farq `late_minutes` ke tor par set hota hai.

**POST clock-in** me pehle named lock `attendance_clock_in_emp_{id}` li jati hai; lock na milay to 409. Phir check hota hai ke koi row `clock_out IS NULL` na ho; milay to 400 “already clocked in”. Kamyabi par naya `INSERT` hota hai jisme `clock_out` aur `total_hours` null rehte hain. **POST clock-out** se pehle `checkActiveBreaks` chalta hai: agar `breaks` ya `prayer_breaks` me koi open session ho to clock-out 400 aur `errorCode: ACTIVE_BREAK`. Warna sab se taaza open attendance row (`ORDER BY clock_in DESC`) par `clock_out` aur `TIMESTAMPDIFF` se `total_hours` (999.99 tak cap) likha jata hai.

**PUT** admin ko manual edit deta hai ya `autoCloseOldRecords` flag se purani open rows ko `clock_in + 8 hours` par band karne ka legacy path. **DELETE** sirf `id` se row hata deta hai. Employee UI ka main driver [`ClockBreakPrayer.tsx`](app/components/ClockBreakPrayer.tsx) hai jo `POST /api/attendance`, optional `activeBreakCheck` GET, aur list refresh ke liye `GET` attendance/breaks call karta hai.

### 20.4 Breaks API — [`app/api/breaks/route.ts`](app/api/breaks/route.ts)

**GET** sirf table read nahi hai: do correlated subqueries har break row ko us **attendance session** se jodte hain jisme `break_start` clock-in ke baad ho aur agar clock-out ho chuka ho to break start us se pehle ho. Isi se `session_clock_in` milta hai jo summary pages overnight shift ke liye “shift wale din” dikhane ke liye use karti hain.

**POST** me agar `break_start` aaye to pehle `break_start_emp_{id}` lock, phir `getActiveShiftAssignment`, phir check ke koi open break (`break_end IS NULL`) na ho; phir `INSERT` with Karachi `date` aur optional `shift_assignment_id`. Agar sirf `break_end` aaye to system globally sab se naya open break dhoondh kar duration seconds me nikaal kar row update karta hai; open na mile to 400.

### 20.5 Prayer breaks API — [`app/api/prayer_breaks/route.ts`](app/api/prayer_breaks/route.ts)

Yeh module breaks ke saath **mirror architecture** rakhta hai: alag table `prayer_breaks`, alag lock naam `prayer_break_start_emp_{id}`, same duplicate-open guard, same shift assignment attach, aur duration bhi seconds me. Is separation ka matlab reporting aur policy dono me lunch break aur prayer ko alag treat kiya ja sakta hai.

### 20.6 Leaves API — [`app/api/leaves/route.ts`](app/api/leaves/route.ts)

Nayi leave **POST** se `employee_leaves` me `pending` status ke sath insert hoti hai; documents ka array JSON string ban kar `document_paths` me jata hai. **GET** dynamic SQL banata hai: status filter, comma-separated employee list, aur agar `fromDate`/`toDate` dono hon to overlap condition `start_date <= toDate AND end_date >= fromDate` — yani range se leave ka koi hissa takra jaye to row aa jati hai.

**PATCH** sirf `approved` ya `rejected` accept karta hai; reject par `admin_remark` bhi save ho sakta hai. Agar server par WebSocket `wss` attach ho to clients ko `leave_update` message bheja ja sakta hai. **Leave balance** API approved rows ko cycle ke andar ginati hai, is liye approve/reject ke baad balance GET dubara chalane par badal jata hai.

### 20.7 Leave balance API — [`app/api/leave-balance/route.ts`](app/api/leave-balance/route.ts)

Pehle employee identity resolve hoti hai (code, numeric id, ya username). Phir `employee_jobs` se joining date aur employment status mil kar probation vs permanent decide hota hai — default annual allowance **3** vs **20** days, bereavement base **3**. `employee_leave_allowances` table se manual adjustments sirf tab lagte hain jab un ki `updated_at` date current leave cycle start ke baad ho; cycle anniversary `getLeaveCycleStartYmd` se aata hai jahan Feb 29 leap year edge case normalize hota hai.

Phir approved leaves query chalti hai jahan `DATE(COALESCE(updated_at, start_date))` cycle start aur **aaj ki Karachi date** ke darmiyan ho. Har `leave_category` string ke hisaab se use count jama hota hai; annual balance formula bereavement ko alag treat karke total approved days se allowance ghata kar adjustment jodta hai aur `Math.max(0, …)` se negative balance public response me nahi jata.

### 20.8 Company calendar API — [`app/api/calendar/route.ts`](app/api/calendar/route.ts)

`company_calendar_days` table ensure hota hai jahan har date unique ho sakti hai aur status `off` ya `working` ho sakta hai. **GET** month ya explicit range se din load karta hai; yahan month boundaries **native `Date(year, monthIndex, …)`** se nikalti hain jo baqi Karachi-centric code se thori philosophical mismatch hai — developer ko pata hona chahiye. **POST** upsert karta hai taake admin same date dubara save kare to overwrite ho.

### 20.9 Shift assignments API — [`app/api/hrm-shifts-assignments/route.ts`](app/api/hrm-shifts-assignments/route.ts)

List GET har employee ke liye aisi shift assignment row choose karti hai jisme pehle preference **poori shift info** (naam + start + end) wali ho, warna fallback, phir taarikh aur id ke hisaab se latest. **POST** bulk assign karta hai: sab active employees, department se employee list, ya chune hue ids; har target par upsert same `assigned_date` par. Default assign date **`new Date().toISOString().split("T")[0]`** hai — yani **UTC calendar date**, Karachi se farq ho sakta hai midnight ke aas paas.

**PATCH** ka bulk overtime path latest assignment row par `allow_overtime` toggle karta hai; agar koi row hi na ho to sirf overtime flag wali “khali” shift row insert ho sakti hai.

### 20.10 Monthly attendance summary API — [`app/api/monthly-attendance-summary/route.ts`](app/api/monthly-attendance-summary/route.ts)

Yeh endpoint date range me saari attendance rows kheench kar employee-wise group karta hai. `tw_days` nikalne ke liye JavaScript loop har din par chalta hai, weekend (Saturday/Sunday) skip karta hai, aur kuch din skip karte hain jahan saari rows par `status === 'off'` ya `leave_type === 'approved'` jaisa string match ho — yeh payroll-oriented “working window” ginti hai. Baqi file me salary aggregates join ho sakte hain jo monthly payroll UI ke sath juda hua hai.

### 20.11 Client clock widget — [`app/components/ClockBreakPrayer.tsx`](app/components/ClockBreakPrayer.tsx)

Widget server ko source of truth maanta hai: clock in/out aur break start/end `fetch` se `/api/attendance` aur `/api/breaks` par jate hain. Clock-out se pehle kabhi kabhi `activeBreakCheck` query chalai jati hai taake UI pehle se warn kar sake. Alag **pending** state variables buttons disable karte hain jab tak response na aa jaye — yeh multi-tap UX layer hai jo server-side locks ke sath mil kar duplicate sessions kam karti hai.

### 20.12 Authentication — API aur login page ka rishta

[`employee-login`](app/api/employee-login/route.ts) successful login par `{ success, employee, username }` return karta hai jahan `employee` poora DB row hai (jisme `role` column ho sakta hai). [`auth/page.tsx`](app/auth/page.tsx) lekin `data.role` (top-level) expect karti hai aur `localStorage.userRole` me likhti hai. Chunke API top-level `role` bhejta nahi, zyada tar waqt `data.role` **undefined** rehta hai aur code `"Officer"` default use karta hai, jis se routing zyada tar **`/employee-dashboard`** par jaati hai. Agar BOD/HOD/Management/Leader dashboards chahiyein to ya to API me explicit `role: employee.role` add karna hoga ya client ko `data.employee.role` read karwana hoga.

### 20.13 Employee bootstrap after login

Employee shell [`employee-dashboard/layout.tsx`](app/employee-dashboard/layout.tsx) `localStorage.loginId` check karti hai; na ho to `/auth`. Phir `hrm_employees` GET ko email ya username se call karti hai aur parallel fallback `employeeId` se, taake header par naam show ho sake.

### 20.14 Sorting aur summary display helpers

[`lib/attendance-sort.ts`](lib/attendance-sort.ts) attendance rows ko sort karte waqt Karachi-normalized epoch use karta hai taake browser timezone sort order bigaad na de. Summary pages (`attendance-summary`, `break-summary`, `prayer-summary`, `employee-dashboard/time`) display aur duration ke liye `timezone.ts` helpers share karti hain jahan patch apply ho chuka hai.

### 20.15 Admin Roles & Permissions page — current reality

[`roles-permissions/page.tsx`](app/admin/roles-permissions/page.tsx) sirf static matrix render karti hai; checkboxes zyada tar disabled hain aur koi save API nahi hai. Yeh abhi **UI prototype** hai, production RBAC nahi. Asal control bad me database + middleware se aana hoga.

### 20.16 Payroll aur compensation — APIs ka kirdar

Salary aur payroll flows **kaee endpoints** par distribute hain. `employee_salaries` aur `employee_salaries/all` employee-wise aur bulk salary data dete hain. `advance-salary` advance entries list/create/delete karta hai. `loan-records` aur `loan-installments` qarz ka header aur qistien handle karte hain. `commissions` aur template upload/download commission Excel workflow ke liye hain. Admin pages (`/admin/monthly-payroll`, commissions, advance, loan) in APIs ko React state ke sath jor kar UI banati hain; ghanton ka hisaab aksar `employee_attendance` aur `monthly-attendance-*` summary routes ke sath mil kar banta hai.

### 20.17 Events aur reminders

`events` route `upcoming_events` par CRUD karta hai; **POST** me optional `end_at` ke liye empty string ko `NULL` banaya jata hai taake MySQL strict mode error na de. `reminders` route dashboard reminders par CRUD karta hai; yahan DB schema me `id` auto-increment primary hona zaroori hai warna insert fail ho sakta hai.

### 20.18 Policies aur attachments

`company-policies` company ke text/HTML policy blocks ke liye CRUD hai jo admin policy page aur employee widgets use kar sakte hain. `attachments` aur `attachments/download` files upload/store aur download ke liye pipeline dete hain, maslan leave documents.

### 20.19 Integrations aur operations

`admin/zkbio-sync` POST se biometric sync script trigger ho sakti hai. `zkbio-punch-log` GET reconciliation ke liye punch data deta hai. `tw-days-summary` aur `tw-days-shared-summary` Tungsten IN/OUT reporting se juday hue aggregates return karte hain. `auto-update-employment-status` cron ya manual trigger se probation se permanent promotion chala sakta hai — detail `EMPLOYMENT_STATUS_AUTO_UPDATE.md` me hai.

### 20.20 Employee CRUD aur import

`hrm_employees` GET single employee `employeeId` ya `username` se laata hai; POST/PUT onboarding form ke zariye poora record likh sakte hain. `employee-list` HR listing aur kuch admin PATCH/DELETE operations deta hai. `employee-import` bulk hire ke liye template GET aur file POST support karta hai. `employee_jobs` aur `employee_jobs_all` job history aur reporting ke liye employee se linked rows expose karte hain.

---

## 21. Glossary (short descriptions)

**Open attendance** — Aisi `employee_attendance` row jisme `clock_in` set ho aur `clock_out` abhi `NULL` ho; isi ko “session open” samjha jata hai jab tak clock-out na ho.

**Session clock in** — Break ya prayer ke GET response me woh attendance ka `clock_in` jo subquery se nikalta hai: us break/prayer start usi work session ke darmiyan pada tha. Overnight shift me UI isi se “shift date” choose karti hai.

**SERVER_TIMEZONE** — `Asia/Karachi`; code me explicit `Intl` aur helper functions isi zone ko default maante hain taake HR rules ek hi calendar par chalain.

**shift_assignments** — Har employee ki dated shift row (naam, start, end, overtime flag, etc.). Attendance late logic aur break linkage isi table se derive hoti hai.

---

## 22. Document Maintenance

- **Version:** 2.1 — §20 rewritten as descriptive paragraphs under headings; glossary narrative.
- **When to update:** After any new `app/api/**/route.ts` or major `app/**/page.tsx` feature addition
- **Owner:** Development / HRIS team

---

*End of report*
