param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $project '..\docs\ai-execution\MVP_BASELINE_MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw "Manifest missing: $manifest" }
Write-Host 'PLAN ONLY: MVP baseline replay requires an explicitly approved local PostgreSQL target.'
if (-not $Execute) { Write-Host 'No SQL executed. Re-run with -Execute only in an approved local/ephemeral database.'; exit 0 }
throw 'Execution deliberately disabled in this workspace; use an approved local operator-run PostgreSQL harness.'
