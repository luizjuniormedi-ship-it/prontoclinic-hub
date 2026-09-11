#!/usr/bin/env bash
set -Eeuo pipefail

database="${PRONTOMEDIC_DATABASE:-prontoclinic_dbdeploy_${PPID}_$$}"
root="${PRONTOMEDIC_DB_INTEGRATION_ROOT:-/tmp/prontomedic-dbdeploy}"
sha="${PRONTOMEDIC_TEST_COMMIT_SHA:-$(git rev-parse HEAD)}"
database_created=0

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'SHA de integração deve conter 40 caracteres hexadecimais' >&2
  exit 1
}

[[ "$database" = prontoclinic_dbdeploy_* ]] || {
  echo 'banco de integração fora do prefixo descartável permitido' >&2
  exit 1
}

[[ "$root" = /tmp/prontomedic-dbdeploy* ]] || {
  echo 'diretorio de integracao fora do prefixo descartavel permitido' >&2
  exit 1
}

if ! command -v flock >/dev/null 2>&1; then
  [[ "${PRONTOMEDIC_DB_TEST_MODE:-0}" == "1" ]] || {
    echo 'flock e obrigatorio fora do modo de teste' >&2
    exit 1
  }
  flock() { return 0; }
  export -f flock
fi

contracts=(
  '20260804033225|secure_companies_units_admin_contract|20260802183000|inverse|smoke'
  '20260804143000|rbac_active_context_aal2|20260804033225|inverse|rbac'
  '20260805123000|auth_admin_suspension_invariants|20260804143000|inverse|auth-admin'
  '20260811120000|reception_worklist_handoff|20260805123000|inverse|worklist-handoff'
  '20260811210000|dicom_worklist_rls_hardening|20260811120000|forward_only|dicom-hardening'
  '20260812021457|pharmacy_runtime_closure|20260811210000|preserve_schema|pharmacy'
  '20260812150000|medical_attendance_atomic_completion|20260812021457|preserve_schema|medical-attendance'
  '20260812170000|medical_attendance_billing_handoff|20260812150000|preserve_schema|clinical-billing'
  '20260812211247|tiss_account_materialization_contract|20260812170000|preserve_schema|tiss-materialization'
  '20260813001000|canonical_reception_billing_tiss_handoff|20260812211247|preserve_schema|canonical-reception-tiss'
  '20260829012947|canonical_runtime_rpc_contracts|20260813001000|preserve_schema|canonical-runtime-rpc'
  '20260829013235|close_global_catalog_write_policies|20260829012947|forward_only|global-catalog-write'
  '20260829014500|auth_native_session_contract|20260829013235|forward_only|auth-native-session'
  '20260902022540|nursing_rpc_owner_rls_closure|20260829014500|preserve_schema|nursing-rpc-owner'
  '20260902055133|appointment_series_requirements_contract|20260902022540|preserve_schema|appointment-series'
  '20260904183653|tiss_authorization_serialization|20260902055133|preserve_schema|tiss-authorization'
  '20260905030000|imaging_order_attendance_contract|20260904183653|inverse|imaging-order-attendance'
  '20260910223000|secure_pre_cadastro_edge_contract|20260905030000|preserve_schema|pre-cadastro-edge'
  '20260910224500|retire_legacy_pre_cadastro_rpc_grants|20260910223000|inverse|pre-cadastro-contract'
  '20260910230000|purge_legacy_pre_cadastro_plaintext|20260910224500|preserve_schema|pre-cadastro-cleanup'
)

cleanup() {
  if [[ "$database_created" = 1 && "${PRONTOMEDIC_KEEP_TEST_DATABASE:-0}" != "1" ]]; then
    dropdb --if-exists "$database" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

test_pre_cadastro_contract_concurrency() {
  local blocker_pid writer_pid cleanup_pid ready=0 release_fifo="$root/pre-cadastro-release.fifo"
  mkdir -p "$root"
  rm -f "$release_fifo"
  mkfifo "$release_fifo"
  psql -X -v ON_ERROR_STOP=1 -d "$database" >/dev/null <<'SQL'
INSERT INTO public.companies (id, name, lg_ativo)
VALUES ('44000000-0000-4000-8000-000000000001', 'Empresa QA Concorrencia', TRUE)
ON CONFLICT (id) DO UPDATE SET lg_ativo = TRUE;
SQL
  RELEASE_FIFO="$release_fifo" PGAPPNAME=pre_cadastro_contract_blocker \
    psql -X -v ON_ERROR_STOP=1 -d "$database" >/dev/null <<'SQL' &
BEGIN;
LOCK TABLE public.pre_cadastro IN ACCESS EXCLUSIVE MODE;
\! read release_signal < "$RELEASE_FIFO"
COMMIT;
SQL
  blocker_pid=$!
  for _ in $(seq 1 100); do
    if psql -X -Atqc "SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks l
      JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid
      WHERE a.application_name = 'pre_cadastro_contract_blocker'
        AND l.relation = 'public.pre_cadastro'::regclass
        AND l.mode = 'AccessExclusiveLock' AND l.granted)" -d "$database" | grep -qx t; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [[ "$ready" = 1 ]] || {
    echo 'blocker concorrente nao adquiriu AccessExclusiveLock' >&2
    return 1
  }
  echo 'INTEGRATION_CONCURRENCY_BLOCKER_READY'
  PGAPPNAME=pre_cadastro_legacy_writer psql -X -v ON_ERROR_STOP=1 -d "$database" >/dev/null <<'SQL' &
