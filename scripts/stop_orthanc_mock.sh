#!/usr/bin/env bash
###############################################################################
# stop_orthanc_mock.sh
# Para o Orthanc mockado
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_FILE="${PROJECT_ROOT}/.orthanc-mock.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "[INFO] OrthancMock não está rodando (PID file não existe)"
  exit 0
fi

PID=$(cat "$PID_FILE")

if ps -p "$PID" > /dev/null 2>&1; then
  echo "[INFO] Parando OrthancMock (PID: ${PID})..."
  kill "$PID" 2>/dev/null || true
  sleep 1
  if ps -p "$PID" > /dev/null 2>&1; then
    kill -9 "$PID" 2>/dev/null || true
  fi
  echo "[OK] OrthancMock parado"
else
  echo "[INFO] PID ${PID} não está ativo"
fi

rm -f "$PID_FILE"
