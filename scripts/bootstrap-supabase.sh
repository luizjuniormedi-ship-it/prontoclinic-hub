#!/usr/bin/env bash
# bootstrap-supabase.sh
# Script completo de setup inicial do Supabase para ProntoClinic Hub
#
# Pré-requisitos:
#   - Supabase CLI: https://supabase.com/docs/guides/cli
#   - psql (PostgreSQL client 14+)
#   - jq (para parsing de secrets)
#
# Uso:
#   ./scripts/bootstrap-supabase.sh <project-ref>
#
# Idempotente: pode rodar múltiplas vezes sem erro.
# Todas as migrations usam IF NOT EXISTS / DROP IF EXISTS.

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# Banner
cat <<'EOF'
============================================================
  ProntoClinic Hub - Bootstrap Supabase
  Setup inicial do banco de dados
============================================================
EOF

# Verificar dependências
log "Verificando dependências..."
command -v supabase >/dev/null 2>&1 || { err "supabase CLI não encontrado. Instale: https://supabase.com/docs/guides/cli"; exit 1; }
command -v psql >/dev/null 2>&1 || { err "psql não encontrado. Instale PostgreSQL client"; exit 1; }
command -v jq >/dev/null 2>&1 || warn "jq não encontrado (recomendado para parsing)"

# Verificar argumentos
if [ $# -lt 1 ]; then
  err "Uso: $0 <project-ref> [--skip-migrations] [--skip-seeds] [--skip-cron]"
  echo "  project-ref: ID do projeto no Supabase (ex: abcdefghijklmnopqrst)"
  echo "  --skip-migrations: não aplicar migrations"
  echo "  --skip-seeds: não carregar seeds"
  echo "  --skip-cron: não agendar job de retenção LGPD"
  exit 1
fi

PROJECT_REF="$1"
SKIP_MIGRATIONS=false
SKIP_SEEDS=false
SKIP_CRON=false

shift
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-migrations) SKIP_MIGRATIONS=true ;;
    --skip-seeds) SKIP_SEEDS=true ;;
    --skip-cron) SKIP_CRON=true ;;
    *) err "Argumento desconhecido: $1" ;;
  esac
  shift
done

log "Projeto Supabase: $PROJECT_REF"
info "Skip migrations: $SKIP_MIGRATIONS | Skip seeds: $SKIP_SEEDS | Skip cron: $SKIP_CRON"

# Verificar se já está logado
if ! supabase projects list >/dev/null 2>&1; then
  log "Fazendo login no Supabase..."
  supabase login
else
  log "Já logado no Supabase"
fi

# 1. Linkar projeto
log "Step 1/7: Linkando projeto..."
if supabase link --project-ref "$PROJECT_REF" 2>/dev/null; then
  log "Projeto linkado com sucesso"
else
  warn "Projeto já linkado ou erro ao linkar (continuando)"
fi

# 2. Obter DATABASE_URL
log "Step 2/7: Obtendo DATABASE_URL..."
if command -v jq >/dev/null 2>&1; then
  DATABASE_URL=$(supabase secrets get DATABASE_URL --project-ref "$PROJECT_REF" 2>/dev/null | jq -r '.[0].value' 2>/dev/null || echo "")
fi

if [ -z "$DATABASE_URL" ]; then
  warn "Não foi possível extrair DATABASE_URL via supabase secrets"
  echo -n "Cole o DATABASE_URL (postgresql://...): "
  read -r DATABASE_URL
  if [ -z "$DATABASE_URL" ]; then
    err "DATABASE_URL não fornecido"
    exit 1
  fi
fi

info "DATABASE_URL: ${DATABASE_URL:0:30}..."

# Testar conexão
log "Testando conexão com PostgreSQL..."
if ! psql "$DATABASE_URL" -c "SELECT version();" >/dev/null 2>&1; then
  err "Não foi possível conectar ao banco. Verifique DATABASE_URL"
  exit 1
fi
log "Conexão OK"

