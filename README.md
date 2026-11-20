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

| Who | How to sign in |
|---|---|
| Group Director (all branches) | Staff tab: `director@bnmpschool.in` + your `SEED_PASSWORD` |
| Branch Manager | Staff tab: `anitha@bnmpschool.in` + your `SEED_PASSWORD` |
| Teacher | Staff tab: `priya.sharma@bnmpschool.in` + your `SEED_PASSWORD` |
| Accounts | Staff tab: `kavitha@bnmpschool.in` + your `SEED_PASSWORD` |
| Platform Admin (Stixis) | Staff tab: `meera@stixis.io` + your `SEED_PASSWORD` |
| Parent | Parent / Student tab: `98000 00001`, then the 6-digit code |
| Student | Parent / Student tab: `98000 00002`, then the 6-digit code |

No SMS provider is set up yet, so the 6-digit code is printed in the window running `corepack pnpm dev`, in a line starting `[SMS (dev)]`.

What to look for:
- The dashboard shows **API: ok** and **Database: up**.
- The Group Director sees 3 branches; everyone else sees only their own.
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
| Port 3000 or 5174 already in use | Stop the other process, or the earlier `corepack pnpm dev` window. |
| `Please wait 30 seconds before asking for another code` | Wait 30 seconds; codes can only be re-sent after that. |
| Database schema changed after a `git pull` | Run `corepack pnpm db:migrate` again. |

## What's here so far
- RBAC rules ported 1:1 from the POC (`packages/shared/src/modules.ts`), used by both web and mobile.
- A multi-tenant foundation schema: Tenant, Branch, User, AcademicYear, Class, Staff, Student, Guardian and AuditLog. The seed loads the POC's trust, its 3 branches and the 7 demo personas.
- **Sign-in**: staff by e-mail and password; parents and students by a one-time SMS code. 15-minute access tokens and 30-day refresh tokens; the web app keeps the refresh token in an httpOnly cookie, mobile gets it in the response body. Reusing an old refresh token ends all of that user's sessions.
- **Access control**: every API route needs a signed-in user unless marked `@Public()`. `@Roles()` and `@RequireModule()` use the shared POC permission rules. Queries are scoped to the caller's school and branch through `apps/api/src/common/scope.ts`.
- **Audit log** of sign-ins, failed sign-ins, sign-outs, token reuse and academic-year changes.
- **Endpoints**: `/api/health`, `/api/auth/*`, `/api/branches`, `/api/academic-years`.
- The web app has a real sign-in page, a role-based sidebar, a dashboard, and an "Access restricted" screen for modules a role can't open. Modules not built yet show a placeholder.
