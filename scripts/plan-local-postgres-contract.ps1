[CmdletBinding()]
param([string]$ProjectRoot='', [string]$EvidenceRoot='')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)){$ProjectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path}
$project=(Resolve-Path -LiteralPath $ProjectRoot).Path
if ($project -match '(?i)(ssh|scp|vps|datasigh|supabase\.co|https?://)'){throw "Remote path forbidden: $project"}
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)){$EvidenceRoot=Join-Path $project '..\docs\ai-execution\outputs\authorized-runtime'}
$dir=Join-Path (New-Item -ItemType Directory -Path $EvidenceRoot -Force).FullName (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $dir -Force|Out-Null
$files=@('supabase/tests/fixtures_local_runtime.sql','supabase/tests/mvp_baseline_empty_db_gate.sql','supabase/tests/constraints_owner_runtime_contract.sql','supabase/tests/tenant_isolation_runtime_contract.sql','scripts/plan-mvp-ephemeral-replay.ps1')
$missing=@($files|Where-Object{!(Test-Path -LiteralPath (Join-Path $project $_))})
$status=if($missing.Count -eq 0){'READY_FOR_OPERATOR_LOCAL_RUN'}else{'BLOCKED_MISSING_ARTIFACTS'}
[ordered]@{mode='PLAN_ONLY';status=$status;first_blocking_prerequisite='Disposable local PostgreSQL with baseline replayed; operator runs fixture seed as local owner.';forbidden=@('remote PostgreSQL','VPS','DataSIGH','SSH','SCP','hosted Supabase');artifacts=$files;missing=$missing}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $dir '00-contract-status.json') -Encoding UTF8
'No database connection was attempted.'|Set-Content (Join-Path $dir 'README.txt') -Encoding UTF8
Write-Output "PLAN_ONLY=$dir"
Write-Output $status
