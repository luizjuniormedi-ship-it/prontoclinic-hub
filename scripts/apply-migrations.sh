#!/usr/bin/env bash
# apply-migrations.sh
# Aplica todas as migrations do Supabase em sequência com logging detalhado
# Uso: ./scripts/apply-migrations.sh

set -uo pipefail

PSQL="/c/PostgreSQL/15/bin/psql"
HOST="localhost"
PORT="54322"
USER="postgres"
DB="postgres"
MIGRATIONS_DIR="supabase/migrations"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ ! -x "$PSQL" ]; then
  echo "psql não encontrado em $PSQL"
  exit 1
fi

echo "=========================================="
echo "  Aplicando migrations no PostgreSQL $HOST:$PORT"
echo "=========================================="

TOTAL=0
SUCCESS=0
FAILED=0
declare -a FAILED_FILES

for migration in $MIGRATIONS_DIR/*.sql; do
  TOTAL=$((TOTAL + 1))
  filename=$(basename "$migration")

  echo ""
  echo -e "${BLUE}[$TOTAL] $filename${NC}"

  OUTPUT=$("$PSQL" -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$migration" 2>&1)
  RESULT=$?

  if [ $RESULT -eq 0 ]; then
    echo -e "${GREEN}OK${NC}"
    SUCCESS=$((SUCCESS + 1))
  else
    echo -e "${RED}FALHA${NC}"
    echo "$OUTPUT" | tail -5
    FAILED=$((FAILED + 1))
    FAILED_FILES+=("$filename")
  fi
done

echo ""
echo "=========================================="
echo "  Relatório"
echo "=========================================="
echo "Total:     $TOTAL"
echo "Sucesso:   $SUCCESS"
echo "Falha:     $FAILED"
if [ $FAILED -gt 0 ]; then
  echo "Arquivos com falha:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo -e "${GREEN}Todas as migrations aplicaram com sucesso!${NC}"
