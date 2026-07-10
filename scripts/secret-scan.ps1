$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$patterns = @(
  "42533813000197@[A-Za-z0-9@._#$%+\-]+",
  "SUPABASE_SERVICE_ROLE_KEY\s*=\s*['""][A-Za-z0-9._-]{20,}['""]",
  "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
  "crypt\('[^'<][^']{5,}'",
  "Pronto[Cc]linic@[0-9]{4}",
  "local-dev-secret-prontoclinic[A-Za-z0-9_-]*"
)

$target = if ($args.Count -gt 0 -and $args[0] -eq "--staged") {
  $files = git -C $Root diff --cached --name-only --diff-filter=ACMR
  $files | ForEach-Object { Join-Path $Root $_ }
} else {
  @($Root)
}

$found = $false
foreach ($pattern in $patterns) {
  $matches = rg --line-number --hidden --glob "!.git" --glob "!node_modules" --glob "!dist" --glob "!scripts/secret-scan.ps1" --glob "!*.png" --glob "!*.ico" --glob "!*.webp" --glob "!*.jpg" --glob "!*.jpeg" $pattern $target 2>$null
  if ($LASTEXITCODE -eq 0 -and $matches) {
    $found = $true
    Write-Host ""
    Write-Host "SEGREDO/PADRAO SENSIVEL ENCONTRADO: $pattern" -ForegroundColor Red
    $matches | Select-Object -First 40 | ForEach-Object { Write-Host $_ }
  }
}

if ($found) {
  Write-Host ""
  Write-Host "Falha: remova segredos antes de commit/push." -ForegroundColor Red
  exit 1
}

Write-Host "OK: nenhum segredo conhecido encontrado no escopo analisado." -ForegroundColor Green

