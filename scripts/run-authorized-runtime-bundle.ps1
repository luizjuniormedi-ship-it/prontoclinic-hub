[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$DatabaseUrl = '',
  [string]$EvidenceRoot = '',
  [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ($project -match '(?i)(ssh|scp|vps|datasigh|supabase\.co|https?://)') {
  throw "Remote, VPS and DataSIGH paths are forbidden: $project"
}

if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  $EvidenceRoot = Join-Path $project '..\docs\ai-execution\outputs\authorized-runtime'
}
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path (New-Item -ItemType Directory -Path $EvidenceRoot -Force).FullName $runId
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$manifest = Join-Path $project '..\docs\ai-execution\MVP_BASELINE_MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw "Baseline manifest missing: $manifest" }
$manifestObject = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
$manifestProperties = @($manifestObject.PSObject.Properties.Name)
$manifestEntries = if ($manifestProperties -contains 'entries') {
  @($manifestObject.entries)
} elseif ($manifestProperties -contains 'baseline_mvp' -and $null -ne $manifestObject.baseline_mvp -and @($manifestObject.baseline_mvp.PSObject.Properties.Name) -contains 'selected_migrations') {
  @($manifestObject.baseline_mvp.selected_migrations)
} else {
  @($manifestObject.migrations)
}
$ordered = @($manifestEntries | Sort-Object order)

$plan = [ordered]@{
  run_id = $runId
  mode = if ($Execute) { 'EXECUTE_LOCAL_ONLY' } else { 'PLAN_ONLY' }
  project_root = $project
  database_target = if ($DatabaseUrl) { '<redacted-local-target>' } else { '<not-provided>' }
  first_blocking_prerequisite = 'Disposable local PostgreSQL instance with MVP baseline replayed and operator-provided fixtures A/B.'
  forbidden_targets = @('DataSIGH', 'VPS', 'SSH', 'SCP', 'Supabase hosted')
  expected_evidence = @(
    '01-environment.json',
    '02-replay.log',
    '03-catalog.json',
    '04-tenant-isolation.log',
    '05-constraints.log',
    '06-summary.json'
  )
  manifest_entries = $ordered.Count
}
$plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDir '00-plan.json') -Encoding UTF8

@(
  "# Authorized Runtime Bundle $runId",
  '',
  "Mode: $($plan.mode)",
  'Scope: local disposable PostgreSQL only; no remote execution.',
  '',
  '## First blocking prerequisite',
  '',
  'Provide a disposable local PostgreSQL database, replay the declared MVP baseline into it, and provide two fixture companies plus one authenticated user per company. Until then this bundle remains plan-only.',
  '',
  '## Evidence contract',
  '',
  '- `01-environment.json`: PostgreSQL version, database name, role and target classification; no passwords.',
  '- `02-replay.log`: ordered migration filenames and first SQLSTATE failure, if any.',
  '- `03-catalog.json`: `pg_proc`, `proacl`, owners, `relforcerowsecurity`, `relrowsecurity`, and constraints.',
  '- `04-tenant-isolation.log`: same-company allow and cross-company deny assertions.',
  '- `05-constraints.log`: duplicate, null, FK and tenant-key checks.',
  '- `06-summary.json`: pass/block status with command exit codes.',
  '',
  '## Execution rule',
  '',
  'Default is plan-only. Execution is permitted only with `-Execute -DatabaseUrl` pointing to a disposable local PostgreSQL target. The script rejects URLs containing remote/VPS/DataSIGH/hosted Supabase markers.'
) | Set-Content -LiteralPath (Join-Path $runDir 'README.md') -Encoding UTF8

if (-not $Execute) {
  Write-Output "PLAN_ONLY=$runDir"
  Write-Output "FIRST_BLOCKER=$($plan.first_blocking_prerequisite)"
  exit 0
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw '-DatabaseUrl is required with -Execute.' }
if ($DatabaseUrl -match '(?i)(datasigh|vps|ssh|scp|supabase\.co|publiccloud|mynetname|191\.252\.196\.6|https?://)') {
  throw 'Execution refused: target is not an approved disposable local PostgreSQL URL.'
}
if ($DatabaseUrl -notmatch '^(postgres(ql)?://)?(localhost|127\.0\.0\.1)(:\d+)?/') {
  throw 'Execution refused: only localhost/127.0.0.1 PostgreSQL targets are accepted.'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psql) { throw 'Execution blocked: psql was not found. Install/use local PostgreSQL, then rerun.' }

$envFile = Join-Path $runDir '01-environment.json'
& $psql.Source $DatabaseUrl -X -v ON_ERROR_STOP=1 -Atc "select json_build_object('server_version',current_setting('server_version'),'database',current_database(),'role',current_user)::text;" | Set-Content -LiteralPath $envFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { throw 'Environment probe failed.' }

$replayLog = Join-Path $runDir '02-replay.log'
"Replay is intentionally operator-controlled. Apply the ordered entries from plan-mvp-ephemeral-replay.ps1." | Set-Content -LiteralPath $replayLog -Encoding UTF8
& $psql.Source $DatabaseUrl -X -v ON_ERROR_STOP=1 -f (Join-Path $project 'supabase/tests/constraints_owner_runtime_contract.sql') 2>&1 | Tee-Object -FilePath (Join-Path $runDir '05-constraints.log')
if ($LASTEXITCODE -ne 0) { throw 'Constraint/owner runtime contract failed.' }

& $psql.Source $DatabaseUrl -X -v ON_ERROR_STOP=1 -f (Join-Path $project 'supabase/tests/tenant_isolation_runtime_contract.sql') 2>&1 | Tee-Object -FilePath (Join-Path $runDir '04-tenant-isolation.log')
if ($LASTEXITCODE -ne 0) { throw 'Tenant isolation runtime contract failed.' }

@{ status = 'PARTIAL_EXECUTION'; note = 'Catalog and fixture variables must be supplied by the operator before runtime assertions.'; run_id = $runId } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDir '06-summary.json') -Encoding UTF8
Write-Output "EVIDENCE_ROOT=$runDir"
