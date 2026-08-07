# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Hearth — multi-stage build producing a small runtime image.
#
# Node 22 rather than the 18 some tooling still defaults to: 18 is end of life,
# and the Alpine images ship full ICU, which the timezone maths in
# src/lib/time.ts depends on (Intl.DateTimeFormat with an arbitrary IANA zone).
# ---------------------------------------------------------------------------

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app


# --- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


# --- build -----------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build imports modules that construct a PrismaClient. The client is lazy
# about connecting, but its constructor still wants the variable to exist, so
# provide a syntactically valid placeholder. The real URL is supplied at runtime.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build


# --- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# next's standalone output bundles only the modules the server actually needs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations and the seed run at boot, so the runtime image needs the Prisma CLI,
# the schema, the migration SQL and the seed's data file. Standalone tracing does
# not pick any of these up, because nothing the app imports references them.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/relationship-types.json ./src/lib/relationship-types.json

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
