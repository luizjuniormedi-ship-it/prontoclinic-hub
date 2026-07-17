#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <database-name>" >&2
  exit 2
fi

DATABASE=$1
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
PGUSER=${PGUSER:-postgres}

PSQL=(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DATABASE")

if [[ "${REPLAY_REAL_SUPABASE_AUTH:-0}" == "1" ]]; then
  "${PSQL[@]}" -Atqc "
    SELECT CASE
      WHEN to_regclass('auth.users') IS NOT NULL
       AND to_regclass('auth.sessions') IS NOT NULL
       AND to_regprocedure('auth.jwt()') IS NOT NULL
      THEN 'ready'
      ELSE 'missing'
    END
  " | grep -qx ready || {
    echo "Real Supabase Auth schema is missing or incomplete in $DATABASE" >&2
    exit 1
  }
else
  "${PSQL[@]}" --single-transaction -f tests/database/supabase_auth_compatibility.sql >/dev/null
fi

for migration in supabase/migrations/*.sql; do
  if [[ -n "${REPLAY_STOP_BEFORE:-}" && "$(basename "$migration")" == "${REPLAY_STOP_BEFORE}" ]]; then
    break
  fi
  echo "[$DATABASE] apply $migration"
  "${PSQL[@]}" --single-transaction -f "$migration" >/dev/null
done
