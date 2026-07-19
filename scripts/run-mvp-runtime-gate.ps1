[CmdletBinding()]
param(
  [string]$ProjectRoot = '',
  [string]$OutputRoot = '',
  [switch]$NoEvidenceUpdate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }

$resolvedProject = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([System.IO.Path]::IsPathRooted($resolvedProject) -eq $false) {
  throw "ProjectRoot must resolve to a local absolute path: $resolvedProject"
}
if ($resolvedProject.StartsWith('\\')) {
  throw "Remote/UNC workspace is forbidden: $resolvedProject"
}
if ($resolvedProject -match '(?i)(ssh|scp|vps|datasigh|supabase\.co|https?://)') {
  throw "Remote/VPS/DataSIGH-like path is forbidden: $resolvedProject"
}

$manifest = Join-Path $resolvedProject '..\docs\ai-execution\MVP_BASELINE_MANIFEST.json'
$package = Join-Path $resolvedProject 'package.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw "MVP manifest missing: $manifest" }
if (-not (Test-Path -LiteralPath $package)) { throw "package.json missing: $package" }
Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json | Out-Null
Get-Content -Raw -LiteralPath $package | ConvertFrom-Json | Out-Null

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $resolvedProject '..\docs\ai-execution\outputs\mvp-runtime-gates'
}
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not (Test-Path -LiteralPath $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}
$runDir = Join-Path (Resolve-Path -LiteralPath $OutputRoot).Path $runId
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$node = Get-Command node -ErrorAction SilentlyContinue
$results = [System.Collections.Generic.List[object]]::new()
if ($null -eq $node) {
  $results.Add([pscustomobject]@{ name = 'node'; script = ''; exit_code = 127; status = 'BLOCKED'; output = ''; error = 'node executable not found' })
} else {
  $gates = @(
    @{ name = 'manifest-hashes'; script = 'scripts\validate-mvp-manifest-hashes.mjs' },
    @{ name = 'package-structure'; script = 'scripts\validate-mvp-package-structure.mjs' },
    @{ name = 'rpc-contract'; script = 'scripts\validate-rpc-contract.mjs' }
  )
  Push-Location $resolvedProject
  try {
    foreach ($gate in $gates) {
      $outputFile = Join-Path $runDir "$($gate.name).log"
      $started = Get-Date
      $captured = @(& $node.Source $gate.script 2>&1 | Tee-Object -FilePath $outputFile)
      $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
      $results.Add([pscustomobject]@{
        name = $gate.name
        script = $gate.script
        exit_code = $exitCode
        status = if ($exitCode -eq 0) { 'PASS' } else { 'BLOCKED_OR_FAIL' }
        output = (Resolve-Path -LiteralPath $outputFile).Path
        started_at = $started.ToString('o')
        finished_at = (Get-Date).ToString('o')
      })
    }
  } finally {
    Pop-Location
  }
}

$resultItems = @($results)
$overall = if ($resultItems.Count -gt 0 -and @($resultItems | Where-Object { $_.exit_code -ne 0 }).Count -eq 0) { 'READY_FOR_REPLAY_GATE' } else { 'BLOCKED' }
$summary = [pscustomobject]@{
  run_id = $runId
  overall_status = $overall
  project_root = $resolvedProject
  scope = 'local runtime validation only; no SQL, psql, Supabase CLI, SSH, VPS or DataSIGH operations'
  gates = @($results)
}
$summaryJson = Join-Path $runDir 'summary.json'
$summaryMarkdown = Join-Path $runDir 'summary.md'
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryJson -Encoding UTF8
@('# MVP Runtime Gate ' + $runId, '', 'Status: ' + $overall, 'Project: ' + $resolvedProject, 'Scope: local Node validators only; no SQL or remote operation.', '') |
  Set-Content -LiteralPath $summaryMarkdown -Encoding UTF8
foreach ($item in $results) {
  Add-Content -LiteralPath $summaryMarkdown -Value ('- {0}: exit_code={1}, status={2}, log={3}' -f $item.name, $item.exit_code, $item.status, $item.output)
}

if (-not $NoEvidenceUpdate) {
  $evidence = Join-Path $resolvedProject '..\docs\ai-execution\TEST_EVIDENCE.md'
  Add-Content -LiteralPath $evidence -Value ([Environment]::NewLine + '## Runtime gate ' + $runId + [Environment]::NewLine)
  Add-Content -LiteralPath $evidence -Value ('- Status: ' + $overall + '; escopo somente validadores Node locais, sem SQL/remoto.')
  Add-Content -LiteralPath $evidence -Value ('- Summary: ' + $summaryMarkdown)
  foreach ($item in $results) {
    Add-Content -LiteralPath $evidence -Value ('- {0}: exit code `{1}`; log `{2}`.' -f $item.name, $item.exit_code, $item.output)
  }
}

Write-Output ($summary | ConvertTo-Json -Depth 6)
if ($overall -ne 'READY_FOR_REPLAY_GATE') { exit 1 }
