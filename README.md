# BNM School Management SaaS

Production implementation of the approved clickable POC. The POC is the functional spec: each unbuilt module in the app points to its `Poc/<module>.html` page. The POC is kept locally in `Poc/` and is not committed to this repository.

## Stack
| Layer | Choice |
|---|---|
| API | NestJS 11 (TypeScript), Prisma 6, PostgreSQL (local install) |
| Background jobs | BullMQ + Redis (SLA escalation, reminders, late fees), not wired yet. Redis will run via `corepack pnpm redis:up` (Docker) unless installed locally |
| Web | React 19 + Vite 6, React Router 7, TanStack Query 5, Tailwind CSS 4 |
| Mobile | React Native 0.81 + Expo SDK 54 (Parent, Student and Teacher apps) |
| Monorepo | pnpm 9 workspaces + Turborepo |
| Hosting / payments / SMS / WhatsApp | Not chosen yet; integrations will sit behind adapters |

## Layout
```
apps/api        NestJS API  → http://localhost:3000/api
apps/web        Web portal  → http://localhost:5174 (proxies /api to the API)
apps/mobile     Expo app
packages/shared Roles, module permissions (RBAC) and API types shared by all three
Poc/            Approved clickable POC (local reference only, git-ignored)
```

## Run and check locally
Commands are for **Windows PowerShell**, run from the repository root.

### Prerequisites
- Node.js 22 or later
- PostgreSQL 16 or later running on `localhost:5432` (developed against the PostgreSQL 18 Windows service)
- pnpm through Corepack. It's built into Node, so every command below starts with `corepack pnpm`.

### 1. First-time setup (once per machine)
Install dependencies:
```powershell
corepack pnpm install
```
Create the API settings file:
```powershell
Copy-Item apps/api/.env.example apps/api/.env
```
Open `apps/api/.env` and fill in two values:
- `JWT_SECRET`: paste the output of the command below.
- `SEED_PASSWORD`: any password you choose. The seeded staff accounts get it.
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```
Create the `sms` database login and database. This asks for your PostgreSQL `postgres` password:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -f apps/api/prisma/create-db.sql
```
Create the tables:
```powershell
corepack pnpm db:migrate
```
Load the demo school, branches and users:
```powershell
corepack pnpm db:seed
```

### 2. Start the app (every time)
```powershell
corepack pnpm dev
```
This starts the API on http://localhost:3000 and the web app on http://localhost:5174. Leave it running; stop it with `Ctrl+C`.

### 3. Check it works
In a second PowerShell window, check the API and database:
```powershell
curl.exe http://localhost:3000/api/health
```
You should see `"status":"ok"` and `"db":"up"`.

Then open http://localhost:5174 and sign in:

| Who | Staff tab (e-mail + your `SEED_PASSWORD`) | Or Parent tab (mobile + code) |
|---|---|---|
| School Admin / Group Director (all branches) | `director@bnmpschool.in` | `98000 00013` |
| Branch Manager (BNM Public School) | `anitha@bnmpschool.in` | `98000 00010` |
| Teacher | `priya.sharma@bnmpschool.in` | `98000 00011` |
| Accounts | `kavitha@bnmpschool.in` | `98000 00012` |
| Platform Admin (Stixis) | `meera@stixis.io` | — |
| Parent of Aarav & Diya | — | `98000 00001` |
| Student (Aarav) | Student tab: login ID `BNMPS26-0033` + your `SEED_PASSWORD` | — |

No SMS provider is set up yet, so the 6-digit code is printed in the window running `corepack pnpm dev`, in a line starting `[SMS (dev)]`.

