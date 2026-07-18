#!/usr/bin/env bash
# =============================================================================
# setup_teste_homolog.sh
# -----------------------------------------------------------------------------
# Deploy de TESTE/HOMOLOGACAO do ProntoClinic Hub.
#
# Ambiente alvo: homolog.medilife.com.br
# Banco alvo: Supabase (projeto de homolog - separado do de producao)
# Dados: backup do SIGH anonimizado
#
# USO:
#   1. Ter Supabase CLI:         npm i -g supabase
#   2. Ter Vercel CLI:           npm i -g vercel
#   3. Estar logado:             supabase login && vercel login
#   4. Rodar dry-run primeiro:   bash scripts/setup_teste_homolog.sh --dry-run
#   5. Aplicar:                  bash scripts/setup_teste_homolog.sh
#
# Variaveis de ambiente esperadas (em .env.homolog):
#   HOMOLOG_SUPABASE_PROJECT_REF=...
#   HOMOLOG_SUPABASE_DB_PASSWORD=...
#   HOMOLOG_SUPABASE_URL=...
#   HOMOLOG_SUPABASE_ANON_KEY=...
#   HOMOLOG_DOMAIN=homolog.medilife.com.br
#   HOMOLOG_VERCEL_TEAM_ID=...
#
# Idempotente: pode rodar multiplas vezes.
# =============================================================================

set -euo pipefail

# -------- CONFIGURACAO --------------------------------------------------------
PROJECT_NAME="prontoclinic-hub-homolog"
ENV_FILE=".env.homolog"
HOMOLOG_DOMAIN_DEFAULT="homolog.medilife.com.br"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
CYAN='\033[1;36m'
NC='\033[0m'

log()    { echo -e "${CYAN}[homolog-setup]${NC} $*"; }
ok()     { echo -e "${GREEN}[ok]${NC} $*"; }
warn()   { echo -e "${YELLOW}[warn]${NC} $*"; }
err()    { echo -e "${RED}[error]${NC} $*" >&2; }
info()   { echo -e "${BLUE}[info]${NC} $*"; }
banner() {
  cat <<'EOF'
============================================================
  ProntoClinic Hub - Setup TESTE/HOMOLOGACAO
  Ambiente: homolog.medilife.com.br
============================================================
EOF
}

# -------- FUNCOES AUXILIARES --------------------------------------------------
check_deps() {
  log "Verificando dependencias..."
  command -v supabase >/dev/null 2>&1 || { err "supabase CLI nao encontrado. Instale: https://supabase.com/docs/guides/cli"; exit 1; }
  command -v vercel    >/dev/null 2>&1 || { err "vercel CLI nao encontrado. Instale: npm i -g vercel"; exit 1; }
  command -v psql      >/dev/null 2>&1 || warn "psql nao encontrado (recomendado para validacao)"
  command -v jq        >/dev/null 2>&1 || warn "jq nao encontrado (recomendado)"
  ok "Dependencias verificadas"
}

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    warn "$ENV_FILE nao encontrado."
    warn "Crie com base em .env.homolog.example. Usando defaults."
    return 0
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  ok "Env vars carregadas de $ENV_FILE"
}

verify_env() {
  local missing=0
  [ -z "${HOMOLOG_SUPABASE_PROJECT_REF:-}" ] && { err "HOMOLOG_SUPABASE_PROJECT_REF nao definido"; missing=1; }
  [ -z "${HOMOLOG_SUPABASE_DB_PASSWORD:-}" ] && { err "HOMOLOG_SUPABASE_DB_PASSWORD nao definido"; missing=1; }
  [ -z "${HOMOLOG_SUPABASE_URL:-}" ] && { err "HOMOLOG_SUPABASE_URL nao definido"; missing=1; }
  [ -z "${HOMOLOG_SUPABASE_ANON_KEY:-}" ] && { err "HOMOLOG_SUPABASE_ANON_KEY nao definido"; missing=1; }
  [ "$missing" -eq 1 ] && { err "Defina as variaveis em $ENV_FILE"; exit 1; }
  ok "Env vars obrigatorias presentes"
}

# -------- ETAPAS --------------------------------------------------------------
step_check_login() {
  log "Etapa 1/8: Verificando autenticacao..."
  if ! supabase projects list >/dev/null 2>&1; then
    err "Nao logado no Supabase. Rode: supabase login"
    exit 1
  fi
  if ! vercel whoami >/dev/null 2>&1; then
    err "Nao logado no Vercel. Rode: vercel login"
    exit 1
  fi
  ok "Logado em Supabase e Vercel"
}

step_link_supabase() {
  log "Etapa 2/8: Linkando projeto Supabase de homolog..."
  if supabase status >/dev/null 2>&1; then
    ok "Projeto Supabase ja linkado"
    return 0
  fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] supabase link --project-ref $HOMOLOG_SUPABASE_PROJECT_REF"
    return 0
  fi
  supabase link --project-ref "$HOMOLOG_SUPABASE_PROJECT_REF"
  ok "Projeto Supabase linkado: $HOMOLOG_SUPABASE_PROJECT_REF"
}

step_apply_migrations() {
  log "Etapa 3/8: Aplicando migrations no Supabase de homolog..."
  if [ "${SKIP_MIGRATIONS:-false}" = "true" ]; then
    warn "Pulando migrations (SKIP_MIGRATIONS=true)"
    return 0
  fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] supabase db push"
    return 0
  fi
  # Confirmar antes de aplicar
  warn "Esta acao vai aplicar TODAS as 60 migrations no projeto de homolog."
  read -p "Continuar? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    warn "Abortado pelo usuario."
    exit 0
  fi
  supabase db push --include-all
  ok "Migrations aplicadas"
}

