#!/bin/sh
# Fail if any migration contains a statement that destroys data.
#
# Written after `prisma migrate diff --from-migrations` with a shadow in a
# non-default *schema* silently produced a migration that dropped every table:
# Prisma compared "shadow schema has everything, public has nothing" and emitted
# the difference. The shadow must be a separate DATABASE. This check would have
# caught it before it reached a commit.
#
# Intentional destructive changes can be marked with a line containing
# "-- hearth:allow-destructive" in the same migration file.
set -eu
cd "$(dirname "$0")/.."

status=0
for f in prisma/migrations/*/migration.sql; do
  [ -f "$f" ] || continue
  grep -q -- '-- hearth:allow-destructive' "$f" && continue
  hits=$(grep -inE '^[[:space:]]*(DROP[[:space:]]+(TABLE|SCHEMA|DATABASE|TYPE)|TRUNCATE)' "$f" || true)
  if [ -n "$hits" ]; then
    echo "DESTRUCTIVE statements in $f:" >&2
    printf '%s\n' "$hits" | sed 's/^/  /' >&2
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "migrations: no destructive statements"
else
  echo "" >&2
  echo "If this is deliberate, add a line '-- hearth:allow-destructive' to the file." >&2
fi
exit "$status"
