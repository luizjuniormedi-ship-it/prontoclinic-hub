# bootstrap-supabase.ps1
# Setup inicial do Supabase para ProntoClinic Hub (Windows)
#
# Pré-requisitos:
#   - Supabase CLI: scoop install supabase
#   - psql: incluir no PATH (vem com PostgreSQL ou Supabase CLI)
#
# Uso:
#   .\scripts\bootstrap-supabase.ps1 -ProjectRef "abcdefghijklmnopqrst"
#   .\scripts\bootstrap-supabase.ps1 -ProjectRef "abc" -SkipMigrations -SkipSeeds
#
# Idempotente: pode rodar múltiplas vezes sem erro.

param(
    [Parameter(Mandatory=$true)][string]$ProjectRef,
    [switch]$SkipMigrations,
    [switch]$SkipSeeds,
    [switch]$SkipCron,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Cores
function Log($msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }
function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }

# Banner
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "  ProntoClinic Hub - Bootstrap Supabase (Windows)" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

# Verificar dependências
Log "Verificando dependências..."
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Err "supabase CLI não encontrado. Instale: scoop install supabase"
    exit 1
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Warn "psql não está no PATH (pode estar dentro de supabase CLI)"
}

Log "Projeto Supabase: $ProjectRef"
Info "SkipMigrations: $SkipMigrations | SkipSeeds: $SkipSeeds | SkipCron: $SkipCron | DryRun: $DryRun"

# Login
if ($DryRun) {
    Log "[DRY-RUN] Pulando login"
} else {
    Log "Verificando login..."
    try {
        supabase projects list 2>&1 | Out-Null
        Log "Já logado no Supabase"
    } catch {
        Log "Fazendo login..."
        supabase login
    }
}

# 1. Linkar projeto
Log "Step 1/7: Linkando projeto..."
if ($DryRun) {
    Log "[DRY-RUN] supabase link --project-ref $ProjectRef"
} else {
    try {
        supabase link --project-ref $ProjectRef
        Log "Projeto linkado"
    } catch {
        Warn "Projeto já linkado ou erro (continuando)"
    }
}

# 2. Obter DATABASE_URL
Log "Step 2/7: Obtendo DATABASE_URL..."
$dbUrl = $null
if (-not $DryRun) {
    try {
        $secrets = supabase secrets get DATABASE_URL --project-ref $ProjectRef 2>&1
        # Tentar parsear JSON
        if ($secrets -match '"value"\s*:\s*"([^"]+)"') {
            $dbUrl = $matches[1]
        }
    } catch {}

    if (-not $dbUrl) {
        Warn "Não foi possível extrair DATABASE_URL automaticamente"
        $dbUrl = Read-Host "Cole o DATABASE_URL (postgresql://...)"
        if (-not $dbUrl) {
            Err "DATABASE_URL não fornecido"
            exit 1
        }
    }

    Info "DATABASE_URL: $($dbUrl.Substring(0, [Math]::Min(30, $dbUrl.Length)))..."

    # Testar conexão
    Log "Testando conexão..."
    try {
        psql $dbUrl -c "SELECT 1;" 2>&1 | Out-Null
        Log "Conexão OK"
    } catch {
        Err "Falha na conexão com o banco"
        exit 1
    }
}

# 3. Aplicar migrations
if (-not $SkipMigrations) {
    Log "Step 3/7: Aplicando 14 migrations..."
    $migrationsPath = Join-Path $PSScriptRoot "..\supabase\migrations"
    if (-not (Test-Path $migrationsPath)) {
        $migrationsPath = "supabase\migrations"
    }

    $migrations = Get-ChildItem "$migrationsPath\*.sql" | Sort-Object Name
    $count = 0
    $failed = 0

    foreach ($mig in $migrations) {
        $count++
        Log "  [$count/$($migrations.Count)] Aplicando $($mig.Name)..."
        if ($DryRun) {
            Log "    [DRY-RUN] psql -f $($mig.FullName)"
        } else {
            try {
                psql $dbUrl -v ON_ERROR_STOP=1 -f $mig.FullName 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Err "    Falha em $($mig.Name)"
                    $failed++
                } else {
                    Log "    OK"
                }
            } catch {
                Err "    Erro: $($_.Exception.Message)"
                $failed++
            }
        }
    }

    if ($failed -gt 0) {
        Err "$failed migration(s) falharam"
        if (-not $DryRun) { exit 1 }
    }
    Log "Migrations aplicadas: $count"
} else {
    Log "Step 3/7: Migrations puladas (-SkipMigrations)"
}

