[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet("Begin", "Status", "Verify", "End")]
  [string]$Action,
  [string]$TaskId,
  [int]$Module,
  [string[]]$Paths,
  [string[]]$SharedPaths = @(),
  [string]$BaseRef = "origin/main",
  [string]$WorktreeRoot,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell converts native stderr into ErrorRecord objects. Git
    # writes normal progress (for example worktree creation) to stderr, so a
    # global Stop preference must not turn a successful command into a failure.
    $ErrorActionPreference = "Continue"
    $result = @(& git @Arguments 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) { throw ($result -join [Environment]::NewLine) }
  return $result
}

function Normalize-ClaimPath([string]$Value) {
  $normalized = $Value.Replace("\", "/").Trim().Trim("/")
  if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -in ".", "..") {
    throw "Claim path must be explicit: '$Value'"
  }
  return $normalized
}

function Test-PathOverlap([string]$Left, [string]$Right) {
  return $Left -eq $Right -or
    $Left.StartsWith("$Right/", [StringComparison]::OrdinalIgnoreCase) -or
    $Right.StartsWith("$Left/", [StringComparison]::OrdinalIgnoreCase)
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Content
  )
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

$repoRoot = (Invoke-Git rev-parse --show-toplevel | Select-Object -Last 1).Trim()
$commonDirRaw = (Invoke-Git rev-parse --git-common-dir | Select-Object -Last 1).Trim()
$commonDir = if ([IO.Path]::IsPathRooted($commonDirRaw)) {
  [IO.Path]::GetFullPath($commonDirRaw)
} else {
  [IO.Path]::GetFullPath((Join-Path $repoRoot $commonDirRaw))
}
$claimDir = Join-Path $commonDir "prontomedic-claims"
$mutex = [Threading.Mutex]::new($false, "ProntoMedic-Worktree-Claims")
$lockTaken = $false

try {
  $lockTaken = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
  if (-not $lockTaken) { throw "Could not acquire coordination lock." }
  New-Item -ItemType Directory -Path $claimDir -Force | Out-Null
  $claims = @(
    Get-ChildItem $claimDir -Filter "*.json" -File -ErrorAction SilentlyContinue |
      ForEach-Object { Get-Content $_.FullName -Raw | ConvertFrom-Json }
  )

  if ($Action -eq "Status") {
    if ($claims.Count -eq 0) { Write-Output "No active task claims."; return }
    $claims | Sort-Object module, taskId |
      Select-Object taskId, module, branch, worktree, baseCommit,
        @{Name = "paths"; Expression = { $_.paths -join ", " } } |
      Format-Table -AutoSize
    return
  }

  if ([string]::IsNullOrWhiteSpace($TaskId)) { throw "-TaskId is required." }
  if ($TaskId -notmatch "^[a-z0-9][a-z0-9-]{2,60}$") {
    throw "TaskId must use lowercase letters, numbers and hyphens."
  }
  $claimFile = Join-Path $claimDir "$TaskId.json"

  if ($Action -eq "Begin") {
    if ($Module -lt 1 -or $Module -gt 57) { throw "-Module must be between 1 and 57." }
    if (-not $Paths -or $Paths.Count -eq 0) { throw "At least one -Paths claim is required." }
    if (Test-Path $claimFile) { throw "Task '$TaskId' already has an active claim." }

    $exclusive = @($Paths | ForEach-Object { Normalize-ClaimPath $_ } | Sort-Object -Unique)
    $shared = @($SharedPaths | ForEach-Object { Normalize-ClaimPath $_ } | Sort-Object -Unique)
    foreach ($claim in $claims) {
      foreach ($candidate in $exclusive) {
        foreach ($existing in @($claim.paths) + @($claim.sharedPaths)) {
          if (Test-PathOverlap $candidate $existing) {
            throw "Path conflict: '$candidate' overlaps task '$($claim.taskId)' path '$existing'."
          }
        }
      }
      foreach ($candidate in $shared) {
        foreach ($existing in @($claim.paths)) {
          if (Test-PathOverlap $candidate $existing) {
            throw "Shared path '$candidate' is exclusively owned by '$($claim.taskId)'."
          }
        }
      }
    }

    Invoke-Git fetch origin --prune | Out-Null
    $baseCommit = (Invoke-Git rev-parse "$BaseRef^{commit}" | Select-Object -Last 1).Trim()
    $mainCommit = (Invoke-Git rev-parse "origin/main^{commit}" | Select-Object -Last 1).Trim()
    if ($baseCommit -ne $mainCommit -and -not $Force) {
      throw "BaseRef '$BaseRef' resolves to $baseCommit, but origin/main is $mainCommit. Rebase the task on origin/main or use -Force only for an explicitly approved release branch."
    }
    $branch = "codex/task-$TaskId"
    $parent = if ($WorktreeRoot) { [IO.Path]::GetFullPath($WorktreeRoot) } else { Split-Path $repoRoot -Parent }
    $worktree = Join-Path $parent "prontomedic-task-$TaskId"
    if (Test-Path $worktree) { throw "Worktree path already exists: $worktree" }

    Invoke-Git worktree add -b $branch $worktree $baseCommit | Out-Null
    $manifestDir = Join-Path $worktree ".coordination"
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
    $manifest = [ordered]@{
      taskId = $TaskId; module = $Module; baseCommit = $baseCommit
      paths = $exclusive; sharedPaths = $shared; status = "active"
    }
    $manifestPath = Join-Path $manifestDir "task.json"
    Write-Utf8NoBom $manifestPath ($manifest | ConvertTo-Json -Depth 5)

    $claim = [ordered]@{
      taskId = $TaskId; module = $Module; branch = $branch; worktree = $worktree
      baseRef = $BaseRef; baseCommit = $baseCommit; paths = $exclusive
      sharedPaths = $shared; createdAt = [DateTime]::UtcNow.ToString("o")
    }
    $tempClaim = "$claimFile.tmp"
    Write-Utf8NoBom $tempClaim ($claim | ConvertTo-Json -Depth 5)
    Move-Item $tempClaim $claimFile
    Write-Output "Task started: $TaskId"
    Write-Output "Worktree: $worktree"
    Write-Output "Branch: $branch"
    Write-Output "Base: $baseCommit"
    return
  }

  if (-not (Test-Path $claimFile)) { throw "No active claim found for '$TaskId'." }
  $current = Get-Content $claimFile -Raw | ConvertFrom-Json

  if ($Action -eq "Verify") {
    $manifest = Join-Path $current.worktree ".coordination/task.json"
    Push-Location $current.worktree
    try {
      & node (Join-Path $repoRoot "scripts/validate-task-scope.mjs") `
        --manifest $manifest --base $current.baseCommit --head HEAD --worktree
      if ($LASTEXITCODE -ne 0) { throw "Task scope validation failed." }
    }
    finally {
      Pop-Location
    }
    Write-Output "Task verified: $TaskId"
    return
  }

  $dirty = Invoke-Git -C $current.worktree status --porcelain
  if ($dirty -and -not $Force) {
    throw "Task worktree is dirty. Commit/stash changes or use -Force explicitly."
  }
  Remove-Item $claimFile -Force
  Write-Output "Claim released: $TaskId"
  Write-Output "Worktree retained for audit: $($current.worktree)"
}
finally {
  if ($lockTaken) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
