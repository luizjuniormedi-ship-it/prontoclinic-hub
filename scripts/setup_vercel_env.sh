#!/usr/bin/env bash
# =============================================================================
# setup_vercel_env.sh
# -----------------------------------------------------------------------------
# Documenta todas as env vars necessarias e, apos o usuario autorizar o
# `vercel login`, configura todas em uma unica passada.
#
# USO:
#   1. Ter o Vercel CLI instalado:  npm i -g vercel
#   2. Estar logado:                vercel login
#   3. Linkar o projeto (uma vez):   vercel link
#   4. Rodar:                       bash scripts/setup_vercel_env.sh
#
# Para auditar sem aplicar nada:  bash scripts/setup_vercel_env.sh --dry-run
# Para gerar apenas o .env.example: bash scripts/setup_vercel_env.sh --example
# =============================================================================

set -euo pipefail

# -------- CONFIGURACAO --------------------------------------------------------
PROJECT_NAME="prontoclinic-hub"

# Variaveis obrigatorias (carregadas de .env.production local se existir)
ENV_FILE=".env.production"
EXAMPLE_FILE=".env.example.vercel"

# -------- FUNCOES ------------------------------------------------------------
log()    { echo -e "\033[1;36m[setup-vercel]\033[0m $*"; }
warn()   { echo -e "\033[1;33m[warn]\033[0m $*"; }
error()  { echo -e "\033[1;31m[error]\033[0m $*" >&2; }
ok()     { echo -e "\033[1;32m[ok]\033[0m $*"; }

# Carrega .env.production (ignora comentarios e linhas vazias)
load_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    warn "$ENV_FILE nao encontrado. Usando defaults hardcoded."
    return 0
  fi
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  ok "Env vars carregadas de $ENV_FILE"
}

# Gera o .env.example.vercel (template limpo, sem valores reais)
generate_example() {
  cat > "$EXAMPLE_FILE" <<'EOF'
# ProntoClinic Hub - Vercel Environment Variables
# Copie este arquivo para .env.production.local e preencha com seus valores reais.
# Ou cole cada linha em: Vercel Dashboard > Settings > Environment Variables

# ---------- Supabase ----------
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# ---------- App ----------
VITE_APP_NAME=ProntoClinic Hub
VITE_APP_ENV=production

# ---------- TISS ----------
VITE_TISS_AMBIENTE=HOMOLOGACAO
VITE_TISS_VERSION=3.05.00

# ---------- DICOM / PACS ----------
VITE_DICOM_BUCKET=dicom

# ---------- Features flags ----------
VITE_ENABLE_TELEMEDICINE=false
VITE_ENABLE_WHATSAPP=false

# ---------- Email (opcional) ----------
VITE_RESEND_API_KEY=
EOF
  ok "Exemplo gerado em $EXAMPLE_FILE"
}

# Mostra o plano de configuracao
print_plan() {
  cat <<EOF

============================================================
ProntoClinic Hub - Vercel Env Vars Plan
============================================================
Projeto alvo: ${PROJECT_NAME}

Variaveis a configurar em:
  Vercel Dashboard > Settings > Environment Variables
  OU  vercel env add <KEY> production  (CLI)

------------------------------------------------------------
EOF
  printf "  %-30s %s\n" "KEY" "VALUE"
  printf "  %-30s %s\n" "------------------------------" "---------------------------------------------"
  printf "  %-30s %s\n" "VITE_SUPABASE_URL"           "${VITE_SUPABASE_URL:-<VAZIO - OBRIGATORIO>}"
  printf "  %-30s %s\n" "VITE_SUPABASE_ANON_KEY"      "${VITE_SUPABASE_ANON_KEY:0:40:-40}..."
  printf "  %-30s %s\n" "VITE_APP_NAME"               "${VITE_APP_NAME:-ProntoClinic Hub}"
  printf "  %-30s %s\n" "VITE_APP_ENV"                "${VITE_APP_ENV:-production}"
  printf "  %-30s %s\n" "VITE_TISS_AMBIENTE"          "${VITE_TISS_AMBIENTE:-HOMOLOGACAO}"
  printf "  %-30s %s\n" "VITE_TISS_VERSION"           "${VITE_TISS_VERSION:-3.05.00}"
  printf "  %-30s %s\n" "VITE_DICOM_BUCKET"           "${VITE_DICOM_BUCKET:-dicom}"
  printf "  %-30s %s\n" "VITE_ENABLE_TELEMEDICINE"    "${VITE_ENABLE_TELEMEDICINE:-false}"
  printf "  %-30s %s\n" "VITE_ENABLE_WHATSAPP"        "${VITE_ENABLE_WHATSAPP:-false}"
  printf "  %-30s %s\n" "VITE_RESEND_API_KEY"         "${VITE_RESEND_API_KEY:+<definido>}${VITE_RESEND_API_KEY:-<vazio>}"
  echo "============================================================"
}

# Adiciona uma env var via Vercel CLI
add_env() {
  local key="$1"
  local value="$2"

  if [ -z "$value" ]; then
    warn "$key vazio - pulando"
    return 0
  fi

  if [ "${DRY_RUN:-false}" = "true" ]; then
    log "[dry-run] vercel env add $key production --force"
    return 0
  fi

  log "Configurando $key..."
  printf "%s" "$value" | vercel env add "$key" production --force > /dev/null
  ok "$key configurado"
}

# Aplica todas as env vars
apply_all() {
  if ! command -v vercel >/dev/null 2>&1; then
    error "Vercel CLI nao encontrado. Instale: npm i -g vercel"
    return 1
  fi

  if [ "${DRY_RUN:-false}" != "true" ]; then
    if ! vercel whoami >/dev/null 2>&1; then
      error "Nao logado no Vercel. Rode: vercel login"
      return 1
    fi
  fi

  add_env "VITE_SUPABASE_URL"        "${VITE_SUPABASE_URL:-}"
  add_env "VITE_SUPABASE_ANON_KEY"   "${VITE_SUPABASE_ANON_KEY:-}"
  add_env "VITE_APP_NAME"            "${VITE_APP_NAME:-ProntoClinic Hub}"
  add_env "VITE_APP_ENV"             "${VITE_APP_ENV:-production}"
  add_env "VITE_TISS_AMBIENTE"       "${VITE_TISS_AMBIENTE:-HOMOLOGACAO}"
  add_env "VITE_TISS_VERSION"        "${VITE_TISS_VERSION:-3.05.00}"
  add_env "VITE_DICOM_BUCKET"        "${VITE_DICOM_BUCKET:-dicom}"
  add_env "VITE_ENABLE_TELEMEDICINE" "${VITE_ENABLE_TELEMEDICINE:-false}"
  add_env "VITE_ENABLE_WHATSAPP"     "${VITE_ENABLE_WHATSAPP:-false}"
  add_env "VITE_RESEND_API_KEY"      "${VITE_RESEND_API_KEY:-}"

  ok "Todas env vars configuradas em production!"
  log "Forcando redeploy: vercel deploy --prod --yes"
}

# -------- MAIN ---------------------------------------------------------------
case "${1:-}" in
  --dry-run)
    DRY_RUN=true
    load_env_file
    print_plan
    log "Modo dry-run: nada sera alterado."
    ;;
  --example)
    generate_example
    ;;
  --plan)
    load_env_file
    print_plan
    ;;
  "")
    load_env_file
    print_plan
    apply_all
    ;;
  *)
    error "Argumento desconhecido: $1"
    echo "Uso: $0 [--dry-run|--example|--plan]"
    exit 1
    ;;
esac
