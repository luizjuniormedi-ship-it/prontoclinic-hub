#!/usr/bin/env bash
###############################################################################
# start_orthanc_mock.sh
# Inicia o Orthanc mockado em background
#
# Uso: bash scripts/start_orthanc_mock.sh [PORT]
###############################################################################

set -e

PORT="${1:-8042}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_FILE="${PROJECT_ROOT}/.orthanc-mock.pid"
LOG_FILE="${PROJECT_ROOT}/.orthanc-mock.log"

# Verificar se já está rodando
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "[ERROR] OrthancMock já está rodando (PID: $OLD_PID)"
    echo "Pare com: bash scripts/stop_orthanc_mock.sh"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Verificar se Node está disponível
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js não encontrado. Instale: https://nodejs.org"
  exit 1
fi

# Verificar se a porta está livre
if command -v netstat >/dev/null 2>&1; then
  if netstat -an 2>/dev/null | grep -q ":${PORT}.*LISTENING"; then
    echo "[WARN] Porta ${PORT} já em uso. Tentando iniciar mesmo assim..."
  fi
fi

# Iniciar em background
echo "[INFO] Iniciando OrthancMock na porta ${PORT}..."
cd "$PROJECT_ROOT"
nohup node scripts/orthanc-mock.cjs "$PORT" > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

# Aguardar inicialização (até 5s)
for i in 1 2 3 4 5; do
  sleep 1
  if curl -sf "http://localhost:${PORT}/tools/ping" > /dev/null 2>&1; then
    echo "[OK] OrthancMock rodando (PID: ${PID}, porta: ${PORT})"
    echo "  Logs: ${LOG_FILE}"
    echo "  Teste: bash scripts/test_orthanc_mock.sh ${PORT}"
    echo "  Pare: bash scripts/stop_orthanc_mock.sh"
    exit 0
  fi
done

echo "[ERROR] Timeout aguardando OrthancMock inicializar"
echo "Verifique os logs: cat ${LOG_FILE}"
exit 1
