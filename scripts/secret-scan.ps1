[CmdletBinding()]
param(
    [switch]$staged
)

$ErrorActionPreference = 'Stop'

function Get-CandidatePaths {
    if ($staged) {
        git diff --cached --name-only --diff-filter=ACMRT
        return
    }

    git ls-files
    git status --porcelain=v1 | ForEach-Object {
        if ($_.Length -ge 4 -and $_.Substring(0, 2) -eq '??') {
            $_.Substring(3)
        }
    }
}

$root = (git rev-parse --show-toplevel).Trim()
$excluded = @('node_modules', 'dist', 'coverage', 'playwright-report', 'test-results', '.git', '__pycache__')
$secretPatterns = @(
    'BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY',
    '(?i)(service_role|supabase_service_role_key)\s*[:=]\s*[''\"]?[A-Za-z0-9+/=_-]{20,}',
    '(?i)(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[''\"]?[A-Za-z0-9+/=_-]{24,}',
    '(?i)postgres(?:ql)?://[^\s:@]+:[^\s@]+@',
    '(?i)-----BEGIN [^-]+ PRIVATE KEY-----'
)

$allowedExampleMarkers = '(?i)(example|placeholder|your_|replace_|change[_-]?me|changeme|dummy|local-dev-|localhost|127\.0\.0\.1|p_token|test[_-]?token|<[^>]+>)'
$nonSourcePath = '(?i)(\.env\.example$|\.md$|__tests__|scripts[/\\]stop-local\.ps1$)'
$criticalPatterns = @($secretPatterns[0], $secretPatterns[3], $secretPatterns[4])

$files = Get-CandidatePaths |
    Where-Object { $_ -and ($_ -notmatch '\.tar\.gz$') } |
    Sort-Object -Unique |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object {
        (Test-Path -LiteralPath $_ -PathType Leaf) -and
        -not ($excluded | Where-Object { $_.FullName -like "*\$_\*" })
    }

$findings = @()
foreach ($file in $files) {
    try {
        $matches = Select-String -LiteralPath $file -Pattern $secretPatterns -AllMatches -ErrorAction Stop
        foreach ($match in $matches) {
            $relative = $match.Path.Substring($root.Length + 1)
            $critical = $false
            foreach ($pattern in $criticalPatterns) {
                if ($match.Line -match $pattern) {
                    $critical = $true
                    break
                }
            }
            if ($match.Line -notmatch $allowedExampleMarkers -and ($critical -or $relative -notmatch $nonSourcePath)) {
                $findings += $match | Select-Object Path, LineNumber
            }
        }
    } catch {
        # Ignore binary/unreadable files; source files are still scanned.
    }
}

if ($findings.Count -gt 0) {
    Write-Error ("Potential secret patterns found in {0} source locations." -f $findings.Count)
    $findings | ForEach-Object { Write-Error ("{0}:{1}" -f $_.Path, $_.LineNumber) }
    exit 1
}

Write-Host ("secret scan: OK ({0} files inspected)" -f @($files).Count)