step_seed_data() {
  log "Etapa 4/8: Carregando dados de teste (anonimizados)..."
  if [ "${SKIP_SEED:-false}" = "true" ]; then
    warn "Pulando seed (SKIP_SEED=true)"
    return 0
  fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] scripts/seed-test-data.sql"
    return 0
  fi
  local seed_file="scripts/seed-test-data.sql"
  if [ ! -f "$seed_file" ]; then
    warn "$seed_file nao encontrado, pulando seed"
    return 0
  fi
  PGPASSWORD=<DEFINIR_FORA_DO_GIT>
    psql -h "db.${HOMOLOG_SUPABASE_PROJECT_REF}.supabase.co" \
         -p 5432 \
         -U postgres \
         -d postgres \
         -f "$seed_file"
  ok "Seed de dados de teste aplicado"
}

step_link_vercel() {
  log "Etapa 5/8: Linkando projeto Vercel..."
  if vercel ls >/dev/null 2>&1 | grep -q "$PROJECT_NAME"; then
    ok "Projeto Vercel ja linkado ($PROJECT_NAME)"
    return 0
  fi
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] vercel link --name $PROJECT_NAME"
    return 0
  fi
  vercel link --yes --name "$PROJECT_NAME"
  ok "Projeto Vercel linkado: $PROJECT_NAME"
}

step_set_env_vercel() {
  log "Etapa 6/8: Configurando env vars no Vercel..."
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] vercel env add ... (multiplas vars)"
    return 0
  fi

  # Configurar env vars para "preview" (Vercel usa preview para dominios nao-producao)
  local env_target="preview"
  for kv in \
      "VITE_SUPABASE_URL=$HOMOLOG_SUPABASE_URL" \
      "VITE_SUPABASE_ANON_KEY=$HOMOLOG_SUPABASE_ANON_KEY" \
      "VITE_APP_NAME=ProntoClinic Hub (HOMOLOG)" \
      "VITE_APP_ENV=staging" \
      "VITE_TISS_AMBIENTE=HOMOLOGACAO" \
      "VITE_TISS_VERSION=3.05.00" \
      "VITE_DICOM_BUCKET=dicom-homolog" \
      "VITE_ENABLE_TELEMEDICINE=false" \
      "VITE_ENABLE_WHATSAPP=false"; do
    key="${kv%%=*}"
    value="${kv#*=}"
    printf "%s" "$value" | vercel env add "$key" "$env_target" --force > /dev/null
    ok "  $key configurado ($env_target)"
  done
}

step_deploy_vercel() {
  log "Etapa 7/8: Fazendo deploy no Vercel..."
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] vercel deploy --yes"
    return 0
  fi
  vercel deploy --yes
  ok "Deploy de homolog concluido"
}

step_configure_domain() {
  log "Etapa 8/8: Configurando dominio ${HOMOLOG_DOMAIN:-$HOMOLOG_DOMAIN_DEFAULT}..."
  local domain="${HOMOLOG_DOMAIN:-$HOMOLOG_DOMAIN_DEFAULT}"
  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] vercel domains add $domain"
    return 0
  fi
  vercel domains add "$domain" || warn "Dominio ja existe ou erro (verifique no dashboard)"
  ok "Dominio $domain adicionado (configure DNS A/CNAME conforme instrucoes)"
}

print_summary() {
  cat <<EOF
============================================================
  RESUMO - Setup de TESTE/HOMOLOGACAO
============================================================
  Projeto Supabase:  $HOMOLOG_SUPABASE_PROJECT_REF
  URL Supabase:      $HOMOLOG_SUPABASE_URL
  Projeto Vercel:    $PROJECT_NAME
  Dominio:           ${HOMOLOG_DOMAIN:-$HOMOLOG_DOMAIN_DEFAULT}

  PROXIMOS PASSOS:
  1. Configurar DNS do dominio $HOMOLOG_DOMAIN_DEFAULT:
     - CNAME homolog -> cname.vercel-dns.com
  2. Aguardar propagacao DNS (ate 48h)
  3. Acessar https://${HOMOLOG_DOMAIN:-$HOMOLOG_DOMAIN_DEFAULT}
  4. Validar login com usuario de teste (admin@test.local)
  5. Rodar smoke tests: bash scripts/smoke-test.sh
  6. Validar funcionalidades criticas (checklist em DEPLOY_TESTE_E_PRODUCAO.md)

============================================================
EOF
}

# -------- MAIN ---------------------------------------------------------------
banner

# Parse de argumentos
DRY_RUN=false
SKIP_MIGRATIONS=false
SKIP_SEED=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)         DRY_RUN=true; shift ;;
    --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
    --skip-seed)       SKIP_SEED=true; shift ;;
    --help|-h)
      cat <<EOF
Uso: bash scripts/setup_teste_homolog.sh [opcoes]

Opcoes:
  --dry-run          Mostra o que sera feito, sem aplicar nada.
  --skip-migrations  Pula a aplicacao das migrations.
  --skip-seed        Pula o seed de dados de teste.
  --help, -h         Mostra esta ajuda.
EOF
      exit 0 ;;
    *) err "Argumento desconhecido: $1"; exit 1 ;;
  esac
done

load_env
check_deps
verify_env
step_check_login
step_link_supabase
step_apply_migrations
step_seed_data
step_link_vercel
step_set_env_vercel
step_deploy_vercel
step_configure_domain
print_summary

ok "Setup de homolog concluido!"