$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Assert-HttpJson($Name, $Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "$Name respondeu HTTP $($response.StatusCode)"
    }
    Write-Host "OK  $Name -> $Url"
  } catch {
    Write-Error "FALHA $Name -> $Url :: $($_.Exception.Message)"
    exit 1
  }
}

function Assert-PostgresQuery {
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    throw "psql nao encontrado no PATH; o healthcheck nao pode validar o banco"
  }

  $env:PGHOST = if ($env:PGHOST) { $env:PGHOST } else { "127.0.0.1" }
  $env:PGPORT = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
  $env:PGUSER = if ($env:PGUSER) { $env:PGUSER } else { "app_prontomedic" }
  $env:PGDATABASE = if ($env:PGDATABASE) { $env:PGDATABASE } else { "prontoclinic" }

  & psql -X -qAt -v ON_ERROR_STOP=1 -c "SELECT 1" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "SELECT 1 falhou em $($env:PGHOST):$($env:PGPORT)/$($env:PGDATABASE)"
  }
  Write-Host "OK  PostgreSQL query -> $($env:PGHOST):$($env:PGPORT)/$($env:PGDATABASE)"
}

function Assert-AuthSmoke {
  $email = $env:PRONTOMEDIC_HEALTH_EMAIL
  $password = $env:PRONTOMEDIC_HEALTH_PASSWORD
  $required = $env:PRONTOMEDIC_REQUIRE_AUTH_SMOKE -eq "1"

  if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($password)) {
    if ($required) { throw "PRONTOMEDIC_HEALTH_EMAIL e PRONTOMEDIC_HEALTH_PASSWORD sao obrigatorios para o smoke de login" }
    Write-Host "WARN Login smoke ignorado; defina PRONTOMEDIC_REQUIRE_AUTH_SMOKE=1 com credenciais efemeras"
    return
  }

  $headers = @{ apikey = if ($env:VITE_SUPABASE_ANON_KEY) { $env:VITE_SUPABASE_ANON_KEY } else { "local-healthcheck" } }
  $body = @{ email = $email; password = $password } | ConvertTo-Json -Compress
  try {
    $token = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/auth/v1/token?grant_type=password" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 5
    if ([string]::IsNullOrWhiteSpace($token.access_token)) { throw "resposta sem access_token" }
    $user = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/auth/v1/user" -Headers (@{ apikey = $headers.apikey; Authorization = "Bearer $($token.access_token)" }) -TimeoutSec 5
    if ([string]::IsNullOrWhiteSpace($user.id)) { throw "resposta /auth/v1/user sem id" }
    Write-Host "OK  Auth login smoke -> $email"
  } catch {
    throw "smoke de login falhou para $email :: $($_.Exception.Message)"
  }
}

try {
  Assert-PostgresQuery
} catch {
  Write-Error "FALHA PostgreSQL :: $($_.Exception.Message)"
  exit 1
}
Assert-HttpJson "Local Auth" "http://127.0.0.1:8000/auth/v1/settings"
try {
  Assert-AuthSmoke
} catch {
  Write-Error "FALHA Auth smoke :: $($_.Exception.Message)"
  exit 1
}
Assert-HttpJson "Frontend Preview" "http://127.0.0.1:8080/"
Write-Host "Ambiente local ProntoMedic operacional."
