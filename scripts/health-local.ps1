$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $Root '.tmp\local-runtime'

function Read-State([string]$Name, [string]$Kind) {
  $Path = Join-Path $StateDir "$Name.$Kind"
  if (-not (Test-Path $Path)) { throw "Estado ausente: $Path. Execute npm run local:start." }
  $Value = 0
  if (-not [int]::TryParse((Get-Content -Raw -LiteralPath $Path), [ref]$Value)) { throw "Estado invalido: $Path" }
  return $Value
}

function Test-ManagedEndpoint([string]$Name, [string]$ExpectedToken, [string]$Path) {
  $PidValue = Read-State $Name 'pid'
  $Port = Read-State $Name 'port'
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $PidValue" -ErrorAction SilentlyContinue
  if (-not $Process -or $Process.CommandLine -notlike "*$ExpectedToken*") { throw "$Name PID=$PidValue nao corresponde ao runtime gerenciado." }
  $Url = "http://127.0.0.1:$Port$Path"
  try { $Response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5 } catch { throw "${Name} falhou em ${Url}: $($_.Exception.Message)" }
  if ($Response.StatusCode -lt 200 -or $Response.StatusCode -ge 400) { throw "$Name retornou HTTP $($Response.StatusCode) em $Url" }
  Write-Host "$Name=HTTP_$($Response.StatusCode) PID=$PidValue PORT=$Port"
}

Test-ManagedEndpoint 'auth' 'local-auth-server.mjs' '/health'
Test-ManagedEndpoint 'vite' 'node_modules/vite/bin/vite.js' '/'
Write-Host 'LOCAL_HEALTH=PASS'
