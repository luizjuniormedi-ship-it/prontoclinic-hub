#!/bin/bash
# PRONTOMEDIC â€” Healthcheck para VPS
# Cron: */5 * * * * /opt/prontomedic/scripts/vps_healthcheck.sh

set +e  # Nao aborta em erro; registra todas as falhas.
umask 077

LOG_FILE="/var/log/prontomedic/healthcheck.log"
ALERT_EMAIL="admin@medilife.com.br"

# Garante que o diretÃ³rio de log existe
mkdir -p "$(dirname $LOG_FILE)"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

check_auth_server() {
  HTTP_CODE=$(curl --connect-timeout 3 --max-time 8 -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/auth/v1/settings)
  if [ "$HTTP_CODE" = "200" ]; then
    return 0
  else
    echo "[$(timestamp)] ERRO: Auth server retornou $HTTP_CODE" >> "$LOG_FILE"
    return 1
  fi
}

check_frontend() {
  HTTP_CODE=$(curl --connect-timeout 3 --max-time 8 -s -o /dev/null -w "%{http_code}" http://127.0.0.1/)
  if [ "$HTTP_CODE" = "200" ]; then
    return 0
  else
    echo "[$(timestamp)] ERRO: Frontend retornou $HTTP_CODE" >> "$LOG_FILE"
    return 1
  fi
}

check_database() {
  if [ -z "${PGPASSWORD:-}" ]; then
    echo "[$(timestamp)] ERRO: PGPASSWORD nao configurada para o healthcheck" >> "$LOG_FILE"
    return 1
  fi
  if PGHOST="${PGHOST:-127.0.0.1}" \
     PGPORT="${PGPORT:-5432}" \
     PGUSER="${PGUSER:-backup_prontomedic}" \
     PGDATABASE="${PGDATABASE:-prontoclinic}" \
     PGCONNECT_TIMEOUT=5 \
     psql -X -qAt -c 'SELECT 1' >/dev/null 2>&1; then
    return 0
  else
    echo "[$(timestamp)] ERRO: Banco de dados nÃ£o responde" >> "$LOG_FILE"
    return 1
  fi
}

# Executa os checks
AUTH_OK=0
FRONTEND_OK=0
DB_OK=0

check_auth_server && AUTH_OK=1
check_frontend && FRONTEND_OK=1
check_database && DB_OK=1

# Se tudo OK, nÃ£o loga (evita spam)
if [ $AUTH_OK -eq 1 ] && [ $FRONTEND_OK -eq 1 ] && [ $DB_OK -eq 1 ]; then
  exit 0
fi

# Se algum falhou, tenta restart
if [ $AUTH_OK -eq 0 ]; then
  echo "[$(timestamp)] Tentando restart do auth server..." >> "$LOG_FILE"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart prontomedic-auth --update-env
  else
    echo "[$(timestamp)] CRITICO: pm2 nao encontrado para reiniciar auth" >> "$LOG_FILE"
  fi
  sleep 5
  check_auth_server && echo "[$(timestamp)] Auth server recuperado" >> "$LOG_FILE" || echo "[$(timestamp)] CRÃTICO: Auth server nÃ£o recuperou" >> "$LOG_FILE"
fi

if [ $FRONTEND_OK -eq 0 ]; then
  echo "[$(timestamp)] Tentando restart do nginx..." >> "$LOG_FILE"
  systemctl restart nginx
  sleep 3
  check_frontend && echo "[$(timestamp)] Frontend recuperado" >> "$LOG_FILE" || echo "[$(timestamp)] CRÃTICO: Frontend nÃ£o recuperou" >> "$LOG_FILE"
fi

if [ $DB_OK -eq 0 ]; then
  echo "[$(timestamp)] CRÃTICO: Banco nÃ£o responde. IntervenÃ§Ã£o manual necessÃ¡ria." >> "$LOG_FILE"
  # Alerta por email (descomentar se tiver mail configurado)
  # echo "ProntoMedic: Banco de dados down em $(hostname)" | mail -s "ALERTA CRÃTICO" "$ALERT_EMAIL"
fi

exit 0
