# Deployment and go-live runbook

How to run the school management system for BNM Public School: a **test system** for the accounts team's
acceptance tests (sprint 8) and the **live system** from 1 April 2027.

> **Still to decide** (needed before go-live): the hosting provider, the payment gateway and the SMS provider.
> Until the gateway and SMS provider are chosen, only a test system can run: the live system refuses to start
> with the simulated providers.

## What runs

| Piece | What it is | Notes |
|---|---|---|
| App | One Node.js 22 process: the API, which also serves the web app | Built from the `Dockerfile`, or `pnpm build` on the server |
| Database | PostgreSQL 16 or later | The only place data is kept. Back it up (below). |
| HTTPS proxy | Caddy or nginx in front of the app | Gets and renews the TLS certificate; forwards to port 3000 |

Redis is listed in the development setup but nothing uses it yet; the live system doesn't need it.

**Where:** keep the server and database in an Indian region (for example AWS Mumbai, Azure Central India,
Google Cloud Mumbai, or an Indian provider). Student and parent data falls under the DPDP Act 2023, and
storing it in India avoids cross-border transfer questions. A small server (2 vCPU, 4 GB RAM) and a managed
PostgreSQL with automatic daily backups and point-in-time recovery are enough for about 1,000 students.

## Settings (environment variables)

| Variable | Live | Test system | Meaning |
|---|---|---|---|
| `NODE_ENV` | `production` | `production` | |
| `TEST_SYSTEM` | *(unset)* | `true` | Simulated SMS and payments, and a "TEST SYSTEM" banner on every page |
| `DATABASE_URL` | required | required | `postgresql://user:password@host:5432/db?schema=public&sslmode=require` |
| `JWT_SECRET` | required | required | 48+ random characters, different per system: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `WEB_ORIGIN` | required | required | The address people open, `https://…` (comma-separate several) |
| `WEB_DIST` | `/app/web` | `/app/web` | Set in the Docker image; the web app's build folder |
| `PORT` | `3000` | `3000` | |
| `SEED_PASSWORD` | **never** | optional | Only for loading demo data |

The app refuses to start, and says why, if a live system is missing a setting, uses `http://`, has a
placeholder secret, or has no real SMS provider or payment gateway.

## First installation

1. **Database:** create an empty PostgreSQL database and user.
2. **App:** build and run the image (or `corepack pnpm install && corepack pnpm build` on the server):
   ```bash
   docker build -t bnm-sms .
   docker run -d --name bnm-sms --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file /etc/bnm-sms.env bnm-sms
   ```
   The container applies database migrations on every start, then starts the app.
3. **HTTPS:** for example with Caddy (`/etc/caddy/Caddyfile`):
   ```
   fees.bnmpschool.in {
     reverse_proxy 127.0.0.1:3000
   }
   ```
4. **School:** copy `docs/school-setup.example.json`, fill in the real School Admin's name and mobile, and run:
   ```bash
   docker cp school.json bnm-sms:/app/school.json
   docker exec -it bnm-sms node dist/scripts/setup-school.js /app/school.json         # shows the database and what will change
   docker exec -it bnm-sms node dist/scripts/setup-school.js /app/school.json --yes   # writes
   ```
   or, from a checkout with `DATABASE_URL` set: `corepack pnpm --filter @sms/api setup:school -- path/to/school.json [--yes]`.
   It creates the school, branches, academic year 2027-28 and the School Admin, with no demo data. Running it again only updates.
   It refuses the example file's placeholder name, mobile and e-mail, and writes nothing without `--yes`.
   **Check the database line it prints:** without `DATABASE_URL` it falls back to `apps/api/.env` (the development database).
5. **Check:** open `https://…/api/health`: `"status":"ok"`, `"db":"up"`, and `"testSystem": false` on the live system.
6. The School Admin signs in (Staff tab → *No password? Sign in with a code sent to your mobile*) and adds
   classes, staff (with logins), the fee chart, then imports students and previous-year balances
   (see [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md), section F).

**Test system for acceptance testing:** same steps with `TEST_SYSTEM=true`. To give it demo data instead of
real data, run the seed once against its database with `SEED_PASSWORD` set: `corepack pnpm db:seed`.

## Updating

1. Take a backup (below).
2. Build and start the new image. Migrations run automatically on start; if one fails, the app doesn't start
   and the previous data is untouched.
3. Check `/api/health` and sign in.
4. **Roll back:** start the previous image. If the failed version had applied a migration, restore the backup taken in step 1.

## Backups

- **Managed database:** turn on daily automatic backups kept for at least 30 days and point-in-time recovery.
- **Also** keep a nightly copy outside the provider (e.g. the school's own storage), because fee records must
  be kept for years:
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > bnm-sms-$(date +%F).dump
  ```
- **Test a restore** before go-live and then every term, into an empty database:
  ```bash
  pg_restore --no-owner --dbname "$RESTORE_DATABASE_URL" bnm-sms-YYYY-MM-DD.dump
  ```
  then point a test system at it and open a few receipts.

## Go-live day (week of 22 March)

Follow the cut-over checklist at the end of [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md), then:

1. Freeze SchoolElement collections at the end of the last day; take its final exports.
2. Import students and previous-year balances into the live system; compare totals.
3. Assign, confirm and publish 2027-28 fees; switch on online payment.
4. Make a ₹1 online payment and refund it; send one test SMS to a staff phone.
5. Tell parents how to sign in (Parent tab, their registered mobile) and pay before 5 April.

## Before go-live: still to build

- **SMS provider:** an implementation of `SmsSender` (`apps/api/src/auth/sms.ts`) for the chosen provider
  (DLT-registered templates are required in India for transactional SMS).
- **Payment gateway:** an implementation of `PaymentGateway` (`apps/api/src/payments/gateway.ts`) for the chosen
  gateway, verifying its webhook signature over the raw request body, plus daily settlement checks.
- Both are small adapters; the rest of the system (attempts, receipts, notifications) is already in place.
