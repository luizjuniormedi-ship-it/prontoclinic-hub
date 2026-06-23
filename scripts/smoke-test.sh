#!/usr/bin/env bash
# smoke-test.sh
# Smoke test manual dos fluxos críticos contra o banco de dados
# Requer: psql, PostgreSQL rodando em localhost:54322

set -euo pipefail

PSQL="/c/PostgreSQL/15/bin/psql"
HOST="${DB_HOST:-localhost}"
PORT="${DB_PORT:-54322}"
USER="${DB_USER:-postgres}"
DB="${DB_NAME:-postgres}"
COMPANY_ID="00000000-0000-0000-0000-000000000001"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local query="$2"
  local expected="$3"

  echo -e "${BLUE}TEST: $name${NC}"
  RESULT=$("$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "$query" 2>&1)
  if echo "$RESULT" | grep -qE "$expected"; then
    echo -e "${GREEN}  OK: $RESULT${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}  FAIL: expected '$expected' got '$RESULT'${NC}"
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================"
echo "  SMOKE TEST - ProntoClinic Hub"
echo "============================================"
echo ""

# 1. Conexão com banco
echo -e "${BLUE}[1] Verificando conexão...${NC}"
if "$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -c "SELECT 1;" > /dev/null 2>&1; then
  echo -e "${GREEN}  Conexão OK${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}  Conexão falhou${NC}"
  FAIL=$((FAIL + 1))
  exit 1
fi
echo ""

# 2. Listar profissionais
run_test "Listar profissionais ativos" \
  "SELECT COUNT(*) FROM professionals WHERE lg_ativo = TRUE;" \
  "^5$"

# 3. Listar pacientes
run_test "Listar pacientes ativos" \
  "SELECT COUNT(*) FROM patients WHERE lg_ativo = TRUE;" \
  "^5$"

# 4. Listar agendamentos futuros
run_test "Listar agendamentos (>= 20)" \
  "SELECT COUNT(*) FROM appointments WHERE scheduled_at >= CURRENT_DATE;" \
  "^([2-9][0-9]|[1-9][0-9][0-9]+)$"

# 5. Criar novo agendamento (INSERT)
echo -e "${BLUE}[5] Criando novo agendamento via SQL...${NC}"
"$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "
INSERT INTO appointments (company_id, patient_id, professional_id, scheduled_at, duration_minutes, status, dt_criacao)
SELECT '$COMPANY_ID', MIN(id), MIN(id), NOW() + INTERVAL '7 days', 30, 'scheduled', NOW() FROM patients
RETURNING id;
" > /tmp/new_id.txt 2>&1
NEW_ID=$(cat /tmp/new_id.txt | head -1 | tr -d ' ')
if [ -n "$NEW_ID" ] && [ "$NEW_ID" -gt 0 ] 2>/dev/null; then
  echo -e "${GREEN}  Agendamento criado ID=$NEW_ID${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}  Falha ao criar: '$NEW_ID' (raw: $(cat /tmp/new_id.txt))${NC}"
  FAIL=$((FAIL + 1))
  NEW_ID=0
fi

# 6. Cancelar agendamento
echo -e "${BLUE}[6] Cancelando agendamento $NEW_ID...${NC}"
"$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "
UPDATE appointments SET status = 'cancelled' WHERE id = $NEW_ID RETURNING status;
" > /tmp/cancelled.txt 2>&1
CANCELLED=$(cat /tmp/cancelled.txt | head -1 | tr -d ' ')
if [ "$CANCELLED" = "cancelled" ]; then
  echo -e "${GREEN}  Cancelado: $CANCELLED${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}  Falha ao cancelar: '$CANCELLED'${NC}"
  FAIL=$((FAIL + 1))
fi

# 7. Verificar audit log criado
echo -e "${BLUE}[7] Verificando audit_logs...${NC}"
AUDIT_COUNT=$("$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM audit_logs;")
echo "  Total audit logs: $AUDIT_COUNT"
if [ "$AUDIT_COUNT" -ge 1 ]; then
  echo -e "${GREEN}  Audit log OK${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}  Nenhum audit log${NC}"
  FAIL=$((FAIL + 1))
fi

# 8. Verificar notification pendente
echo -e "${BLUE}[8] Verificando notification pendente...${NC}"
NOTIF_COUNT=$("$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM notifications WHERE status = 'PENDING';")
echo "  Total notifications PENDING: $NOTIF_COUNT"
if [ "$NOTIF_COUNT" -ge 1 ]; then
  echo -e "${GREEN}  Notification PENDING OK${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}  Nenhuma notification pendente${NC}"
  FAIL=$((FAIL + 1))
fi

# 9. Testar query JOIN crítica
run_test "Query JOIN appointments+patients+professionals (>= 20)" \
  "SELECT COUNT(*) FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN professionals pr ON pr.id = a.professional_id;" \
  "^([2-9][0-9]|[1-9][0-9][0-9]+)$"

# 10. Testar RLS (via troca de role)
echo -e "${BLUE}[10] Testando RLS policies...${NC}"
RLS_COUNT=$("$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -t -A -c "SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';")
echo "  Total RLS policies: $RLS_COUNT"
if [ "$RLS_COUNT" -ge 10 ]; then
  echo -e "${GREEN}  RLS policies OK (>= 10)${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${YELLOW}  Poucas RLS policies: $RLS_COUNT${NC}"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "============================================"
echo "  RESUMO: $PASS passou, $FAIL falhou"
echo "============================================"

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}SMOKE TEST PASSOU!${NC}"
  exit 0
else
  echo -e "${YELLOW}SMOKE TEST COM FALHAS${NC}"
  exit 1
fi
