#!/usr/bin/env bash
set -Eeuo pipefail

# Coordinates an additive migration, the canonical PM2 Auth process and the
# existing Edge helper. Database rollback is intentionally not automatic:
# application rollback is forward-compatible with the additive schema.

readonly auth_root="${PRONTOMEDIC_AUTH_ROOT:-/opt/prontomedic/auth-runtime}"
readonly auth_releases="${auth_root}/releases"
readonly auth_current="${auth_root}/current"
readonly auth_previous="${auth_root}/previous"
readonly auth_ecosystem="${auth_root}/ecosystem.config.cjs"
readonly auth_env="${PRONTOMEDIC_AUTH_ENV_FILE:-${auth_root}/secrets/.env.auth}"
readonly edge_env="${PRONTOMEDIC_EDGE_ENV_FILE:-/opt/prontomedic/edge-runtime/secrets/.env.functions}"
readonly backup_root="${PRONTOMEDIC_BACKUP_ROOT:-/var/backups/prontomedic/auth-admin}"
readonly edge_helper="${PRONTOMEDIC_EDGE_HELPER:-/usr/local/sbin/prontomedic-edge-deploy}"
readonly edge_smoke_base="${PRONTOMEDIC_EDGE_SMOKE_BASE_URL:-http://127.0.0.1:9000}"
readonly pm2_process="${PRONTOMEDIC_AUTH_PM2_PROCESS:-prontomedic-auth}"
readonly database="${PRONTOMEDIC_DATABASE:-prontoclinic}"
readonly health_url="${PRONTOMEDIC_AUTH_HEALTH_URL:-http://127.0.0.1:8000/health}"
readonly manifest_version="1"

