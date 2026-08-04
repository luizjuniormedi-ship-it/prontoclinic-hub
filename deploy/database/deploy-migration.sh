#!/usr/bin/env bash
set -Eeuo pipefail

readonly database="${PRONTOMEDIC_DATABASE:-prontoclinic}"
readonly backup_root="${PRONTOMEDIC_DB_BACKUP_ROOT:-/var/backups/prontomedic/database}"
readonly state_root="${PRONTOMEDIC_DB_STATE_ROOT:-/var/lib/prontomedic/database-deploy}"
readonly global_lock="${PRONTOMEDIC_GLOBAL_DEPLOY_LOCK:-/var/lock/prontomedic-deploy.lock}"
migration_version=""
migration_name=""

die() { printf 'PRONTOMEDIC_DB_DEPLOY_ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'PRONTOMEDIC_DB_DEPLOY: %s\n' "$*"; }

usage() {
  cat >&2 <<'USAGE'
Uso:
  deploy-migration.sh audit
  deploy-migration.sh preflight <commit-sha> <bundle.tgz> <bundle.tgz.sha256>
  deploy-migration.sh deploy <commit-sha> <bundle.tgz> <bundle.tgz.sha256>
  deploy-migration.sh rollback
USAGE
  exit 64
}

require_root() {
  if [[ "${PRONTOMEDIC_DB_TEST_MODE:-0}" != 1 ]]; then
    [[ "$(id -u)" = 0 ]] || die 'execucao requer root'
  fi
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "comando ausente: $1"; }

require_absolute_file() {
  [[ "$1" = /* ]] || die "caminho nao absoluto: $1"
  [[ "$1" != *$'\n'* && "$1" != *$'\r'* ]] || die 'caminho contem caractere de controle'
  [[ -f "$1" && ! -L "$1" ]] || die "arquivo regular ausente: $1"
}

host_postgres() {
  if [[ "${PRONTOMEDIC_DB_DIRECT_POSTGRES:-0}" = 1 ]]; then
    [[ "${PRONTOMEDIC_DB_TEST_MODE:-0}" = 1 ]] \
      || die 'modo PostgreSQL direto permitido somente em teste'
    "$@"
  else
    docker run --rm --privileged -i -v /:/host alpine:3.20 \
      chroot /host runuser -u postgres -- "$@"
  fi
}

psql_db() {
  local target="$1"; shift
  host_postgres psql -X -v ON_ERROR_STOP=1 -d "$target" "$@"
}

safe_database_contract() {
  [[ "$database" =~ ^[a-zA-Z0-9_]+$ ]] || die 'nome do banco invalido'
  [[ "${database,,}" != *datasigh* ]] || die 'banco legado e proibido neste coordenador'
  [[ "$database" = prontoclinic* ]] || die "banco fora do contrato ProntoMedic: $database"
}

history_contract() {
  local result
  result="$(psql_db "$database" -Atqc "
    SELECT CASE
      WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'missing'
      WHEN (SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'supabase_migrations'
              AND table_name = 'schema_migrations'
              AND column_name IN ('version', 'name', 'statements')) = 3
      THEN 'ready' ELSE 'incompatible' END")"
  [[ "$result" = ready || "$result" = missing ]] || die 'historico supabase_migrations incompativel'
  printf '%s' "$result"
}

history_absent() {
  [[ "$(history_contract)" = missing ]] && return 0
  [[ "$(psql_db "$database" -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'")" = 0 ]] \
    || die "migration $migration_version ja registrada"
}

history_present() {
  [[ "$(history_contract)" = ready ]] && \
    [[ "$(psql_db "$database" -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'")" = 1 ]]
}

ensure_history() {
  local target="$1"
  psql_db "$target" -c "
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      statements text[] NOT NULL DEFAULT ARRAY[]::text[]
    )" >/dev/null
}

verify_checksum() {
  local bundle="$1" checksum="$2"
  require_absolute_file "$bundle"
  require_absolute_file "$checksum"
  (cd "$(dirname "$bundle")" && sha256sum -c "$(basename "$checksum")") >/dev/null \
    || die 'checksum do bundle invalido'
}

extract_bundle() {
  local bundle="$1" destination="$2"
  if tar -tzf "$bundle" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die 'bundle contem caminho inseguro'
  fi
  mkdir "$destination"
  tar --no-same-owner --no-same-permissions -xzf "$bundle" -C "$destination"
  chmod 0755 "$(dirname "$destination")" "$destination"
  find "$destination" -type d -exec chmod 0755 {} +
  find "$destination" -type f -exec chmod 0644 {} +
}

verify_manifest() {
  local stage="$1" sha="$2"
  node - "$stage" "$sha" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [stage, sha] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.commitSha !== sha ||
    !/^\d{14}$/.test(manifest.migrationVersion) ||
    !/^[a-z0-9_]+$/.test(manifest.migrationName)) process.exit(2);
const expected = [
  'migration.sql', 'rollback.sql', 'smoke-before.sql',
  'smoke-applied.sql', 'smoke-rollback.sql'
];
if (Object.keys(manifest.files).sort().join('|') !== expected.sort().join('|')) process.exit(3);
for (const file of expected) {
  const bytes = fs.readFileSync(path.join(stage, file));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (manifest.files[file] !== digest) process.exit(4);
}
NODE
}

load_manifest_contract() {
  local stage="$1"
  IFS=$'\t' read -r migration_version migration_name < <(
    node -e "const m=require(process.argv[1]); process.stdout.write(m.migrationVersion+'\\t'+m.migrationName+'\\n')" \
      "$stage/manifest.json"
  )
  case "${migration_version}:${migration_name}" in
    20260804033225:secure_companies_units_admin_contract|20260804143000:rbac_active_context_aal2) ;;
    *) die 'migration fora da allowlist do coordenador' ;;
  esac
}

verify_transactional_sql() {
  local file="$1" label="$2"
  grep -Eq '^[[:space:]]*BEGIN[[:space:]]*;' "$file" || die "$label nao abre transacao"
  grep -Eq '^[[:space:]]*COMMIT[[:space:]]*;' "$file" || die "$label nao confirma transacao"
  [[ "$(grep -Eic '^[[:space:]]*(BEGIN|START TRANSACTION)[[:space:]]*;' "$file")" = 1 ]] \
    || die "$label contem abertura transacional ambigua"
  [[ "$(grep -Eic '^[[:space:]]*COMMIT[[:space:]]*;' "$file")" = 1 ]] \
    || die "$label contem commit ambiguo"
}

validate_bundle() {
  local stage="$1" sha="$2"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die 'SHA Git invalido'
  for file in manifest.json migration.sql rollback.sql smoke-before.sql smoke-applied.sql smoke-rollback.sql; do
    [[ -f "$stage/$file" && ! -L "$stage/$file" ]] || die "arquivo ausente no bundle: $file"
  done
  verify_manifest "$stage" "$sha" || die 'manifest do bundle invalido'
  load_manifest_contract "$stage"
  verify_transactional_sql "$stage/migration.sql" migration
  verify_transactional_sql "$stage/rollback.sql" rollback
}

run_smoke() { psql_db "$1" -f "$2" >/dev/null; }

write_attestation() {
  local file="$1" sha="$2" bundle_hash="$3" backup="$4"
  umask 077
  {
    printf 'COMMIT_SHA=%q\n' "$sha"
    printf 'BUNDLE_SHA256=%q\n' "$bundle_hash"
    printf 'DATABASE_BACKUP=%q\n' "$backup"
    printf 'CREATED_AT_EPOCH=%q\n' "$(date +%s)"
  } >"${file}.next"
  mv -f "${file}.next" "$file"
}

write_deploy_state() {
  local file="$1" sha="$2" bundle_copy="$3" backup="$4"
  umask 077
  {
    printf 'COMMIT_SHA=%q\n' "$sha"
    printf 'BUNDLE_COPY=%q\n' "$bundle_copy"
    printf 'DATABASE_BACKUP=%q\n' "$backup"
    printf 'MIGRATION_VERSION=%q\n' "$migration_version"
  } >"${file}.next"
  mv -f "${file}.next" "$file"
}

backup_and_rehearse() {
  local stage="$1" sha="$2" backup="$3"
  local restore_db="prontoclinic_restore_${migration_version}_$$"

  host_postgres pg_dump -Fc -d "$database" >"${backup}.next"
  [[ -s "${backup}.next" ]] || die 'backup PostgreSQL vazio'
  host_postgres pg_restore --list <"${backup}.next" >/dev/null \
    || die 'catalogo do backup PostgreSQL invalido'
  mv -f "${backup}.next" "$backup"
  chmod 600 "$backup"

  (
    restore_created=0
    cleanup_restore() {
      if [[ "$restore_created" = 1 ]]; then
        host_postgres dropdb --if-exists "$restore_db" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup_restore EXIT
    host_postgres createdb -T template0 "$restore_db"
    restore_created=1
    host_postgres pg_restore --exit-on-error -d "$restore_db" <"$backup" >/dev/null
    run_smoke "$restore_db" "$stage/smoke-before.sql"
    ensure_history "$restore_db"
    psql_db "$restore_db" -f "$stage/migration.sql" >/dev/null
    run_smoke "$restore_db" "$stage/smoke-applied.sql"
    psql_db "$restore_db" -f "$stage/rollback.sql" >/dev/null
    run_smoke "$restore_db" "$stage/smoke-rollback.sql"
  )
  log "RESTORE_REHEARSAL_OK sha=$sha backup=$backup"
}

audit() {
  require_root
  safe_database_contract
  for command in docker tar sha256sum node flock date; do require_command "$command"; done
  if [[ "${PRONTOMEDIC_DB_DIRECT_POSTGRES:-0}" = 1 ]]; then
    for command in psql pg_dump pg_restore createdb dropdb; do require_command "$command"; done
  fi
  [[ "$(psql_db "$database" -Atqc 'SELECT 1')" = 1 ]] || die 'PostgreSQL indisponivel'
  log "AUDIT_OK database=$database history=$(history_contract)"
}

preflight() {
  local sha="$1" bundle="$2" checksum="$3"
  local stage timestamp backup bundle_hash attestation
  audit
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  verify_checksum "$bundle" "$checksum"
  stage="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$stage")" EXIT
  extract_bundle "$bundle" "$stage/release"
  validate_bundle "$stage/release" "$sha"
  history_absent
  run_smoke "$database" "$stage/release/smoke-before.sql"

  install -d -m 0700 "$backup_root" "$state_root"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$backup_root/prontoclinic-before-${migration_version}-${sha}-${timestamp}.dump"
  bundle_hash="$(sha256sum "$bundle" | cut -d' ' -f1)"
  attestation="$state_root/preflight-${migration_version}-${sha}.env"
  backup_and_rehearse "$stage/release" "$sha" "$backup"
  write_attestation "$attestation" "$sha" "$bundle_hash" "$backup"
  chmod 600 "$attestation"
  log "PREFLIGHT_OK sha=$sha attestation=$attestation"
  rm -rf -- "$stage"
  trap - EXIT
}

insert_history() {
  local checksum="$1"
  psql_db "$database" -c "
    INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
    VALUES ('$migration_version', '$migration_name', ARRAY['sha256:$checksum'])
    ON CONFLICT (version) DO NOTHING" >/dev/null
  history_present || die 'nao foi possivel registrar historico da migration'
}

apply_rollback() {
  local stage="$1"
  psql_db "$database" -f "$stage/rollback.sql" >/dev/null
  run_smoke "$database" "$stage/smoke-rollback.sql"
}

deploy() {
  local sha="$1" bundle="$2" checksum="$3"
  local stage attestation bundle_hash backup created bundle_copy state
  audit
  verify_checksum "$bundle" "$checksum"
  stage="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$stage")" EXIT
  extract_bundle "$bundle" "$stage/release"
  validate_bundle "$stage/release" "$sha"
  bundle_hash="$(sha256sum "$bundle" | cut -d' ' -f1)"
  attestation="$state_root/preflight-${migration_version}-${sha}.env"
  [[ -f "$attestation" && ! -L "$attestation" ]] || die 'atestacao de preflight ausente'
  # shellcheck disable=SC1090
  . "$attestation"
  [[ "$COMMIT_SHA" = "$sha" && "$BUNDLE_SHA256" = "$bundle_hash" ]] \
    || die 'atestacao nao corresponde ao bundle'
  [[ $(( $(date +%s) - CREATED_AT_EPOCH )) -le 3600 ]] || die 'atestacao de preflight expirada'
  [[ -s "$DATABASE_BACKUP" ]] || die 'backup atestado ausente'
  host_postgres pg_restore --list <"$DATABASE_BACKUP" >/dev/null || die 'backup atestado invalido'

  install -d -m 0700 "$backup_root" "$state_root"
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  history_absent

  run_smoke "$database" "$stage/release/smoke-before.sql"

  bundle_copy="$backup_root/bundle-${migration_version}-${sha}.tgz"
  cp -- "$bundle" "${bundle_copy}.next"
  mv -f "${bundle_copy}.next" "$bundle_copy"
  chmod 600 "$bundle_copy"
  state="$state_root/last-deploy.env"
  write_deploy_state "$state" "$sha" "$bundle_copy" "$DATABASE_BACKUP"
  chmod 600 "$state"

  created=0
  rollback_on_error() {
    local status=$?
    trap - ERR
    set +e
    if [[ "$created" = 1 ]]; then
      apply_rollback "$stage/release"
      rollback_status=$?
    else
      rollback_status=0
    fi
    mv -f "$state" "$state_root/last-deploy.failed-$(date -u +%Y%m%dT%H%M%SZ).env" 2>/dev/null || true
    printf 'PRONTOMEDIC_DB_DEPLOY_ROLLED_BACK status=%s rollback_status=%s backup=%s\n' \
      "$status" "$rollback_status" "$DATABASE_BACKUP" >&2
    [[ "$rollback_status" = 0 ]] || exit 70
    exit "$status"
  }
  trap rollback_on_error ERR

  ensure_history "$database"
  psql_db "$database" -f "$stage/release/migration.sql" >/dev/null
  created=1
  insert_history "$(sha256sum "$stage/release/migration.sql" | cut -d' ' -f1)"
  run_smoke "$database" "$stage/release/smoke-applied.sql"

  trap - ERR
  rm -f "$attestation"
  log "DEPLOY_OK sha=$sha migration=$migration_version backup=$DATABASE_BACKUP"
  rm -rf -- "$stage"
  trap - EXIT
}

rollback() {
  local state="$state_root/last-deploy.env" stage
  audit
  [[ -f "$state" && ! -L "$state" ]] || die 'estado de rollback ausente'
  # shellcheck disable=SC1090
  . "$state"
  migration_version="$MIGRATION_VERSION"
  [[ -s "$BUNDLE_COPY" && -s "$DATABASE_BACKUP" ]] || die 'artefato ou backup de rollback ausente'
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  history_present || die 'migration nao esta registrada; rollback recusado'
  stage="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$stage")" EXIT
  extract_bundle "$BUNDLE_COPY" "$stage/release"
  validate_bundle "$stage/release" "$COMMIT_SHA"
  [[ "$MIGRATION_VERSION" = "$migration_version" ]] || die 'estado de rollback incompativel'
  apply_rollback "$stage/release"
  mv -f "$state" "$state_root/last-deploy.rolled-back-$(date -u +%Y%m%dT%H%M%SZ).env"
  log "ROLLBACK_OK migration=$migration_version backup=$DATABASE_BACKUP"
  rm -rf -- "$stage"
  trap - EXIT
}

command="${1:-}"
case "$command" in
  audit|rollback)
    [[ "$#" = 1 ]] || usage
    "$command"
    ;;
  preflight|deploy)
    [[ "$#" = 4 ]] || usage
    shift
    "$command" "$@"
    ;;
  *) usage ;;
esac
