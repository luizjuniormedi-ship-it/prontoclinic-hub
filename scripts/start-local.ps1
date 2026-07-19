$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $Root '.tmp\local-runtime'
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Read-Port([string]$Name, [int]$Default) {
  $Value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $Value) { return $Default }
  $Parsed = 0
  if (-not [int]::TryParse($Value, [ref]$Parsed) -or $Parsed -lt 1024 -or $Parsed -gt 65535) {
    throw "$Name deve ser uma porta nao privilegiada entre 1024 e 65535."
  }
  return $Parsed
}

function Assert-RequiredSecret([string]$Name, [int]$MinLength = 1) {
  $Value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $Value -or $Value.Length -lt $MinLength -or $Value -like 'CHANGE_ME*') {
    throw "$Name deve ser definido com um valor real antes de iniciar o ambiente local."
  }
}

function Get-ManagedProcess([string]$Name, [string]$ExpectedToken) {
  $PidFile = Join-Path $StateDir "$Name.pid"
  if (-not (Test-Path $PidFile)) { return $null }
  $PidValue = 0
  if (-not [int]::TryParse((Get-Content -Raw -LiteralPath $PidFile), [ref]$PidValue)) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $PidValue" -ErrorAction SilentlyContinue
  if (-not $Process) {
    Remove-Item -LiteralPath $PidFile -Force
    return $null
  }
  if ($Process.CommandLine -notlike "*$ExpectedToken*") {
    throw "PID $PidValue registrado para $Name nao pertence ao runtime esperado; nenhuma acao foi executada."
  }
  return $Process
}

function Assert-PortAvailable([int]$Port) {
  $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try { $Listener.Start() } catch { throw "A porta local $Port ja esta ocupada por outro processo." } finally { $Listener.Stop() }
}

function Start-ManagedProcess([string]$Name, [string]$ScriptPath, [string[]]$Arguments, [int]$Port) {
  $Existing = Get-ManagedProcess $Name $ScriptPath
  if ($Existing) { return @{ Pid = [int]$Existing.ProcessId; Started = $false } }
  Assert-PortAvailable $Port
  $Out = Join-Path $StateDir "$Name.out.log"
  $Err = Join-Path $StateDir "$Name.err.log"
  $ProcessArguments = @($ScriptPath) + $Arguments
  $Process = Start-Process -FilePath 'node.exe' -ArgumentList $ProcessArguments -WorkingDirectory $Root `
    -WindowStyle Hidden -RedirectStandardOutput $Out -RedirectStandardError $Err -PassThru
  Set-Content -LiteralPath (Join-Path $StateDir "$Name.pid") -Value $Process.Id -NoNewline
  Set-Content -LiteralPath (Join-Path $StateDir "$Name.port") -Value $Port -NoNewline
  return @{ Pid = $Process.Id; Started = $true }
}

function Wait-Endpoint([string]$Name, [string]$Url, [int]$PidValue) {
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    if (-not (Get-Process -Id $PidValue -ErrorAction SilentlyContinue)) { break }
    try {
      $Response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 400) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  }
  $ErrorFile = Join-Path $StateDir "$Name.err.log"
  $Tail = if (Test-Path $ErrorFile) { (Get-Content -LiteralPath $ErrorFile -Tail 8) -join [Environment]::NewLine } else { 'sem log de erro' }
  throw "$Name nao ficou pronto em $Url.`n$Tail"
}

Assert-RequiredSecret 'JWT_SECRET' 32
Assert-RequiredSecret 'PGPASSWORD'
$AuthPort = Read-Port 'LOCAL_AUTH_PORT' 8000
$FrontendPort = Read-Port 'LOCAL_FRONTEND_PORT' 8080
if ($AuthPort -eq $FrontendPort) { throw 'LOCAL_AUTH_PORT e LOCAL_FRONTEND_PORT devem ser diferentes.' }
$env:LOCAL_AUTH_HOST = if ($env:LOCAL_AUTH_HOST) { $env:LOCAL_AUTH_HOST } else { '127.0.0.1' }
if ($env:LOCAL_AUTH_HOST -ne '127.0.0.1') {
  throw 'O runtime gerenciado local exige LOCAL_AUTH_HOST=127.0.0.1.'
}
$env:LOCAL_AUTH_PORT = [string]$AuthPort
$env:CORS_ALLOWED_ORIGINS = if ($env:CORS_ALLOWED_ORIGINS) { $env:CORS_ALLOWED_ORIGINS } else { "http://127.0.0.1:$FrontendPort,http://localhost:$FrontendPort" }

$Started = @()
try {
  $Auth = Start-ManagedProcess 'auth' 'local-auth-server.mjs' @() $AuthPort
  if ($Auth.Started) { $Started += @{ Name = 'auth'; Pid = $Auth.Pid } }
  $ViteScript = 'node_modules/vite/bin/vite.js'
  $Vite = Start-ManagedProcess 'vite' $ViteScript @('--host', '127.0.0.1', '--port', [string]$FrontendPort, '--strictPort') $FrontendPort
  if ($Vite.Started) { $Started += @{ Name = 'vite'; Pid = $Vite.Pid } }
  Wait-Endpoint 'auth' "http://127.0.0.1:$AuthPort/health" $Auth.Pid
  Wait-Endpoint 'vite' "http://127.0.0.1:$FrontendPort/" $Vite.Pid
  Write-Host "LOCAL_SERVICES_STARTED auth=$AuthPort vite=$FrontendPort"
} catch {
  foreach ($Item in $Started) {
    Stop-Process -Id $Item.Pid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $StateDir "$($Item.Name).pid") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $StateDir "$($Item.Name).port") -Force -ErrorAction SilentlyContinue
  }
  throw
}
