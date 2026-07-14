#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: execute como root" >&2
  exit 1
fi

APP_DIR="${PRONTOMEDIC_APP_DIR:-/opt/prontomedic/backend}"
SECRET_DIR="${PRONTOMEDIC_SECRET_DIR:-/etc/prontomedic/secrets}"
APP_NAME="prontomedic-auth"

for file in "$SECRET_DIR/jwt_secret" "$SECRET_DIR/postgres_password"; do
  if [ ! -f "$file" ]; then
    echo "ERRO: arquivo de segredo ausente: $file" >&2
    exit 1
  fi
  mode="$(stat -c '%a' "$file")"
  if [ "$mode" != "600" ]; then
    echo "ERRO: $file deve ter permissao 600" >&2
    exit 1
  fi
done

jwt_length="$(wc -c < "$SECRET_DIR/jwt_secret")"
if [ "$jwt_length" -lt 32 ]; then
  echo "ERRO: jwt_secret deve ter ao menos 32 bytes" >&2
  exit 1
fi

pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start "$APP_DIR/scripts/prontomedic-auth.ecosystem.config.cjs" >/dev/null
pm2 save >/dev/null

new_pid="$(pm2 pid "$APP_NAME" | tr -d '[:space:]')"
if [ -z "$new_pid" ] || [ "$new_pid" = "0" ]; then
  echo "ERRO: backend nao voltou apos hardening" >&2
  exit 1
fi

if tr '\0' '\n' < "/proc/$new_pid/environ" | grep -qE '^(JWT_SECRET|PGPASSWORD)='; then
  echo "ERRO: segredo ainda esta exposto no ambiente PM2" >&2
  exit 1
fi

echo "VPS_AUTH_SECRET_FILES_OK"
