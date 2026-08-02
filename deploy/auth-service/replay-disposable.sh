#!/usr/bin/env bash
set -Eeuo pipefail

db="prontomedic_auth_admin_replay_$(date -u +%Y%m%d%H%M%S)"
login="prontomedic_auth_replay_$(date -u +%s)"
password="$(openssl rand -hex 32)"

cleanup() {
  set +e
  runuser -u postgres -- dropdb --if-exists "$db" >/dev/null 2>&1
  runuser -u postgres -- psql -X -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP ROLE IF EXISTS \"$login\"" >/dev/null 2>&1
  rm -f /tmp/20260802183000_local_auth_admin_contract.sql /tmp/provision-service-role.sql
}
trap cleanup EXIT

runuser -u postgres -- createdb "$db"
runuser -u postgres -- pg_dump --schema-only --no-owner --no-privileges prontoclinic \
  | runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$db" >/dev/null

runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$db" \
  -f /tmp/20260802183000_local_auth_admin_contract.sql >/dev/null
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d "$db" \
  -v service_login="$login" -v service_password="$password" \
  -f /tmp/provision-service-role.sql >/dev/null

PGPASSWORD="$password" psql -X -h 127.0.0.1 -U "$login" -d "$db" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
BEGIN;
SET LOCAL ROLE service_role;
DO $audit$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'service role nao assumida';
  END IF;
  IF to_regclass('private.local_auth_challenges') IS NULL THEN
    RAISE EXCEPTION 'challenge table ausente';
  END IF;
  IF NOT has_table_privilege('service_role', 'private.local_auth_challenges', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'ACL de challenges incompleta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'banned_until'
  ) THEN
    RAISE EXCEPTION 'banned_until ausente';
  END IF;
END
$audit$;
ROLLBACK;
SQL

echo AUTH_ADMIN_DISPOSABLE_REPLAY_OK
