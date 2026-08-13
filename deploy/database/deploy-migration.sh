#!/usr/bin/env bash
set -Eeuo pipefail

readonly database="${PRONTOMEDIC_DATABASE:-prontoclinic}"
readonly backup_root="${PRONTOMEDIC_DB_BACKUP_ROOT:-/var/backups/prontomedic/database}"
readonly state_root="${PRONTOMEDIC_DB_STATE_ROOT:-/var/lib/prontomedic/database-deploy}"
readonly global_lock="${PRONTOMEDIC_GLOBAL_DEPLOY_LOCK:-/var/lock/prontomedic-deploy.lock}"
migration_version=""
migration_name=""
predecessor_version=""
rollback_mode=""

die() { printf 'PRONTOMEDIC_DB_DEPLOY_ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'PRONTOMEDIC_DB_DEPLOY: %s\n' "$*"; }

usage() {
  cat >&2 <<'USAGE'
Uso:
  deploy-migration.sh audit
  deploy-migration.sh preflight <commit-sha> <bundle.tgz> <bundle.tgz.sha256>
  deploy-migration.sh deploy <commit-sha> <bundle.tgz> <bundle.tgz.sha256>
  deploy-migration.sh rollback
  PRONTOMEDIC_DB_RESTORE_CONFIRM=RESTORE:<database> deploy-migration.sh restore <backup.dump> <backup.dump.sha256>
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
  local target="${1:-$database}" result
  result="$(psql_db "$target" -Atqc "
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
  local target="${1:-$database}"
  [[ "$(history_contract "$target")" = missing ]] && return 0
  [[ "$(psql_db "$target" -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'")" = 0 ]] \
    || die "migration $migration_version ja registrada"
}

history_present() {
  local target="${1:-$database}"
  [[ "$(history_contract "$target")" = ready ]] && \
    [[ "$(psql_db "$target" -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'")" = 1 ]]
}

delete_history() {
  local target="${1:-$database}"
  psql_db "$target" -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'" >/dev/null
  history_absent "$target"
}

history_version_present() {
  local target="$1" version="$2"
  [[ "$(history_contract "$target")" = ready ]] &&
    [[ "$(psql_db "$target" -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '$version'")" = 1 ]]
}

require_predecessor() {
  local target="${1:-$database}"
  history_version_present "$target" "$predecessor_version" \
    || die "migration predecessora ausente: $predecessor_version"
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
if (manifest.schemaVersion !== 2 || manifest.commitSha !== sha ||
    !/^\d{14}$/.test(manifest.migrationVersion) ||
    !/^[a-z0-9_]+$/.test(manifest.migrationName) ||
    !/^\d{14}$/.test(manifest.predecessorVersion) ||
    !['inverse', 'forward_only', 'preserve_schema'].includes(manifest.rollbackMode)) process.exit(2);
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
  IFS=$'\t' read -r migration_version migration_name predecessor_version rollback_mode < <(
    node -e "const m=require(process.argv[1]); process.stdout.write([m.migrationVersion,m.migrationName,m.predecessorVersion,m.rollbackMode].join('\\t')+'\\n')" \
      "$stage/manifest.json"
  )
  case "${migration_version}:${migration_name}:${predecessor_version}:${rollback_mode}" in
    20260804033225:secure_companies_units_admin_contract:20260802183000:inverse|\
    20260804143000:rbac_active_context_aal2:20260804033225:inverse|\
    20260805123000:auth_admin_suspension_invariants:20260804143000:inverse|\
    20260811120000:reception_worklist_handoff:20260805123000:inverse|\
    20260811210000:dicom_worklist_rls_hardening:20260811120000:forward_only|\
    20260812021457:pharmacy_runtime_closure:20260811210000:preserve_schema|\
    20260812150000:medical_attendance_atomic_completion:20260812021457:preserve_schema|\
    20260812170000:medical_attendance_billing_handoff:20260812150000:preserve_schema|\
    20260812211247:tiss_account_materialization_contract:20260812170000:preserve_schema|\
    20260813001000:canonical_reception_billing_tiss_handoff:20260812211247:preserve_schema) ;;
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

database_fingerprint() {
  local previous current attempt
  previous="$(psql_db "$database" -Atqc "
    SELECT concat_ws(':', COALESCE(tup_inserted, 0), COALESCE(tup_updated, 0), COALESCE(tup_deleted, 0))
      FROM pg_stat_database WHERE datname = current_database()")"
  for attempt in {1..10}; do
    sleep 1
    current="$(psql_db "$database" -Atqc "
      SELECT concat_ws(':', COALESCE(tup_inserted, 0), COALESCE(tup_updated, 0), COALESCE(tup_deleted, 0))
        FROM pg_stat_database WHERE datname = current_database()")"
    if [[ "$current" = "$previous" ]]; then
      printf '%s\n' "$current"
      return 0
    fi
    previous="$current"
  done
  die 'contadores logicos do banco nao estabilizaram; deploy recusado'
}

verify_private_file() {
  local file="$1" mode
  require_absolute_file "$file"
  mode="$(stat -c '%a' "$file")"
  [[ "$mode" = 600 ]] || die "permissao insegura em $file: $mode"
}

verify_backup() {
  local backup="$1" checksum="$2"
  verify_private_file "$backup"
  verify_private_file "$checksum"
  (cd "$(dirname "$backup")" && sha256sum -c "$(basename "$checksum")") >/dev/null \
    || die 'checksum do backup PostgreSQL invalido'
  host_postgres pg_restore --list <"$backup" >/dev/null || die 'catalogo do backup PostgreSQL invalido'
}

require_backup_space() {
  local available_kb database_bytes required_kb
  available_kb="$(df -Pk "$backup_root" | awk 'NR==2 {print $4}')"
  database_bytes="$(psql_db "$database" -Atqc "SELECT pg_database_size(current_database())")"
  [[ "$available_kb" =~ ^[0-9]+$ && "$database_bytes" =~ ^[0-9]+$ ]] || die 'nao foi possivel calcular espaco para backup'
  required_kb=$(( (database_bytes * 2 + 1023) / 1024 ))
  (( available_kb >= required_kb )) || die "espaco insuficiente para backup e restauracao: disponivel=${available_kb}KB requerido=${required_kb}KB"
}

write_attestation() {
  local file="$1" sha="$2" bundle_hash="$3" backup="$4" backup_checksum="$5" fingerprint="$6"
  umask 077
  {
    printf 'COMMIT_SHA=%q\n' "$sha"
    printf 'BUNDLE_SHA256=%q\n' "$bundle_hash"
    printf 'DATABASE_BACKUP=%q\n' "$backup"
    printf 'DATABASE_BACKUP_CHECKSUM=%q\n' "$backup_checksum"
    printf 'DATABASE_FINGERPRINT=%q\n' "$fingerprint"
    printf 'CREATED_AT_EPOCH=%q\n' "$(date +%s)"
  } >"${file}.next"
  mv -f "${file}.next" "$file"
}

write_deploy_state() {
  local file="$1" sha="$2" bundle_copy="$3" backup="$4" backup_checksum="$5" state_record="$6"
  umask 077
  {
    printf 'COMMIT_SHA=%q\n' "$sha"
    printf 'BUNDLE_COPY=%q\n' "$bundle_copy"
    printf 'DATABASE_BACKUP=%q\n' "$backup"
    printf 'DATABASE_BACKUP_CHECKSUM=%q\n' "$backup_checksum"
    printf 'MIGRATION_VERSION=%q\n' "$migration_version"
    printf 'STATE_RECORD=%q\n' "$state_record"
  } >"${file}.next"
  mv -f "${file}.next" "$file"
}

promote_previous_state() {
  local last_state="$state_root/last-deploy.env" candidate selected=''
  rm -f "$last_state"
  for candidate in "$state_root"/deploy-*.env; do
    [[ -f "$candidate" && ! -L "$candidate" ]] || continue
    if [[ -z "$selected" || "$candidate" > "$selected" ]]; then
      selected="$candidate"
    fi
  done
  if [[ -n "$selected" ]]; then
    cp -- "$selected" "${last_state}.next"
    mv -f "${last_state}.next" "$last_state"
    chmod 600 "$last_state"
  fi
}

backup_and_rehearse() {
  local stage="$1" sha="$2" backup="$3" backup_checksum="${3}.sha256"
  local restore_db="prontoclinic_restore_${migration_version}_$$"

  host_postgres pg_dump -Fc -d "$database" >"${backup}.next"
  [[ -s "${backup}.next" ]] || die 'backup PostgreSQL vazio'
  host_postgres pg_restore --list <"${backup}.next" >/dev/null \
    || die 'catalogo do backup PostgreSQL invalido'
  mv -f "${backup}.next" "$backup"
  chmod 600 "$backup"
  (cd "$(dirname "$backup")" && sha256sum "$(basename "$backup")" >"$(basename "$backup_checksum").next")
  mv -f "${backup_checksum}.next" "$backup_checksum"
  chmod 600 "$backup_checksum"
  verify_backup "$backup" "$backup_checksum"

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
    require_predecessor "$restore_db"
    ensure_history "$restore_db"
    psql_db "$restore_db" -f "$stage/migration.sql" >/dev/null
    insert_history "$restore_db" "$(sha256sum "$stage/migration.sql" | cut -d' ' -f1)"
    run_smoke "$restore_db" "$stage/smoke-applied.sql"
    psql_db "$restore_db" -f "$stage/rollback.sql" >/dev/null
    run_smoke "$restore_db" "$stage/smoke-rollback.sql"
    if [[ "$rollback_mode" = inverse ]]; then
      history_absent "$restore_db"
    else
      history_present "$restore_db" || die "rollback $rollback_mode removeu o ledger indevidamente"
    fi
  )
  log "RESTORE_REHEARSAL_OK sha=$sha backup=$backup"
}

audit() {
  require_root
  safe_database_contract
  for command in docker tar sha256sum node flock date stat df awk; do require_command "$command"; done
  if [[ "${PRONTOMEDIC_DB_DIRECT_POSTGRES:-0}" = 1 ]]; then
    for command in psql pg_dump pg_restore createdb dropdb; do require_command "$command"; done
  fi
  [[ "$(psql_db "$database" -Atqc 'SELECT 1')" = 1 ]] || die 'PostgreSQL indisponivel'
  log "AUDIT_OK database=$database history=$(history_contract)"
}

prepare_private_dirs() {
  if [[ "${PRONTOMEDIC_DB_TEST_MODE:-0}" = 1 ]]; then
    mkdir -p "$backup_root" "$state_root"
  else
    install -d -m 0700 "$backup_root" "$state_root"
  fi
}

preflight() {
  local sha="$1" bundle="$2" checksum="$3"
  local stage timestamp backup bundle_hash attestation fingerprint
  audit
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  verify_checksum "$bundle" "$checksum"
  stage="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$stage")" EXIT
  extract_bundle "$bundle" "$stage/release"
  validate_bundle "$stage/release" "$sha"
  history_absent
  require_predecessor
  run_smoke "$database" "$stage/release/smoke-before.sql"

  prepare_private_dirs
  require_backup_space
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$backup_root/prontoclinic-before-${migration_version}-${sha}-${timestamp}.dump"
  bundle_hash="$(sha256sum "$bundle" | cut -d' ' -f1)"
  attestation="$state_root/preflight-${migration_version}-${sha}.env"
  backup_and_rehearse "$stage/release" "$sha" "$backup"
  fingerprint="$(database_fingerprint)"
  write_attestation "$attestation" "$sha" "$bundle_hash" "$backup" "${backup}.sha256" "$fingerprint"
  chmod 600 "$attestation"
  log "PREFLIGHT_OK sha=$sha attestation=$attestation"
  rm -rf -- "$stage"
  trap - EXIT
}

insert_history() {
  local target="$1" checksum="$2"
  psql_db "$target" -c "
    INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
    VALUES ('$migration_version', '$migration_name', ARRAY['sha256:$checksum'])
    ON CONFLICT (version) DO NOTHING" >/dev/null
  history_present "$target" || die 'nao foi possivel registrar historico da migration'
}

apply_rollback() {
  local stage="$1"
  psql_db "$database" -f "$stage/rollback.sql" >/dev/null
  run_smoke "$database" "$stage/smoke-rollback.sql"
  if [[ "$rollback_mode" = inverse ]]; then
    history_absent
  elif [[ "$rollback_mode" = preserve_schema ]]; then
    delete_history
  else
    history_present || die "rollback $rollback_mode removeu o ledger indevidamente"
  fi
}

deploy() {
  local sha="$1" bundle="$2" checksum="$3"
  local stage attestation bundle_hash backup created bundle_copy state state_record timestamp deploy_fingerprint
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
  verify_backup "$DATABASE_BACKUP" "$DATABASE_BACKUP_CHECKSUM"

  prepare_private_dirs
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  history_absent
  require_predecessor

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="$backup_root/prontoclinic-deploy-${migration_version}-${sha}-${timestamp}.dump"
  # Measure committed tuple writes in the target database across the backup
  # window. Cluster WAL is unsuitable here because reads, hint bits and the
  # restore rehearsal in another database can advance it without changing the
  # target database.
  run_smoke "$database" "$stage/release/smoke-before.sql"
  deploy_fingerprint="$(database_fingerprint)"
  backup_and_rehearse "$stage/release" "$sha" "$backup"
  DATABASE_BACKUP="$backup"
  DATABASE_BACKUP_CHECKSUM="${backup}.sha256"
  [[ "$(database_fingerprint)" = "$deploy_fingerprint" ]] \
    || die 'banco mudou entre o backup sob lock e a migration; deploy recusado'

  bundle_copy="$backup_root/bundle-${migration_version}-${sha}.tgz"
  cp -- "$bundle" "${bundle_copy}.next"
  mv -f "${bundle_copy}.next" "$bundle_copy"
  chmod 600 "$bundle_copy"
  state="$state_root/last-deploy.env"
  state_record="$state_root/deploy-${migration_version}-${sha}.env"
  write_deploy_state "$state_record" "$sha" "$bundle_copy" "$DATABASE_BACKUP" "$DATABASE_BACKUP_CHECKSUM" "$state_record"
  cp -- "$state_record" "${state}.next"
  mv -f "${state}.next" "$state"
  chmod 600 "$state_record"
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
    mv -f "$state_record" "$state_root/deploy-${migration_version}-${sha}.failed-$(date -u +%Y%m%dT%H%M%SZ).archive" 2>/dev/null || true
    promote_previous_state
    printf 'PRONTOMEDIC_DB_DEPLOY_ROLLED_BACK status=%s rollback_status=%s backup=%s\n' \
      "$status" "$rollback_status" "$DATABASE_BACKUP" >&2
    [[ "$rollback_status" = 0 ]] || exit 70
    exit "$status"
  }
  trap rollback_on_error ERR

  ensure_history "$database"
  psql_db "$database" -f "$stage/release/migration.sql" >/dev/null
  created=1
  insert_history "$database" "$(sha256sum "$stage/release/migration.sql" | cut -d' ' -f1)"
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
  [[ -s "$BUNDLE_COPY" ]] || die 'artefato de rollback ausente'
  verify_backup "$DATABASE_BACKUP" "$DATABASE_BACKUP_CHECKSUM"
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'
  history_present || die 'migration nao esta registrada; rollback recusado'
  stage="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$stage")" EXIT
  extract_bundle "$BUNDLE_COPY" "$stage/release"
  validate_bundle "$stage/release" "$COMMIT_SHA"
  [[ "$MIGRATION_VERSION" = "$migration_version" ]] || die 'estado de rollback incompativel'
  apply_rollback "$stage/release"
  [[ "$STATE_RECORD" = "$state_root"/deploy-*.env && -f "$STATE_RECORD" && ! -L "$STATE_RECORD" ]] \
    || die 'registro imutavel de rollback invalido'
  mv -f "$STATE_RECORD" "$state_root/deploy-${migration_version}-${COMMIT_SHA}.rolled-back-$(date -u +%Y%m%dT%H%M%SZ).archive"
  mv -f "$state" "$state_root/last-deploy.rolled-back-$(date -u +%Y%m%dT%H%M%SZ).env"
  promote_previous_state
  log "ROLLBACK_OK migration=$migration_version backup=$DATABASE_BACKUP"
  rm -rf -- "$stage"
  trap - EXIT
}

