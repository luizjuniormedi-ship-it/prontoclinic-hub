#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
AUTH_COMPATIBILITY="$ROOT_DIR/tests/database/supabase_auth_compatibility.sql"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <database-name>" >&2
  exit 2
fi

DATABASE=$1
PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
PGUSER=${PGUSER:-postgres}
PSQL_BIN=${PSQL_BIN:-psql}
export PGCLIENTENCODING=${PGCLIENTENCODING:-UTF8}

PSQL=("$PSQL_BIN" -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DATABASE")
COMMIT_SHA=${REPLAY_COMMIT_SHA:-}
TREE_SHA=${REPLAY_TREE_SHA:-}
DIRTY=${REPLAY_DIRTY:-}
if [[ -z "$COMMIT_SHA" || -z "$TREE_SHA" || -z "$DIRTY" ]]; then
  command -v git >/dev/null 2>&1 || {
    echo "git is required unless REPLAY_COMMIT_SHA, REPLAY_TREE_SHA and REPLAY_DIRTY are set" >&2
    exit 1
  }
  COMMIT_SHA=${COMMIT_SHA:-$(git -C "$ROOT_DIR" rev-parse 'HEAD^{commit}')}
  TREE_SHA=${TREE_SHA:-$(git -C "$ROOT_DIR" rev-parse 'HEAD^{tree}')}
  if [[ -z "$DIRTY" ]]; then
    DIRTY=0
    if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
      DIRTY=1
    fi
  fi
fi
MANIFEST_DIR=${REPLAY_MANIFEST_DIR:-"$ROOT_DIR/artifacts/replay"}
mkdir -p "$MANIFEST_DIR"
MANIFEST="$MANIFEST_DIR/${DATABASE}.manifest.tsv"
{
  printf 'commit_sha\t%s\n' "$COMMIT_SHA"
  printf 'tree_sha\t%s\n' "$TREE_SHA"
  printf 'dirty\t%s\n' "$DIRTY"
  printf 'database\t%s\n' "$DATABASE"
  printf 'migration\tsha256\n'
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    printf '%s\t%s\n' "$(basename "$migration")" "$(sha256sum "$migration" | cut -d' ' -f1)"
  done
} > "$MANIFEST"

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
  "${PSQL[@]}" --single-transaction -f "$AUTH_COMPATIBILITY" >/dev/null
fi

for migration in "$MIGRATIONS_DIR"/*.sql; do
  if [[ -n "${REPLAY_STOP_BEFORE:-}" && "$(basename "$migration")" == "${REPLAY_STOP_BEFORE}" ]]; then
    break
  fi
  echo "[$DATABASE] apply $migration"
  "${PSQL[@]}" --single-transaction -f "$migration" >/dev/null
done

echo "[$DATABASE] replay manifest: $MANIFEST"
