#!/usr/bin/env bash
set -Eeuo pipefail

source_root="${1:?raiz do checkout ausente}"
legacy_auth="${2:-/opt/prontomedic/backend}"
auth_root="${PRONTOMEDIC_AUTH_ROOT:-/opt/prontomedic/auth-runtime}"
helper="/usr/local/sbin/prontomedic-auth-deploy"
health_url="${PRONTOMEDIC_AUTH_HEALTH_URL:-http://127.0.0.1:8000/health}"

die() { printf 'AUTH_COORDINATOR_INSTALL_ERROR: %s\n' "$*" >&2; exit 1; }
test "$(id -u)" = 0 || die "execucao requer root"
case "$source_root" in /*) ;; *) die "raiz do checkout deve ser absoluta" ;; esac
case "$legacy_auth" in /*) ;; *) die "backend legado deve ser absoluto" ;; esac
test -f "${source_root}/deploy/auth-service/deploy-atomic.sh" || die "helper canonico ausente"
test -f "${source_root}/deploy/auth-service/ecosystem.config.cjs" || die "ecosystem canonico ausente"
test -f "${legacy_auth}/local-auth-server.mjs" || die "backend atual invalido"

install -d -m 750 "${auth_root}/releases" "${auth_root}/secrets"
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
pm2 delete "$process_name" >/dev/null 2>&1 || true
PRONTOMEDIC_AUTH_ROOT="$auth_root" pm2 start "${auth_root}/ecosystem.config.cjs" \
  --only "$process_name" --update-env >/dev/null

actual_path="$(pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const name = process.argv[1];
  const item = JSON.parse(input).find(entry => entry.name === name);
  if (!item?.pm2_env?.pm_exec_path) process.exit(2);
  process.stdout.write(item.pm2_env.pm_exec_path);
});
' "$process_name")" || die "pm_exec_path indisponivel"
test "$actual_path" = "${auth_root}/current/local-auth-server.mjs" \
  || die "PM2 nao aponta para o link canonico: ${actual_path}"

status="000"
for _attempt in $(seq 1 30); do
  status="$(curl -sS --connect-timeout 2 --max-time 5 -o /tmp/prontomedic-auth-bootstrap-health -w '%{http_code}' "$health_url" 2>/dev/null || true)"
  test "$status" = 200 && break
  sleep 2
done
test "$status" = 200 || die "health do backend atual reprovado: HTTP ${status}"
printf 'AUTH_COORDINATOR_INSTALL_OK current=%s helper=%s\n' "$(readlink -f "${auth_root}/current")" "$helper"
