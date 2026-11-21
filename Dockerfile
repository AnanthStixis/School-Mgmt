# One image runs the whole system: the API, which also serves the web app (WEB_DIST).
# Build:  docker build -t bnm-sms .
# Run:    see docs/DEPLOYMENT.md (needs DATABASE_URL, JWT_SECRET, WEB_ORIGIN and real SMS/payment providers,
#         or TEST_SYSTEM=true for a hosted test system).

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @sms/shared build && pnpm --filter @sms/api build && pnpm --filter @sms/web build
# Keep only what the API needs at run time.
RUN pnpm --filter @sms/api deploy --prod /out \
 && cp -r apps/api/dist apps/api/prisma /out/ \
 && mkdir -p /out/web && cp -r apps/web/dist/. /out/web/ \
 && cd /out && npx prisma generate

# ---- run ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.db==='up'?0:1)).catch(()=>process.exit(1))"
# Apply any new database migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
