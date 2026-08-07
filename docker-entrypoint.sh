#!/bin/sh
# ---------------------------------------------------------------------------
# Bring the schema up to date, seed the built-in data, then hand off to the app.
#
# Migrating at boot rather than in a separate step means `docker compose up` is
# genuinely all that is needed, including after an upgrade that adds columns.
# `migrate deploy` only ever applies committed migrations — it never generates
# or resets anything — so it is safe to run unattended on a live database.
# ---------------------------------------------------------------------------
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[hearth] DATABASE_URL is not set. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "[hearth] AUTH_SECRET is not set. Generate one with: openssl rand -base64 32" >&2
  exit 1
fi

# Postgres may still be starting even once its port is open, and compose's
# healthcheck only gates the first start. Retry rather than crash-loop.
# Invoke the CLI's entry script directly rather than through npx: the runtime
# image copies node_modules/prisma but not node_modules/.bin, which is where npx
# would look for the shim.
PRISMA_CLI="node_modules/prisma/build/index.js"

attempt=1
until node "$PRISMA_CLI" migrate deploy; do
  if [ "$attempt" -ge 10 ]; then
    echo "[hearth] database is still unreachable after $attempt attempts, giving up" >&2
    exit 1
  fi
  echo "[hearth] migrate failed (attempt $attempt), retrying in 3s…"
  attempt=$((attempt + 1))
  sleep 3
done

# Non-fatal: a seed failure leaves the app usable, and loadRelationshipTypes()
# lazily re-seeds the built-in types if they are missing.
node prisma/seed.mjs || echo "[hearth] seed failed, continuing" >&2

echo "[hearth] starting on port ${PORT:-3000}"
exec "$@"