What to look for:
- The dashboard shows **API: ok** and **Database: up**.
- **Student sign-in**: students don't sign in by mobile (most have no phone of their own, and under the DPDP Act they're children, so the parent stays in control). The parent's dashboard lists each child with **Set up sign-in / Change password / Turn off**; the student then uses the **Student** tab with their admission number as login ID. A manager can do the same from the student's profile. Saving a new password signs the student out everywhere else, and 5 wrong passwords lock an account for 15 minutes.
- The Group Director (School Admin) sees 3 branches and a branch switcher in the top bar; everyone else sees only their own branch.
- **Branches & Config**: the School Admin can add and edit branches; a branch manager can only view their own.
- **Academic Setup**: add classes by grade range and sections, set class teachers and rooms, manage subjects.
- **Staff**: add staff and give them a login (teacher, accounts; manager only by the School Admin).
- **Students**: search by name, admission number or parent mobile; open a profile to see guardians, siblings and attendance; add or edit students; import a CSV from **Import CSV**.
- **Admissions** (managers): the enquiry board; open an enquiry to add notes and follow-ups, move it to Admitted, then **Enrol student**.
- **Fees & Invoices** (accounts `98000 00012` or managers): **Collect** to take a payment at the counter (search the student, tick installments, pay in full or in part, collect / waive / leave the late fee, choose the mode) and print the receipt; **Receipts** for the day's (or any range's) register with totals by mode; **Overview** of billed/overdue per fee type; **Assign & publish** to take a class through Assign → Confirm → Publish → Enable online; **Fee setup** to edit class bands and the fee chart. The parent sees published fees under **Fees**, and a student's profile shows their fee account.
- **Attendance**: sign in as the teacher (`98000 00011`) and mark 8-A for today. Absent students' parents get an SMS, shown in the API log as `[SMS (dev)]`. Managers also see an **Overview** tab; the parent (`98000 00001`) sees each child's calendar.
- Each role's sidebar matches the POC. Opening a module the role can't use shows **Access restricted**.
- Reloading the page keeps you signed in, and **Sign out** returns you to the sign-in page.

### 4. Run the automated checks
Build and type-check everything:
```powershell
corepack pnpm build; corepack pnpm typecheck
```
API unit tests:
```powershell
corepack pnpm --filter @sms/api test
```
API end-to-end tests. These need the migrated, seeded database from step 1:
```powershell
corepack pnpm --filter @sms/api test:e2e
```
CI (`.github/workflows/ci.yml`) runs all of these against a fresh PostgreSQL on every push and pull request.

### Mobile app (optional)
```powershell
corepack pnpm --filter @sms/mobile dev
```
Scan the QR code with the Expo Go app on your phone. The mobile app doesn't sign in yet; it only previews each role's menu.

### Troubleshooting
| Problem | Fix |
|---|---|
| `password authentication failed for user "sms"` | Re-run the `psql` command in step 1. It resets the `sms` password to the development value. |
| `JWT_SECRET must be at least 32 characters` | Fill in `JWT_SECRET` in `apps/api/.env` (step 1). |
| `Port 5174 is already in use` (or 3000) | Another copy of the app is still running. Close that window (`Ctrl+C`), or stop whatever holds the port with the commands below, then run `corepack pnpm dev` again. |
| `Please wait 30 seconds before asking for another code` | Wait 30 seconds; codes can only be re-sent after that. |
| Database schema changed after a `git pull` | Run `corepack pnpm db:migrate` again. |

