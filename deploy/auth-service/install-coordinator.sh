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

PRONTOMEDIC_AUTH_ROOT="$auth_root" pm2 startOrReload "${auth_root}/ecosystem.config.cjs" \
  --only "${PRONTOMEDIC_AUTH_PM2_PROCESS:-prontomedic-auth}" --update-env >/dev/null

status="$(curl -sS --connect-timeout 2 --max-time 5 -o /tmp/prontomedic-auth-bootstrap-health -w '%{http_code}' "$health_url" || true)"
test "$status" = 200 || die "health do backend atual reprovado: HTTP ${status}"
printf 'AUTH_COORDINATOR_INSTALL_OK current=%s helper=%s\n' "$(readlink -f "${auth_root}/current")" "$helper"
