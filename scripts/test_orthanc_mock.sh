#!/usr/bin/env bash
###############################################################################
# test_orthanc_mock.sh
# Testa o Orthanc mockado - verifica que todos os endpoints funcionam
#
# Uso: bash scripts/test_orthanc_mock.sh [PORT]
# Default PORT: 8042
###############################################################################

set -e

PORT="${1:-8042}"
BASE_URL="http://localhost:${PORT}"
PASS=0
FAIL=0

# Cores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() {
  echo -e "  ${GREEN}[PASS]${NC} $1"
  PASS=$((PASS+1))
}

log_fail() {
  echo -e "  ${RED}[FAIL]${NC} $1"
  FAIL=$((FAIL+1))
}

log_section() {
  echo -e "\n${YELLOW}== $1 ==${NC}"
}

# Verificar se o servidor está up
log_section "Conectividade"
if curl -sf "${BASE_URL}/tools/ping" > /dev/null; then
  log_pass "Servidor OrthancMock respondendo em ${BASE_URL}"
else
  log_fail "Servidor OrthancMock NÃO está respondendo em ${BASE_URL}"
  echo "Inicie o mock com: node scripts/orthanc-mock.js ${PORT}"
  exit 1
fi

# System
log_section "System endpoints"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/system")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /system (200)" || log_fail "GET /system ($HTTP_CODE)"

VERSION=$(curl -sf "${BASE_URL}/system" | grep -o '"Version": *"[^"]*"' | head -1)
[ -n "$VERSION" ] && log_pass "Server version: $VERSION" || log_fail "Versão não retornada"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/system/statistics")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /system/statistics (200)" || log_fail "GET /system/statistics ($HTTP_CODE)"

# Patients
log_section "Patients endpoints"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/patients")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /patients (200)" || log_fail "GET /patients ($HTTP_CODE)"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/patients?expand=true")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /patients?expand=true (200)" || log_fail "GET /patients?expand=true ($HTTP_CODE)"

PATIENT_COUNT=$(curl -sf "${BASE_URL}/patients" | grep -o '"ID"' | wc -l)
PATIENT_COUNT=$((PATIENT_COUNT / 2))  # JSON pretty-print: cada ID aparece 2x
[ "$PATIENT_COUNT" -ge 1 ] && log_pass "Pacientes retornados: $PATIENT_COUNT" || log_fail "Nenhum paciente retornado"

# Studies
log_section "Studies endpoints"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/studies")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /studies (200)" || log_fail "GET /studies ($HTTP_CODE)"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/studies?expand=true")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /studies?expand=true (200)" || log_fail "GET /studies?expand=true ($HTTP_CODE)"

# Series
log_section "Series endpoints"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/series")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /series (200)" || log_fail "GET /series ($HTTP_CODE)"

# Instances
log_section "Instances endpoints"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/instances")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /instances (200)" || log_fail "GET /instances ($HTTP_CODE)"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/instances/instance-001/file")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /instances/instance-001/file (200, DICOM mock)" || log_fail "GET /instances/instance-001/file ($HTTP_CODE)"

# Modalities
log_section "Modalities & Worklist"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/modalities")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /modalities (200)" || log_fail "GET /modalities ($HTTP_CODE)"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/modalities/mock-local/worklist")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /modalities/mock-local/worklist (200)" || log_fail "GET /modalities/mock-local/worklist ($HTTP_CODE)"

WL_COUNT=$(curl -sf "${BASE_URL}/modalities/mock-local/worklist" | grep -c "AccessionNumber")
[ "$WL_COUNT" -ge 1 ] && log_pass "Worklist retornou $WL_COUNT itens" || log_fail "Worklist vazia"

# Stats custom
log_section "Mock stats"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/_mock/stats")
[ "$HTTP_CODE" = "200" ] && log_pass "GET /_mock/stats (200)" || log_fail "GET /_mock/stats ($HTTP_CODE)"

REQ_COUNT=$(curl -sf "${BASE_URL}/_mock/stats" | grep -o '"requestsServed": *[0-9]*' | head -1)
[ -n "$REQ_COUNT" ] && log_pass "Stats: $REQ_COUNT requests servidos" || log_fail "Stats não retornou requests"

# 404 handling
log_section "Error handling"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/nao-existe")
[ "$HTTP_CODE" = "404" ] && log_pass "GET /nao-existe retorna 404 (esperado)" || log_fail "GET /nao-existe retornou $HTTP_CODE (esperado 404)"

# CORS
log_section "CORS"
CORS_HEADER=$(curl -sf -H "Origin: http://example.com" -I "${BASE_URL}/system" | grep -i "access-control-allow-origin" | tr -d '\r')
[ -n "$CORS_HEADER" ] && log_pass "CORS habilitado: $CORS_HEADER" || log_fail "CORS não configurado"

# Resumo
echo ""
echo "==========================================="
echo -e "  ${GREEN}PASS: ${PASS}${NC}  ${RED}FAIL: ${FAIL}${NC}"
echo "==========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

echo -e "${GREEN}OrthancMock OK!${NC}"
exit 0