To see what is using ports 3000 and 5174:
```powershell
Get-NetTCPConnection -LocalPort 3000,5174 -State Listen | Select-Object LocalPort, OwningProcess, @{n='Name';e={(Get-Process -Id $_.OwningProcess).ProcessName}}
```
If it's a leftover `node` process from this project, stop it:
```powershell
Get-NetTCPConnection -LocalPort 3000,5174 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

## What's here so far
- RBAC rules ported 1:1 from the POC (`packages/shared/src/modules.ts`), used by both web and mobile.
- A multi-tenant foundation schema: Tenant, Branch, User, AcademicYear, Class, Staff, Student, Guardian and AuditLog. The seed loads the POC's trust, its 3 branches and the 7 demo personas.
- **Sign-in**: staff by e-mail and password; parents and students by a one-time SMS code. 15-minute access tokens and 30-day refresh tokens; the web app keeps the refresh token in an httpOnly cookie, mobile gets it in the response body. Reusing an old refresh token ends all of that user's sessions.
- **Access control**: every API route needs a signed-in user unless marked `@Public()`. `@Roles()` and `@RequireModule()` use the shared POC permission rules. Queries are scoped to the caller's school and branch through `apps/api/src/common/scope.ts`.
- **Audit log** of sign-ins, failed sign-ins, sign-outs, token reuse and academic-year changes.
- **Endpoints**: `/api/health`, `/api/auth/*`, `/api/branches`, `/api/academic-years`.
- **Academic setup (sprint 2)**: branches with settings (working days, timings, attendance threshold) editable only by the School Admin; classes by grade range × sections per academic year (only empty classes can be deleted; locked years are read-only); subject master per branch.
- **Staff (sprint 2)**: directory and login access. Staff logins sign in with a mobile code. Branch managers can give teacher/accounts access; only the School Admin can give manager access. Deactivating staff or changing their role ends their sessions immediately.
- **Students & guardians (sprint 2)**: student records with status (Active, Temporary, Left, Alumni), generated admission numbers (`BNMPS26-0001`), up to 3 guardians. A guardian is identified by mobile number, so students sharing a parent number are linked as siblings under one parent login.
- **CSV import (sprint 2)**: students and staff. Every row is checked first and problems are listed by line; nothing is saved unless the whole file is valid, and then it is saved in one transaction.
- **Admissions (sprint 3)**: enquiries for this or next year move Enquiry → Applied → Test/Interview → Admitted, or are dropped with a reason (and can be re-opened). Each has a timeline of stage changes and notes, follow-up dates, and a duplicate warning (same parent mobile and child name). Enrolling creates the student in one transaction, linking siblings by parent mobile. Fee invoices on enrolment come with the fees module.
- **Attendance (sprint 3)**: daily register per class (Present / Absent / Leave). Class teachers mark their own class today or up to 2 days back; managers any class and date in the open year. Future dates, non-working days and locked years are refused. On today's register, each absent student's primary guardian gets one SMS (never repeated for the same day). Managers get class-wise trends and an at-risk list using each branch's attendance threshold; parents and students see a calendar.
- **Fees setup (sprint 4)**: per branch and academic year, fee types like the existing system's blueprints: School (priced by class band × admission type), Transport (distance slab × pickup mode), Application (flat) and Custom (amount set when assigning). Installments split the amount equally (last one takes the rounding); due dates and components are configurable, and installments lock once any student has the fee. Amounts are **placeholders** until the school confirms its fee chart (flagged in the UI). A fee type can be copied to another year.
- **Invoices (sprint 4)**: Assign → Confirm → Publish (parents can see it) → Online payment enabled, in bulk per class, with a reason for every skipped student. Changing the chart never alters invoices already assigned. Students carry a fee profile (admission type, RTE, staff child, transport slab and pickup). Enrolling a child from Admissions assigns the school fee (and the application fee) for accounts to review. 
- **Collection (sprint 5)**: counter payments with part payment of an installment. Late fee is ₹25 per day after the due date (set per branch under Branches) while anything is unpaid; at the counter it is collected, waived with a reason, or left running (it can't be left when the installment is being cleared). Modes: Cash, Cheque, DD, Net Banking, UPI, Credit / Debit Card; cheque and DD need bank, number and date (no post-dated or stale cheques). Receipts are numbered `BNMPS/2026-27/0001` in one school-wide series per year and print with the amount in words. Cheque and net-banking receipts wait for **Money received** or **Bounced** (which cancels the receipt). A receipt can be cancelled with a reason, newest first per installment, which reverses exactly what it applied; cancelled receipts stay in the register. Parents see their children's receipts under **Fees**. The seed adds about 300 past receipts (most April and July installments paid, a few late); Aarav and Diya leave October unpaid to show a late fee.
- **Notifications**: every outgoing SMS is recorded (queued / sent / failed) so a real provider can be plugged in later.
- The web app has a real sign-in page, a role-based sidebar (a slide-in menu on phones), a branch switcher for the School Admin, and an "Access restricted" screen for modules a role can't open. Modules not built yet show a placeholder.
