#!/usr/bin/env bash
# validate-all-migrations.sh
# Valida sintaxe de todas as migrations usando PostgreSQL real
#
# Pré-requisitos:
#   - PostgreSQL 14+ client (psql)
#   - DATABASE_URL apontando para um banco de testes
#
# Uso:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres ./scripts/validate-all-migrations.sh
#   ./scripts/validate-all-migrations.sh --keep-schema  # não dropa schema antes

set -euo pipefail

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

KEEP_SCHEMA=false
VERBOSE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-schema) KEEP_SCHEMA=true ;;
    --verbose|-v)  VERBOSE=true ;;
    --help|-h)
      echo "Uso: $0 [opções]"
      echo ""
      echo "Opções:"
      echo "  --keep-schema  Não dropa o schema public antes de começar"
      echo "  --verbose,-v   Mostrar output completo de cada migration"
      echo "  --help,-h      Mostrar esta ajuda"
      exit 0
      ;;
    *) echo "Argumento desconhecido: $1"; exit 1 ;;
  esac
  shift
done

# Verificar DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${RED}[ERROR]${NC} Defina DATABASE_URL antes de rodar este script"
  echo "Exemplo: DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres $0"
  exit 1
fi

# Verificar psql
command -v psql >/dev/null 2>&1 || { echo -e "${RED}[ERROR]${NC} psql não encontrado"; exit 1; }

# Verificar conexão
if ! psql "$DATABASE_URL" -c "SELECT 1;" >/dev/null 2>&1; then
  echo -e "${RED}[ERROR]${NC} Não foi possível conectar: $DATABASE_URL"
  exit 1
fi

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Validador de Migrations - ProntoClinic${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "DATABASE_URL: ${DATABASE_URL:0:30}..."

# Limpar schema (opcional)
if [ "$KEEP_SCHEMA" = false ]; then
  echo -e "${YELLOW}[WARN]${NC} Dropando schema public (use --keep-schema para preservar)..."
  psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;" 2>&1 | grep -v "^DROP\|^CREATE\|^GRANT" || true
fi

# Criar extensões necessárias
echo -e "${BLUE}Criando extensões...${NC}"
for ext in pg_trgm pgcrypto "uuid-ossp" citext btree_gist; do
  psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS \"$ext\";" 2>/dev/null || true
done

# Aplicar cada migration
ERRORS=0
TOTAL=0
for migration in supabase/migrations/*.sql; do
  TOTAL=$((TOTAL + 1))
  filename=$(basename "$migration")
  echo ""
  echo -e "${BLUE}=== [$TOTAL] $filename ===${NC}"

  if [ "$VERBOSE" = true ]; then
    if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" 2>&1; then
      echo -e "${GREEN}OK${NC}"
    else
      echo -e "${RED}FALHA${NC}"
      ERRORS=$((ERRORS + 1))
    fi
  else
    OUTPUT=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" 2>&1)
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}OK${NC}"
    else
      echo -e "${RED}FALHA${NC}"
      echo "$OUTPUT" | tail -20
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# Relatório final
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Relatório Final${NC}"
echo -e "${BLUE}============================================${NC}"

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}Todas as $TOTAL migrations aplicaram com sucesso!${NC}"
  echo ""

  # Coletar métricas
  TABLES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' \n')
  FUNCS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" | tr -d ' \n')
  TRIGGERS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public';" | tr -d ' \n')
  INDEXES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" | tr -d ' \n')
  RLS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE t.schemaname = 'public' AND c.relrowsecurity = true;" | tr -d ' \n')

  echo "Métricas do schema:"
  echo "  Tabelas:   $TABLES"
  echo "  Funções:   $FUNCS"
  echo "  Triggers:  $TRIGGERS"
  echo "  Índices:   $INDEXES"
  echo "  Com RLS:   $RLS"
  echo ""

  # Listar tabelas criadas
  echo "Tabelas criadas:"
  psql "$DATABASE_URL" -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" | sed 's/^/  /'

  exit 0
else
  echo -e "${RED}$ERRORS de $TOTAL migration(s) falharam${NC}"
  exit 1
fi