BEGIN;
SET LOCAL ROLE anon;
SELECT * FROM public.create_pre_cadastro(
  '44000000-0000-4000-8000-000000000001', 'Paciente QA Concorrente',
  'writer.contract@example.test', '(11) 97777-7777', DATE '1992-03-03', 'F',
  '01310100', 'Avenida Paulista', '1002', NULL, 'Bela Vista',
  'Sao Paulo', 'SP', 'v1.0-qa', repeat('c', 64)::CHAR(64),
  '127.0.0.1', 'contract-concurrency-test'
);
COMMIT;
SQL
  writer_pid=$!
  ready=0
  for _ in $(seq 1 100); do
    if psql -X -Atqc "SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE application_name = 'pre_cadastro_legacy_writer'
        AND wait_event_type = 'Lock')" -d "$database" | grep -qx t; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [[ "$ready" = 1 ]] || {
    echo 'writer legado nao entrou em espera de lock' >&2
    printf '%s\n' release >"$release_fifo"
    return 1
  }
  echo 'INTEGRATION_CONCURRENCY_WRITER_WAITING'
  psql -X -v ON_ERROR_STOP=1 -d "$database" \
    -f supabase/migrations/20260910224500_retire_legacy_pre_cadastro_rpc_grants.sql >/dev/null
  echo 'INTEGRATION_CONCURRENCY_REVOKE_APPLIED'
  PGAPPNAME=pre_cadastro_cleanup psql -X -v ON_ERROR_STOP=1 -d "$database" \
    -f supabase/migrations/20260910230000_purge_legacy_pre_cadastro_plaintext.sql >/dev/null &
  cleanup_pid=$!
  ready=0
  for _ in $(seq 1 100); do
    if psql -X -Atqc "SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE application_name = 'pre_cadastro_cleanup'
        AND wait_event_type = 'Lock')" -d "$database" | grep -qx t; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [[ "$ready" = 1 ]] || {
    echo 'cleanup nao aguardou drenagem do writer legado' >&2
    printf '%s\n' release >"$release_fifo"
    return 1
  }
  echo 'INTEGRATION_CONCURRENCY_CLEANUP_WAITING'
  printf '%s\n' release >"$release_fifo"
  wait "$blocker_pid" || { echo 'blocker concorrente falhou' >&2; return 1; }
  wait "$writer_pid" || { echo 'writer legado falhou apos drenagem' >&2; return 1; }
  wait "$cleanup_pid" || { echo 'cleanup falhou apos drenagem' >&2; return 1; }
  echo 'INTEGRATION_CONCURRENCY_DRAINED'
  rm -f "$release_fifo"
  test "$(psql -X -Atqc "SELECT count(*) FROM public.pre_cadastro WHERE token_confirmacao IS NOT NULL" -d "$database")" = 0
  psql -X -v ON_ERROR_STOP=1 -d "$database" \
    -f supabase/rollbacks/20260910224500_retire_legacy_pre_cadastro_rpc_grants.sql >/dev/null
  echo 'INTEGRATION_CONCURRENCY_ROLLBACK_APPLIED'
}

rm -rf "$root"
if psql -XAt -d postgres -c 'SELECT datname FROM pg_database' | grep -Fxq "$database"; then
  echo 'banco descartável já existe; recusando exclusão automática' >&2
  exit 1
fi
createdb "$database"
database_created=1
REPLAY_STOP_BEFORE=20260804033225_secure_companies_units_admin_contract.sql \
  scripts/replay-migrations.sh "$database"

psql -X -v ON_ERROR_STOP=1 -d "$database" <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[] NOT NULL DEFAULT '{}',
  name text NOT NULL DEFAULT ''
);
INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260802183000', 'ci_predecessor') ON CONFLICT DO NOTHING;
SQL

