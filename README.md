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
One-time database setup. This creates the `sms` login and database, and asks for your `postgres` password:
```bash
"C:/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -U postgres -f apps/api/prisma/create-db.sql
```
```bash
corepack pnpm db:migrate --name init
```
```bash
corepack pnpm db:seed
```
```bash
corepack pnpm dev
```
Open http://localhost:5174 and sign in with a demo persona. For the mobile app, run `corepack pnpm --filter @sms/mobile dev` and scan the QR code with Expo Go.

## Checks
```bash
corepack pnpm build && corepack pnpm typecheck
```
```bash
corepack pnpm --filter @sms/api test
```

## What's here so far
- RBAC rules ported 1:1 from the POC (`packages/shared/src/modules.ts`), used by both web and mobile.
- A multi-tenant foundation schema: Tenant, Branch, User, AcademicYear, Class, Staff, Student, Guardian and AuditLog. The seed loads the POC's trust, its 3 branches and the 7 demo personas.
- `GET /api/health` (API + DB status) and `GET /api/branches`.
- The web shell has a role-based sidebar, a dashboard, and an "Access restricted" screen for modules a role can't open. Modules not built yet show a placeholder.
- **Demo-persona sign-in is temporary.** It will be replaced by the auth module.
