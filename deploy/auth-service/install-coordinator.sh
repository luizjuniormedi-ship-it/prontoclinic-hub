#!/usr/bin/env bash
set -Eeuo pipefail

source_root="${1:?raiz do checkout ausente}"
legacy_auth="${2:-/opt/prontomedic/backend}"
auth_root="${PRONTOMEDIC_AUTH_ROOT:-/opt/prontomedic/auth-runtime}"
helper="/usr/local/sbin/prontomedic-auth-deploy"
health_url="${PRONTOMEDIC_AUTH_HEALTH_URL:-http://127.0.0.1:8000/health}"
auth_env="${PRONTOMEDIC_AUTH_ENV_FILE:-${auth_root}/secrets/.env.auth}"
auth_env_json="${auth_env}.json"
legacy_env0="${PRONTOMEDIC_AUTH_LEGACY_ENV0:-/tmp/m2-backend.env0}"

die() { printf 'AUTH_COORDINATOR_INSTALL_ERROR: %s\n' "$*" >&2; exit 1; }
test "$(id -u)" = 0 || die "execucao requer root"
case "$source_root" in /*) ;; *) die "raiz do checkout deve ser absoluta" ;; esac
case "$legacy_auth" in /*) ;; *) die "backend legado deve ser absoluto" ;; esac
test -f "${source_root}/deploy/auth-service/deploy-atomic.sh" || die "helper canonico ausente"
test -f "${source_root}/deploy/auth-service/ecosystem.config.cjs" || die "ecosystem canonico ausente"
test -f "${legacy_auth}/local-auth-server.mjs" || die "backend atual invalido"

install -d -m 750 "${auth_root}/releases" "${auth_root}/secrets"
if test ! -f "$auth_env" || test ! -f "$auth_env_json"; then
  test -s "$legacy_env0" || die "ambiente legado indisponivel: ${legacy_env0}"
  node - "$legacy_env0" "$auth_env" <<'NODE'
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const [source, target] = process.argv.slice(2);
const entries = readFileSync(source)
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .map((entry) => entry.split(/=(.*)/s).slice(0, 2))
  .filter(([name]) => /^[A-Z_][A-Z0-9_]*$/.test(name));
const required = ['CORS_ALLOWED_ORIGINS', 'JWT_SECRET', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const values = new Map(entries);
const missing = required.filter((name) => !values.get(name));
if (missing.length) throw new Error(`variaveis obrigatorias ausentes: ${missing.join(',')}`);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
writeFileSync(target, `${entries.map(([name, value]) => `${name}=${quote(value)}`).join('\n')}\n`, { mode: 0o600 });
chmodSync(target, 0o600);
writeFileSync(`${target}.json`, `${JSON.stringify(Object.fromEntries(entries))}\n`, { mode: 0o600 });
chmodSync(`${target}.json`, 0o600);
NODE
fi
test "$(stat -c '%u:%a' "$auth_env")" = "0:600" || die "ambiente deve pertencer ao root e ter modo 600"
test "$(stat -c '%u:%a' "$auth_env_json")" = "0:600" || die "ambiente JSON deve pertencer ao root e ter modo 600"
set -a
# shellcheck disable=SC1090
source "$auth_env"
set +a
for required_name in CORS_ALLOWED_ORIGINS JWT_SECRET PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
  test -n "${!required_name:-}" || die "variavel obrigatoria ausente: ${required_name}"
done
expected_port="${PRONTOMEDIC_AUTH_PORT:-8000}"
test "${LOCAL_AUTH_PORT:-8000}" = "$expected_port" \
  || die "LOCAL_AUTH_PORT deve ser ${expected_port} antes da transicao"
if printf '%s' "$CORS_ALLOWED_ORIGINS" | grep -Eqi '(^|,)[[:space:]]*(\*|https?://(localhost|127\.0\.0\.1)(:|/|,|$))'; then
  die "CORS_ALLOWED_ORIGINS contem origem local ou curinga"
fi
if test -e "${auth_root}/current" && test ! -L "${auth_root}/current"; then
  die "current existe e nao e link simbolico"
fi
if test ! -L "${auth_root}/current"; then
  ln -s "$legacy_auth" "${auth_root}/current"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if test -f "$helper"; then
  cp -- "$helper" "${helper}.before-${timestamp}"
  chmod 700 "${helper}.before-${timestamp}"
fi
install -m 700 "${source_root}/deploy/auth-service/deploy-atomic.sh" "$helper"
install -m 644 "${source_root}/deploy/auth-service/ecosystem.config.cjs" "${auth_root}/ecosystem.config.cjs"

process_name="${PRONTOMEDIC_AUTH_PM2_PROCESS:-prontomedic-auth}"
previous_path="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const item = JSON.parse(input).find(entry => entry.name === process.argv[1]);
  process.stdout.write(item?.pm2_env?.pm_exec_path || "");
});
' "$process_name")"
previous_cwd="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const item = JSON.parse(input).find(entry => entry.name === process.argv[1]);
  process.stdout.write(item?.pm2_env?.pm_cwd || "");
});
' "$process_name")"

rollback_bootstrap() {
  local exit_code=$?
  test "$#" -eq 0 || exit_code="$1"
  trap - ERR
  pm2 delete "$process_name" >/dev/null 2>&1 || true
  if test -n "$previous_path" && test -f "$previous_path"; then
    PRONTOMEDIC_AUTH_ROOT="$auth_root" \
      PRONTOMEDIC_AUTH_SCRIPT="$previous_path" \
      PRONTOMEDIC_AUTH_CWD="${previous_cwd:-$legacy_auth}" \
      pm2 start "${auth_root}/ecosystem.config.cjs" --only "$process_name" --update-env >/dev/null || true
  fi
  exit "$exit_code"
}
trap rollback_bootstrap ERR
pm2 delete "$process_name" >/dev/null 2>&1 || true
PRONTOMEDIC_AUTH_ROOT="$auth_root" pm2 start "${auth_root}/ecosystem.config.cjs" \
  --only "$process_name" --update-env >/dev/null

actual_contract="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const name = process.argv[1];
  const item = JSON.parse(input).find(entry => entry.name === name);
  if (!item?.pm2_env?.pm_exec_path) process.exit(2);
  process.stdout.write(`${item.pm2_env.pm_exec_path}\n${(item.pm2_env.args || []).join(" ")}`);
});
' "$process_name")" || die "pm_exec_path indisponivel"
actual_path="$(printf '%s\n' "$actual_contract" | sed -n '1p')"
actual_args="$(printf '%s\n' "$actual_contract" | sed -n '2p')"
test "$actual_path" = "/usr/bin/node" || die "PM2 nao aponta para o Node canonico: ${actual_path}"
test "$actual_args" = "${auth_root}/current/local-auth-server.mjs" \
  || die "PM2 nao aponta para o modulo canonico: ${actual_args}"

status="000"
for _attempt in $(seq 1 30); do
  status="$(curl -sS --connect-timeout 2 --max-time 5 -o /tmp/prontomedic-auth-bootstrap-health -w '%{http_code}' "$health_url" 2>/dev/null || true)"
  test "$status" = 200 && break
  sleep 2
done
if test "$status" != 200; then
  printf 'AUTH_COORDINATOR_INSTALL_ERROR: health do backend atual reprovado: HTTP %s\n' "$status" >&2
  rollback_bootstrap 1
fi
trap - ERR
pm2 save >/dev/null
printf 'AUTH_COORDINATOR_INSTALL_OK current=%s helper=%s\n' "$(readlink -f "${auth_root}/current")" "$helper"
