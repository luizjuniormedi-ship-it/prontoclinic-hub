$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $Root '.tmp\local-runtime'
$Definitions = @(
  @{ Name = 'auth'; Token = 'local-auth-server.mjs' },
  @{ Name = 'vite'; Token = 'node_modules/vite/bin/vite.js' }
)

foreach ($Definition in $Definitions) {
  $PidFile = Join-Path $StateDir "$($Definition.Name).pid"
  if (Test-Path $PidFile) {
    $PidValue = 0
    if ([int]::TryParse((Get-Content -Raw -LiteralPath $PidFile), [ref]$PidValue)) {
      $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $PidValue" -ErrorAction SilentlyContinue
      if ($Process -and $Process.CommandLine -notlike "*$($Definition.Token)*") {
        throw "PID $PidValue nao pertence a $($Definition.Name); parada abortada sem encerrar o processo."
      }
      if ($Process) { Stop-Process -Id $PidValue -Force }
    }
    Remove-Item -LiteralPath $PidFile -Force
  }
  Remove-Item -LiteralPath (Join-Path $StateDir "$($Definition.Name).port") -Force -ErrorAction SilentlyContinue
}
Write-Host 'LOCAL_SERVICES_STOPPED'