die() { printf 'AUTH_ATOMIC_DEPLOY_ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'AUTH_ATOMIC_DEPLOY: %s\n' "$*"; }

usage() {
  cat >&2 <<'USAGE'
Uso:
  deploy-atomic.sh audit
  deploy-atomic.sh preflight <sha> <auth.tgz> <auth.sha256> <edge.tgz> <edge.sha256> <migration.sql>
  deploy-atomic.sh deploy <sha> <auth.tgz> <auth.sha256> <edge.tgz> <edge.sha256> <migration.sql>
  deploy-atomic.sh rollback
USAGE
  exit 64
}

host_postgres() {
  docker run --rm --privileged -i -v /:/host alpine:3.20 \
    chroot /host runuser -u postgres -- "$@"
}

require_root() { test "$(id -u)" = 0 || die "execucao requer root"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "comando ausente: $1"; }
require_absolute_file() {
  case "$1" in /*) ;; *) die "caminho nao absoluto: $1" ;; esac
  case "$1" in *$'\n'*|*$'\r'*) die "caminho contem caractere de controle" ;; esac
  test -f "$1" || die "arquivo ausente: $1"
  test ! -L "$1" || die "entrada nao pode ser link simbolico: $1"
}

require_secret_file() {
  require_absolute_file "$1"
  test "$(stat -c '%U:%G' "$1")" = "root:root" || die "secret deve pertencer a root:root: $1"
  test "$(stat -c '%a' "$1")" = "600" || die "secret deve usar modo 600: $1"
}

secret_fingerprint() {
  local file="$1" name="$2" line value count
  count="$(grep -Ec "^${name}=" "$file" || true)"
  test "$count" = 1 || die "secret ausente ou duplicado: ${name}"
  line="$(grep -E "^${name}=" "$file")"
  value="${line#*=}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  test "${#value}" -ge 32 || die "secret ${name} invalido"
  printf '%s' "$value" | sha256sum | cut -d' ' -f1
}

verify_service_key_fingerprint() {
  require_secret_file "$auth_env"
  require_secret_file "$edge_env"
  local auth_fingerprint edge_fingerprint
  auth_fingerprint="$(secret_fingerprint "$auth_env" LOCAL_AUTH_SERVICE_KEY)"
  edge_fingerprint="$(secret_fingerprint "$edge_env" SUPABASE_SERVICE_ROLE_KEY)"
  test "$auth_fingerprint" = "$edge_fingerprint" \
    || die "fingerprint LOCAL_AUTH_SERVICE_KEY diverge do secret Edge"
  log "SERVICE_KEY_FINGERPRINT_MATCH"
}

load_auth_env() {
  require_secret_file "$auth_env"
  set -a
  # Root-owned mode-600 deployment input. Values are never printed.
  # shellcheck disable=SC1090
  . "$auth_env"
  set +a
}

verify_checksum() {
  local artifact="$1" checksum="$2"
  (cd "$(dirname "$artifact")" && sha256sum -c "$(basename "$checksum")") >/dev/null
}

verify_archive_paths() {
  if tar -tzf "$1" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "arquivo contem caminho inseguro: $1"
  fi
}

verify_manifest() {
  local release="$1" sha="$2"
  node - "$release/release-manifest.json" "$sha" "$manifest_version" <<'NODE'
const fs = require('node:fs');
const [manifestPath, sha, version] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedFiles = [
  'local-auth-server.mjs', 'local-auth-admin.mjs', 'local-auth-admin.d.ts',
  'local-auth-projection.mjs', 'local-auth-projection.d.ts', 'package.json',
  'package-lock.json', 'ecosystem.config.cjs', 'node_modules'
];
if (manifest.schemaVersion !== Number(version)) throw new Error('manifest version');
if (manifest.commitSha !== sha) throw new Error('manifest SHA');
if (manifest.migrationStrategy !== 'forward-compatible-additive') throw new Error('migration strategy');
for (const file of expectedFiles) {
  if (!manifest.files.includes(file) || !fs.existsSync(`${manifestPath}/../${file}`)) {
    throw new Error(`missing ${file}`);
  }
}
NODE
}

verify_auth_archive() {
  local archive="$1" sha="$2"
  (
    local stage
    stage="$(mktemp -d)"
    trap 'rm -rf -- "$stage"' EXIT
    tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$stage"
    verify_manifest "$stage" "$sha"
    node --check "${stage}/local-auth-server.mjs"
    node --check "${stage}/local-auth-admin.mjs"
  )
}

verify_additive_migration() {
  local migration="$1"
  grep -Eq '^[[:space:]]*(BEGIN|START TRANSACTION)[[:space:]]*;' "$migration" \
    || die "migration deve abrir transacao"
  grep -Eq '^[[:space:]]*COMMIT[[:space:]]*;' "$migration" \
    || die "migration deve confirmar transacao"
  if grep -Eiq '^[[:space:]]*(DROP|TRUNCATE|DELETE|UPDATE)[[:space:]]' "$migration"; then
    die "migration nao e estritamente aditiva"
  fi
  if grep -Eiq '^[[:space:]]*ALTER[[:space:]]+TABLE[^;]*(DROP|RENAME)[[:space:]]' "$migration"; then
    die "migration contem ALTER destrutivo"
  fi
}

pm2_exec_contract() {
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const processInfo = JSON.parse(input).find(item => item.name === process.argv[1]);
      if (!processInfo?.pm2_env?.pm_exec_path) process.exit(2);
      process.stdout.write(`${processInfo.pm2_env.pm_exec_path}\n${(processInfo.pm2_env.args || []).join(" ")}`);
    });
  ' "$pm2_process"
}

assert_pm2_exec_path() {
  local expected="${auth_current}/local-auth-server.mjs" contract actual args
  contract="$(pm2_exec_contract)" || die "contrato PM2 indisponivel para ${pm2_process}"
  actual="$(printf '%s\n' "$contract" | sed -n '1p')"
  args="$(printf '%s\n' "$contract" | sed -n '2p')"
  test "$actual" = "/usr/bin/node" || die "PM2 aponta para ${actual}; esperado /usr/bin/node"
  test "$args" = "$expected" || die "PM2 args aponta para ${args}; esperado ${expected}"
  log "PM2_EXEC_PATH_OK"
}

health_check() {
  local attempt status
  for attempt in $(seq 1 30); do
    status="$(curl -sS --connect-timeout 2 --max-time 5 -o /tmp/prontomedic-auth-health -w '%{http_code}' "$health_url" 2>/dev/null || true)"
    if test "$status" = 200 && grep -Eq '"(status|ok)"[[:space:]]*:[[:space:]]*("ok"|true)' /tmp/prontomedic-auth-health; then
      return 0
    fi
    sleep 2
  done
  return 1
}

edge_smoke() {
  local function_name status
  for function_name in auth-admin dicom-bridge telemedicina-daily; do
    status="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null -w '%{http_code}' \
      -X OPTIONS "${edge_smoke_base}/${function_name}" 2>/dev/null || true)"
    test "$status" = 200 || die "smoke Edge falhou em ${function_name}: HTTP ${status}"
  done
  "$edge_helper" --audit-contract >/dev/null
}

smoke_all() {
  health_check || die "health check Auth reprovado"
  assert_pm2_exec_path
  edge_smoke
  log "SMOKE_OK"
}

restart_auth_canonical() {
  load_auth_env
  PRONTOMEDIC_AUTH_ROOT="$auth_root" pm2 startOrReload "$auth_ecosystem" \
    --only "$pm2_process" --update-env >/dev/null
  assert_pm2_exec_path
  health_check || die "Auth nao ficou saudavel"
}

install_ecosystem_and_restart() {
  local release="$1"
  cp -- "${release}/ecosystem.config.cjs" "${auth_ecosystem}.next"
  chmod 644 "${auth_ecosystem}.next"
  mv -f "${auth_ecosystem}.next" "$auth_ecosystem"
  restart_auth_canonical
}

audit() {
  require_root
  for command_name in docker tar sha256sum curl flock pm2 node readlink stat; do
    require_command "$command_name"
  done
  test -x "$edge_helper" || die "helper Edge ausente ou nao executavel"
  test -L "$auth_current" || die "link Auth atual ausente"
  test -f "${auth_current}/local-auth-server.mjs" || die "release Auth atual invalida"
  test -f "$auth_ecosystem" || die "ecosystem canonico ausente"
  verify_service_key_fingerprint
  host_postgres psql -X -d "$database" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' | grep -qx 1 \
    || die "PostgreSQL indisponivel"
  health_check || die "health check Auth reprovado"
  assert_pm2_exec_path
  "$edge_helper" --audit-contract >/dev/null
  log "AUDIT_OK"
}

preflight() {
  local sha="$1" auth_archive="$2" auth_checksum="$3"
  local edge_archive="$4" edge_checksum="$5" migration="$6"
  require_root
  for command_name in docker tar sha256sum curl flock pm2 node readlink stat; do
    require_command "$command_name"
  done
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "SHA invalido"
  for path in "$auth_archive" "$auth_checksum" "$edge_archive" "$edge_checksum" "$migration"; do
    require_absolute_file "$path"
  done
  verify_checksum "$auth_archive" "$auth_checksum"
  verify_checksum "$edge_archive" "$edge_checksum"
  verify_archive_paths "$auth_archive"
  verify_archive_paths "$edge_archive"
  verify_auth_archive "$auth_archive" "$sha"
  verify_additive_migration "$migration"
  verify_service_key_fingerprint
  test -x "$edge_helper" || die "helper Edge ausente ou nao executavel"
  "$edge_helper" --audit-contract >/dev/null
  pm2 describe "$pm2_process" >/dev/null 2>&1 || die "processo PM2 ausente"
  test -L "$auth_current" || die "link Auth atual ausente"
  test -f "${auth_current}/local-auth-server.mjs" || die "release Auth atual invalida"
  test ! -e "${auth_releases}/${sha}" || die "release Auth imutavel ja existe"
  host_postgres psql -X -d "$database" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' | grep -qx 1 \
    || die "PostgreSQL indisponivel"
  log "PREFLIGHT_OK"
}

write_state() {
  local state="$1" sha="$2" previous="$3" backup="$4" previous_ecosystem="$5"
  umask 077
  {
    printf 'DEPLOY_SHA=%q\n' "$sha"
    printf 'PREVIOUS_AUTH=%q\n' "$previous"
    printf 'DATABASE_BACKUP=%q\n' "$backup"
    printf 'PREVIOUS_ECOSYSTEM=%q\n' "$previous_ecosystem"
  } >"${state}.next"
  mv -f "${state}.next" "$state"
}

rollback_application() {
  local previous="$1" previous_ecosystem="$2"
  "$edge_helper" --rollback
  ln -sfn "$previous" "${auth_current}.next"
  mv -Tf "${auth_current}.next" "$auth_current"
  if test -s "$previous_ecosystem"; then
    cp -- "$previous_ecosystem" "${auth_ecosystem}.next"
    mv -f "${auth_ecosystem}.next" "$auth_ecosystem"
  fi
  restart_auth_canonical
  smoke_all
}

rollback_from_state() {
  local state="${auth_root}/last-deploy.env"
  test -f "$state" || die "estado de rollback ausente"
  # Root-owned mode-600 state written with printf %q.
  # shellcheck disable=SC1090
  . "$state"
  test -f "${PREVIOUS_AUTH:-}/local-auth-server.mjs" || die "release anterior invalida"
  require_absolute_file "${PREVIOUS_ECOSYSTEM:-}"
  rollback_application "$PREVIOUS_AUTH" "$PREVIOUS_ECOSYSTEM"
  mv -f "$state" "${state}.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)"
  log "ROLLBACK_OK schema_aditivo_preservado=true backup=${DATABASE_BACKUP:-desconhecido}"
}

deploy() {
  local sha="$1" auth_archive="$2" auth_checksum="$3"
  local edge_archive="$4" edge_checksum="$5" migration="$6"
  local release="${auth_releases}/${sha}" previous backup migration_copy
  local previous_ecosystem timestamp state

  preflight "$@"
  mkdir -p "$auth_releases" "$backup_root"
  exec 9>"${auth_root}/.deploy.lock"
  flock -n 9 || die "outra publicacao Auth esta em andamento"
  test ! -e "$release" || die "release Auth imutavel ja existe"

  previous="$(readlink -f "$auth_current")"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${backup_root}/prontoclinic-before-${sha}-${timestamp}.dump"
  migration_copy="${backup_root}/migration-${sha}-${timestamp}.sql"
  previous_ecosystem="${backup_root}/ecosystem-before-${sha}-${timestamp}.cjs"
  state="${auth_root}/last-deploy.env"

  host_postgres pg_dump -Fc -d "$database" >"${backup}.next"
  test -s "${backup}.next" || die "backup PostgreSQL vazio"
  host_postgres pg_restore --list <"${backup}.next" >/dev/null || die "backup PostgreSQL invalido"
  mv -f "${backup}.next" "$backup"
  cp -- "$migration" "${migration_copy}.next"
  mv -f "${migration_copy}.next" "$migration_copy"
  cp -- "$auth_ecosystem" "${previous_ecosystem}.next"
  mv -f "${previous_ecosystem}.next" "$previous_ecosystem"
  chmod 600 "$backup" "$migration_copy" "$previous_ecosystem"

  app_activated=0
  edge_activated=0
  state_written=0
  rollback_on_error() {
    status=$?
    trap - ERR
    set +e
    rollback_status=0
    if test "$edge_activated" = 1; then
      "$edge_helper" --rollback || rollback_status=1
    fi
    if test "$app_activated" = 1; then
      (
        set -Eeuo pipefail
        ln -sfn "$previous" "${auth_current}.next"
        mv -Tf "${auth_current}.next" "$auth_current"
        cp -- "$previous_ecosystem" "$auth_ecosystem"
        restart_auth_canonical
        smoke_all
      ) || rollback_status=1
    fi
    current_target="$(readlink -f "$auth_current" 2>/dev/null || true)"
    if test "$current_target" != "$release"; then rm -rf -- "$release"; fi
    if test "$state_written" = 1 && test -f "$state"; then
      mv -f "$state" "${state}.failed-${timestamp}"
    fi
    printf 'AUTH_ATOMIC_DEPLOY_ROLLED_BACK status=%s rollback_status=%s schema_aditivo_preservado=true backup=%s\n' \
      "$status" "$rollback_status" "$backup" >&2
    if test "$rollback_status" != 0; then exit 70; fi
    exit "$status"
  }
  trap rollback_on_error ERR

  mkdir "$release"
  tar --no-same-owner --no-same-permissions -xzf "$auth_archive" -C "$release"
  verify_manifest "$release" "$sha"
  node --check "${release}/local-auth-server.mjs"
  node --check "${release}/local-auth-admin.mjs"

  write_state "$state" "$sha" "$previous" "$backup" "$previous_ecosystem"
  state_written=1
  host_postgres psql -X -d "$database" -v ON_ERROR_STOP=1 -f "$migration_copy" >/dev/null

  ln -sfn "$previous" "${auth_previous}.next"
  mv -Tf "${auth_previous}.next" "$auth_previous"
  ln -sfn "$release" "${auth_current}.next"
  mv -Tf "${auth_current}.next" "$auth_current"
  app_activated=1
  install_ecosystem_and_restart "$release"

  "$edge_helper" "$sha" "$edge_archive" "$edge_checksum"
  edge_activated=1
  smoke_all

  trap - ERR
  log "DEPLOY_OK sha=${sha} schema_aditivo_preservado=true backup=${backup}"
}

command="${1:-}"
case "$command" in
  audit|rollback)
    test "$#" = 1 || usage
    require_root
    if test "$command" = audit; then audit; else rollback_from_state; fi
    ;;
  preflight|deploy)
    test "$#" = 7 || usage
    shift
    "$command" "$@"
    ;;
  *) usage ;;
esac