# 4. Seeds
if (-not $SkipSeeds) {
    Log "Step 4/7: Carregando seeds..."
    $seeds = @(
        "seed_payment_sources.sql",
        "seed_insurances.sql",
        "seed_categories.sql",
        "seed_notification_templates.sql",
        "seed_pre_cadastro_test.sql"
    )

    foreach ($seed in $seeds) {
        $seedPath = "supabase\$seed"
        if (-not (Test-Path $seedPath)) {
            $seedPath = Join-Path $PSScriptRoot "..\supabase\$seed"
        }
        if (Test-Path $seedPath) {
            Log "  Carregando $seed..."
            if ($DryRun) {
                Log "    [DRY-RUN] psql -f $seedPath"
            } else {
                try {
                    psql $dbUrl -f $seedPath 2>&1 | Out-Null
                } catch {
                    Warn "    Falha em $seed (pode ser esperado se já carregado)"
                }
            }
        } else {
            Warn "  Arquivo não encontrado: $seed"
        }
    }
} else {
    Log "Step 4/7: Seeds pulados (-SkipSeeds)"
}

# 5. Auth
Log "Step 5/7: Configurando Supabase Auth..."
if (-not $DryRun) {
    try {
        psql $dbUrl -c "ALTER DATABASE postgres SET app.settings.signup_enabled = 'true';" 2>&1 | Out-Null
    } catch {
        Warn "Não foi possível alterar settings (ignorado)"
    }
}

# 6. Cron
if (-not $SkipCron) {
    Log "Step 6/7: Agendando job de retenção LGPD (pg_cron)..."
    if (-not $DryRun) {
        try {
            psql $dbUrl -c "CREATE EXTENSION IF NOT EXISTS pg_cron;" 2>&1 | Out-Null
            psql $dbUrl -c "SELECT cron.unschedule('purge-audit-logs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-audit-logs');" 2>&1 | Out-Null
            psql $dbUrl -c "SELECT cron.schedule('purge-audit-logs', '0 3 * * *', 'SELECT purge_expired_audit_logs();');" 2>&1 | Out-Null
            Log "Job pg_cron agendado: purge-audit-logs (3 AM diário)"
        } catch {
            Warn "Não foi possível agendar job (função purge_expired_audit_logs pode não existir)"
        }
    }
} else {
    Log "Step 6/7: Cron pulado (-SkipCron)"
}

# 7. Validar
Log "Step 7/7: Validando schema..."
if (-not $DryRun) {
    $tables = (psql $dbUrl -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>&1).Trim()
    $rls = (psql $dbUrl -t -c "SELECT COUNT(*) FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename WHERE t.schemaname = 'public' AND c.relrowsecurity = true;" 2>&1).Trim()
    $funcs = (psql $dbUrl -t -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public';" 2>&1).Trim()
    $triggers = (psql $dbUrl -t -c "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public';" 2>&1).Trim()
    $indexes = (psql $dbUrl -t -c "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" 2>&1).Trim()

    Log "Métricas do schema:"
    Write-Host "    Tabelas:        $tables"
    Write-Host "    Com RLS:        $rls"
    Write-Host "    Funções:        $funcs"
    Write-Host "    Triggers:       $triggers"
    Write-Host "    Índices:        $indexes"

    # Health check
    Log "Health check final..."
    psql $dbUrl -c "SELECT 'DB OK' AS status, NOW() AS server_time, version() AS pg_version;"
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Bootstrap completo!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Próximos passos:"
Write-Host "  1. Configure env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)"
Write-Host "  2. Deploy: vercel --prod"
Write-Host "  3. Teste pre-cadastro em /pre-cadastro"
Write-Host "  4. Migre SIGH (opcional): python scripts/migrate_sigh.py"
