$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".local-runtime"
$PidFiles = @("auth.pid", "preview.pid")

foreach ($file in $PidFiles) {
  $path = Join-Path $RuntimeDir $file
  if (Test-Path -LiteralPath $path) {
    $pidValue = Get-Content -LiteralPath $path -Raw
    $pidValue = $pidValue.Trim()
    if ($pidValue) {
      $proc = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $proc.Id -Force
        Write-Host "Processo $($proc.Id) encerrado ($file)."
      }
    }
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}