for contract in "${contracts[@]}"; do
  IFS='|' read -r version name predecessor rollback_mode smoke_prefix <<<"$contract"
  export PRONTOMEDIC_DATABASE="$database"
  export PRONTOMEDIC_DB_BACKUP_ROOT="$root/$version/backups"
  export PRONTOMEDIC_DB_STATE_ROOT="$root/state"
  export PRONTOMEDIC_GLOBAL_DEPLOY_LOCK="$root/global.lock"
  stage="$root/$version/stage"
  bundle="$root/$version/database-${sha}.tgz"
  checksum="${bundle}.sha256"
  install -d "$stage"
  if [[ "$version" = 20260910223000 ]]; then
    {
      printf '%s\n' 'BEGIN;'
      cat "supabase/migrations/${version}_${name}.sql"
      printf '%s\n' 'COMMIT;'
    } > "$stage/migration.sql"
  else
    cp "supabase/migrations/${version}_${name}.sql" "$stage/migration.sql"
  fi
  cp "supabase/rollbacks/${version}_${name}.sql" "$stage/rollback.sql"
  if [[ "$version" = 20260910230000 ]]; then
    for phase in before applied rollback; do
      cat deploy/database/pre-cadastro-contract-applied.sql \
        "deploy/database/${smoke_prefix}-${phase}.sql" \
        > "$stage/smoke-${phase}.sql"
    done
  else
    cp "deploy/database/${smoke_prefix}-before.sql" "$stage/smoke-before.sql"
    cp "deploy/database/${smoke_prefix}-applied.sql" "$stage/smoke-applied.sql"
    cp "deploy/database/${smoke_prefix}-rollback.sql" "$stage/smoke-rollback.sql"
  fi
  node - "$stage" "$sha" "$version" "$name" "$predecessor" "$rollback_mode" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [stage, commitSha, migrationVersion, migrationName, predecessorVersion, rollbackMode] = process.argv.slice(2);
const files = {};
for (const file of ['migration.sql', 'rollback.sql', 'smoke-before.sql', 'smoke-applied.sql', 'smoke-rollback.sql']) {
  files[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(stage, file))).digest('hex');
}
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({
  schemaVersion: 2, commitSha, migrationVersion, migrationName,
  predecessorVersion, rollbackMode, files
}, null, 2) + '\n');
NODE
  tar -C "$stage" -czf "$bundle" .
  (cd "$(dirname "$bundle")" && sha256sum "$(basename "$bundle")" > "$(basename "$checksum")")
  if [[ "$version" = 20260910224500 ]]; then
    psql -X -v ON_ERROR_STOP=1 -d "$database" -c \
      'CREATE FUNCTION public.confirm_pre_cadastro(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$' >/dev/null
    if psql -X -v ON_ERROR_STOP=1 -d "$database" \
      -f deploy/database/pre-cadastro-contract-before.sql >/dev/null 2>&1; then
      echo 'smoke anterior aceitou overload legado desconhecido' >&2
      exit 1
    fi
    psql -X -v ON_ERROR_STOP=1 -d "$database" -c \
      'DROP FUNCTION public.confirm_pre_cadastro(text)' >/dev/null
  fi
  if [[ "$version" = 20260910230000 ]]; then
    psql -X -v ON_ERROR_STOP=1 -d "$database" >/dev/null <<'SQL'
INSERT INTO public.pre_cadastro (
  id, company_id, full_name, email, versao_termo, texto_termo_hash,
  token_confirmacao, token_confirmacao_hash, dt_token_exp, status
)
SELECT '43000000-0000-4000-8000-000000000001', id,
  'Paciente QA Hash Divergente', 'hash-divergente.contract@example.test',
  'v1.0-qa', repeat('a', 64), 'contract-plaintext-token-qa', repeat('0', 64),
  clock_timestamp() + interval '1 day', 'PENDENTE'
FROM public.companies ORDER BY id LIMIT 1;
SQL
    if psql -X -v ON_ERROR_STOP=1 -d "$database" \
      -f deploy/database/pre-cadastro-cleanup-before.sql >/dev/null 2>&1; then
      echo 'smoke anterior aceitou plaintext com hash divergente' >&2
      exit 1
    fi
    psql -X -v ON_ERROR_STOP=1 -d "$database" -c \
      "DELETE FROM public.pre_cadastro WHERE id = '43000000-0000-4000-8000-000000000001'" >/dev/null
    psql -X -v ON_ERROR_STOP=1 -d "$database" >/dev/null <<'SQL'