# 3. Aplicar migrations
if [ "$SKIP_MIGRATIONS" = false ]; then
  log "Step 3/7: Aplicando 14 migrations..."
  MIGRATION_COUNT=0
  FAILED=0

  for migration in supabase/migrations/*.sql; do
    if [ -f "$migration" ]; then
      MIGRATION_COUNT=$((MIGRATION_COUNT + 1))
      filename=$(basename "$migration")
      log "  [$MIGRATION_COUNT] Aplicando $filename..."
      if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null 2>&1; then
        log "    OK"
      else
        err "    FALHA em $filename"
        FAILED=$((FAILED + 1))
      fi
    fi
  done

  if [ $FAILED -gt 0 ]; then
    err "$FAILED migration(s) falharam"
    exit 1
  fi

  log "Todas as $MIGRATION_COUNT migrations aplicadas com sucesso"
else
  log "Step 3/7: Migrations puladas (--skip-migrations)"
fi

# 4. Carregar seeds
if [ "$SKIP_SEEDS" = false ]; then
  log "Step 4/7: Carregando seeds..."
  SEEDS=(
    "supabase/seed_payment_sources.sql"
    "supabase/seed_insurances.sql"
    "supabase/seed_categories.sql"
    "supabase/seed_notification_templates.sql"
    "supabase/seed_pre_cadastro_test.sql"
  )

  for seed in "${SEEDS[@]}"; do
    if [ -f "$seed" ]; then
      log "  Carregando $(basename $seed)..."
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$seed" >/dev/null 2>&1 || warn "  Falha ao carregar $seed (pode ser esperado se já carregado)"
    else
      warn "  Arquivo não encontrado: $seed"
    fi
  done
else
  log "Step 4/7: Seeds pulados (--skip-seeds)"
fi

# 5. Configurar Auth
log "Step 5/7: Configurando Supabase Auth..."
psql "$DATABASE_URL" -c "ALTER DATABASE postgres SET app.settings.signup_enabled = 'true';" 2>/dev/null || warn "Não foi possível alterar settings (ignorado)"

# 6. Agendar job de retenção LGPD
if [ "$SKIP_CRON" = false ]; then
  log "Step 6/7: Agendando job de retenção LGPD (pg_cron)..."
  if psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_cron;" >/dev/null 2>&1; then
    # Idempotente: remove se já existir
    psql "$DATABASE_URL" -c "SELECT cron.unschedule('purge-audit-logs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-audit-logs');" >/dev/null 2>&1 || true
    psql "$DATABASE_URL" -c "SELECT cron.schedule('purge-audit-logs', '0 3 * * *', 'SELECT purge_expired_audit_logs();');" 2>/dev/null \
      && log "Job pg_cron agendado: purge-audit-logs (3 AM diário)" \
      || warn "Não foi possível agendar job (função purge_expired_audit_logs pode não existir)"
  else
    warn "pg_cron não disponível — job manual necessário"
  fi
else
  log "Step 6/7: Cron pulado (--skip-cron)"
fi

# 7. Validar schema
log "Step 7/7: Validando schema..."
TOTAL_TABLES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
TOTAL_RLS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE t.schemaname = 'public' AND c.relrowsecurity = true;" | tr -d ' ')
TOTAL_FUNCS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" | tr -d ' ')
TOTAL_TRIGGERS=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public';" | tr -d ' ')
TOTAL_INDEXES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" | tr -d ' ')

log "Métricas do schema:"
echo "    Tabelas:        $TOTAL_TABLES"
echo "    Com RLS:        $TOTAL_RLS"
echo "    Funções:        $TOTAL_FUNCS"
echo "    Triggers:       $TOTAL_TRIGGERS"
echo "    Índices:        $TOTAL_INDEXES"

# 8. Health check
log "Health check final..."
psql "$DATABASE_URL" -c "SELECT 'DB OK' AS status, NOW() AS server_time, version() AS pg_version;"

cat <<'EOF'

============================================================
  ✅ Bootstrap completo!
============================================================

Próximos passos:
  1. Configure as env vars no Vercel/Netlify (veja .env.example)
  2. Faça deploy do frontend: vercel --prod
  3. Teste o fluxo de pre-cadastro em /pre-cadastro
  4. Migre dados do SIGH (opcional): python scripts/migrate_sigh.py

Supabase Dashboard:
  https://supabase.com/dashboard/project/$PROJECT_REF
EOF
