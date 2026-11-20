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

## Getting started
Prerequisites: Node 22+ and a local PostgreSQL server (16+; developed against 18, running as a Windows service on port 5432). pnpm comes through Corepack (`corepack enable`, or prefix commands with `corepack`).

```bash
corepack pnpm install
```
```bash
cp apps/api/.env.example apps/api/.env
```
Then fill in `JWT_SECRET` (any 32+ random characters; the file shows how to generate one) and `SEED_PASSWORD` (the password the seeded staff accounts get).

One-time database setup. This creates the `sms` login and database, and asks for your `postgres` password:
```bash
"C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -U postgres -f apps/api/prisma/create-db.sql
```
```bash
corepack pnpm db:migrate
```
```bash
corepack pnpm db:seed
```
```bash
corepack pnpm dev
```
Open http://localhost:5174 and sign in:
- **Staff**: a seeded e-mail (e.g. `director@bnmpschool.in`) with your `SEED_PASSWORD`.
- **Parent / Student**: test numbers `98000 00001` (parent) or `98000 00002` (student). No SMS provider is set up yet, so in development the 6-digit code appears in the API log.

If new database connections fail with "password authentication failed", re-run the one-time setup above: it resets the `sms` password to the development value.

For the mobile app, run `corepack pnpm --filter @sms/mobile dev` and scan the QR code with Expo Go.

## Checks
```bash
corepack pnpm build && corepack pnpm typecheck
```
```bash
corepack pnpm --filter @sms/api test
```
End-to-end tests need the migrated, seeded database:
```bash
corepack pnpm --filter @sms/api test:e2e
```
CI (`.github/workflows/ci.yml`) runs all of these against a fresh PostgreSQL on every push and pull request.

## What's here so far
- RBAC rules ported 1:1 from the POC (`packages/shared/src/modules.ts`), used by both web and mobile.
- A multi-tenant foundation schema: Tenant, Branch, User, AcademicYear, Class, Staff, Student, Guardian and AuditLog. The seed loads the POC's trust, its 3 branches and the 7 demo personas.
- **Sign-in**: staff by e-mail and password; parents and students by a one-time SMS code. 15-minute access tokens and 30-day refresh tokens; the web app keeps the refresh token in an httpOnly cookie, mobile gets it in the response body. Reusing an old refresh token ends all of that user's sessions.
- **Access control**: every API route needs a signed-in user unless marked `@Public()`. `@Roles()` and `@RequireModule()` use the shared POC permission rules. Queries are scoped to the caller's school and branch through `apps/api/src/common/scope.ts`.
- **Audit log** of sign-ins, failed sign-ins, sign-outs, token reuse and academic-year changes.
- **Endpoints**: `/api/health`, `/api/auth/*`, `/api/branches`, `/api/academic-years`.
- The web app has a real sign-in page, a role-based sidebar, a dashboard, and an "Access restricted" screen for modules a role can't open. Modules not built yet show a placeholder.
