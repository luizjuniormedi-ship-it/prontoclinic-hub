param(
  [string]$DatabaseUrl = '<LOCAL_EPHEMERAL_DATABASE_URL>'
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace = (Resolve-Path (Join-Path $project '..')).Path
$manifestPath = Join-Path $workspace 'docs\ai-execution\MVP_BASELINE_MANIFEST.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if ($DatabaseUrl -notmatch '^<LOCAL_EPHEMERAL_DATABASE_URL>$') {
  throw 'Plan-only script refuses database connections. Use the printed commands manually only against an approved disposable local PostgreSQL instance.'
}

$manifestProperties = @($manifest.PSObject.Properties.Name)
$entries = if ($manifestProperties -contains 'entries') {
  @($manifest.entries)
} elseif ($manifestProperties -contains 'baseline_mvp' -and $null -ne $manifest.baseline_mvp -and @($manifest.baseline_mvp.PSObject.Properties.Name) -contains 'selected_migrations') {
  @($manifest.baseline_mvp.selected_migrations)
} else {
  @($manifest.migrations)
}

$artifactRoots = @(
  $project,
  (Join-Path $workspace 'prontomedic-working')
)
$missing = @()
foreach ($entry in $entries) {
  $path = $artifactRoots | ForEach-Object { Join-Path $_ $entry.path } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $path) { $missing += $entry.path }
}
if ($missing.Count) {
  throw ('Manifest has missing files: ' + ($missing -join ', '))
}

$ordered = @($entries | Sort-Object order)
Write-Output 'PLAN ONLY: no psql, Docker, Supabase CLI or database connection will be started.'
Write-Output ("Project root: " + $project)
Write-Output ("Manifest: " + $manifestPath)
Write-Output ("Declared replay entries: " + $ordered.Count)
Write-Output ''
Write-Output '1. Create a disposable local PostgreSQL database/container manually.'
Write-Output '2. Apply only the ordered manifest entries below; stop on the first error.'
foreach ($entry in $ordered) {
  Write-Output ("   {0} {1}" -f $entry.order, $entry.path)
}
Write-Output ''
Write-Output '3. Run every required gate inside the same disposable database:'
foreach ($gate in $manifest.required_gates) {
  if ($gate -eq 'validate-rpc-contract.mjs') { Write-Output ("   scripts/" + $gate) }
  else { Write-Output ("   supabase/tests/" + $gate) }
}
Write-Output '4. Capture PostgreSQL version, ordered filenames, SQLSTATE failures and catalog output.'
Write-Output '5. Destroy the disposable database/container after evidence capture.'