restore() {
  local backup="$1" checksum="$2" confirmation="${PRONTOMEDIC_DB_RESTORE_CONFIRM:-}"
  local rehearsal_db="prontoclinic_restore_verify_$$" safety_backup timestamp restore_failed
  audit
  [[ "$confirmation" = "RESTORE:${database}" ]] || die "restauracao integral requer PRONTOMEDIC_DB_RESTORE_CONFIRM=RESTORE:${database}"
  [[ "$backup" = "$backup_root"/*.dump && "$(basename "$backup")" =~ ^[A-Za-z0-9._-]+\.dump$ ]] \
    || die 'dump fora do diretorio privado de backups'
  [[ "$checksum" = "${backup}.sha256" ]] || die 'checksum nao corresponde ao dump solicitado'
  prepare_private_dirs
  verify_backup "$backup" "$checksum"
  require_backup_space
  exec 9>"$global_lock"
  flock -n 9 || die 'outro deploy ProntoMedic esta em andamento'

  host_postgres createdb -T template0 "$rehearsal_db"
  trap 'host_postgres dropdb --if-exists "$rehearsal_db" >/dev/null 2>&1 || true' EXIT
  host_postgres pg_restore --exit-on-error -d "$rehearsal_db" <"$backup" >/dev/null
  [[ "$(psql_db "$rehearsal_db" -Atqc 'SELECT 1')" = 1 ]] || die 'ensaio do dump falhou'
  host_postgres dropdb --if-exists "$rehearsal_db" >/dev/null
  trap - EXIT

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  safety_backup="$backup_root/prontoclinic-before-full-restore-${timestamp}.dump"
  host_postgres pg_dump -Fc -d "$database" >"${safety_backup}.next"
  mv -f "${safety_backup}.next" "$safety_backup"
  chmod 600 "$safety_backup"
  (cd "$backup_root" && sha256sum "$(basename "$safety_backup")" >"$(basename "$safety_backup").sha256.next")
  mv -f "${safety_backup}.sha256.next" "${safety_backup}.sha256"
  chmod 600 "${safety_backup}.sha256"
  verify_backup "$safety_backup" "${safety_backup}.sha256"

  restore_failed=0
  recover_failed_restore() {
    local status=$?
    trap - ERR
    set +e
    host_postgres dropdb --if-exists "$database" >/dev/null 2>&1
    host_postgres createdb -T template0 "$database" >/dev/null 2>&1
    host_postgres pg_restore --exit-on-error -d "$database" <"$safety_backup" >/dev/null 2>&1
    restore_failed=$?
    printf 'PRONTOMEDIC_DB_FULL_RESTORE_FAILED status=%s recovery_status=%s safety_backup=%s\n' \
      "$status" "$restore_failed" "$safety_backup" >&2
    [[ "$restore_failed" = 0 ]] || exit 71
    exit "$status"
  }
  trap recover_failed_restore ERR
  psql_db postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid()" >/dev/null
  host_postgres dropdb "$database"
  host_postgres createdb -T template0 "$database"
  host_postgres pg_restore --exit-on-error -d "$database" <"$backup" >/dev/null
  [[ "$(psql_db "$database" -Atqc 'SELECT 1')" = 1 ]] || die 'banco restaurado indisponivel'
  trap - ERR
  log "FULL_RESTORE_OK database=$database backup=$backup safety_backup=$safety_backup"
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
  restore)
    [[ "$#" = 3 ]] || usage
    shift
    restore "$@"
    ;;
  *) usage ;;
esac