INSERT INTO public.pre_cadastro (
  id, company_id, full_name, email, versao_termo, texto_termo_hash,
  token_confirmacao, token_confirmacao_hash, dt_token_exp, status
)
SELECT '43000000-0000-4000-8000-000000000002', id,
  'Paciente QA Backfill', 'backfill.contract@example.test',
  'v1.0-qa', repeat('a', 64), 'contract-backfill-token-qa', NULL,
  clock_timestamp() + interval '1 day', 'PENDENTE'
FROM public.companies ORDER BY id LIMIT 1;
SQL
  fi
  bash deploy/database/deploy-migration.sh audit
  bash deploy/database/deploy-migration.sh preflight "$sha" "$bundle" "$checksum"
  if [[ "$version" = 20260804033225 ]]; then
    psql -X -v ON_ERROR_STOP=1 -d "$database" -c 'CREATE TABLE public.preflight_staleness_probe(id integer); DROP TABLE public.preflight_staleness_probe' >/dev/null
  fi
  bash deploy/database/deploy-migration.sh deploy "$sha" "$bundle" "$checksum"
  echo "INTEGRATION_DEPLOY_VERIFIED migration=$version"
  if [[ "$version" = 20260910230000 ]]; then
    test "$(psql -X -Atqc "SELECT count(*) FROM public.pre_cadastro
      WHERE id = '43000000-0000-4000-8000-000000000002'
        AND token_confirmacao IS NULL
        AND token_confirmacao_hash = encode(public.digest('contract-backfill-token-qa', 'sha256'), 'hex')" -d "$database")" = 1
  fi
  if [[ "$version" = 20260910223000 ]]; then
    echo 'INTEGRATION_PRE_CADASTRO_EXPAND_COMPATIBILITY_START'
    psql -X -v ON_ERROR_STOP=1 -d "$database" \
      -f tests/database/pre_cadastro_expand_compatibility.sql >/dev/null
    echo 'INTEGRATION_PRE_CADASTRO_CONCURRENCY_START'
    test_pre_cadastro_contract_concurrency
    echo 'INTEGRATION_PRE_CADASTRO_CONCURRENCY_PASS'
  fi
  test "$(find "$root/$version/backups" -maxdepth 1 -name '*.dump' -type f | wc -l)" -ge 2
  echo "INTEGRATION_BACKUPS_VERIFIED migration=$version"
  if bash deploy/database/deploy-migration.sh preflight "$sha" "$bundle" "$checksum"; then
    echo "migration aplicada aceitou novo preflight: $version" >&2
    exit 1
  fi
done

bash deploy/database/deploy-migration.sh rollback
# First rollback preserves the hashed schema and returns to the revoked ACL state.
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910230000'" -d "$database")" = 0
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910224500'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910223000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260905030000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260904183653'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260902055133'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260902022540'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260829014500'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260829013235'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260829012947'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260813001000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812211247'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812170000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812150000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260812021457'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260811210000'" -d "$database")" = 1
# shellcheck disable=SC1090
. "$root/state/last-deploy.env"
# rollback archives the cleanup state and promotes the ACL contract as current.
test "$MIGRATION_VERSION" = 20260910224500
bash deploy/database/deploy-migration.sh rollback
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910224500'" -d "$database")" = 0
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910223000'" -d "$database")" = 1
. "$root/state/last-deploy.env"
test "$MIGRATION_VERSION" = 20260910223000
latest_backup="$(find "$root/20260910230000/backups" -maxdepth 1 -name '*.dump' -type f | sort | tail -n 1)"
test -n "$latest_backup"
if PRONTOMEDIC_DB_INJECT_RESTORE_STATE_FAILURE=1 \
  PRONTOMEDIC_DB_RESTORE_CONFIRM="RESTORE:${database}" \
  bash deploy/database/deploy-migration.sh restore "$latest_backup" "${latest_backup}.sha256"; then
  echo 'restore com falha injetada terminou com sucesso' >&2
  exit 1
fi
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910224500'" -d "$database")" = 0
# shellcheck disable=SC1090
. "$root/state/last-deploy.env"
test "$MIGRATION_VERSION" = 20260910223000
PRONTOMEDIC_DB_RESTORE_CONFIRM="RESTORE:${database}" \
  bash deploy/database/deploy-migration.sh restore "$latest_backup" "${latest_backup}.sha256"
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910230000'" -d "$database")" = 0
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910224500'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260910223000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260905030000'" -d "$database")" = 1
test "$(psql -X -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260904183653'" -d "$database")" = 1
# shellcheck disable=SC1090
. "$root/state/last-deploy.env"
test "$MIGRATION_VERSION" = 20260910224500
bash deploy/database/deploy-migration.test.sh
echo "DATABASE_DEPLOY_INTEGRATION_PASS"
