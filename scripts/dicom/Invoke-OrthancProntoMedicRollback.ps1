[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [string]$BackupPath
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"
Assert-Administrator

$BackupPath = Assert-ProntoMedicPath -Path $BackupPath
$manifestPath = Join-Path $BackupPath 'manifest.json'
$firewallPath = Join-Path $BackupPath 'firewall-managed.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Manifesto ausente: $manifestPath"
}

if ($PSCmdlet.ShouldProcess($script:ServiceName, "rollback usando $BackupPath")) {
    & "$PSScriptRoot\Restore-OrthancProntoMedic.ps1" -BackupPath $BackupPath -Confirm:$false
    if ($LASTEXITCODE -ne 0) {
        throw "Restore da configuracao falhou com codigo $LASTEXITCODE"
    }

    Get-NetFirewallRule -Group $script:ManagedFirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if (Test-Path -LiteralPath $firewallPath -PathType Leaf) {
        $firewallRules = @(Get-Content -LiteralPath $firewallPath -Raw | ConvertFrom-Json)
        foreach ($rule in $firewallRules) {
            $port = [int]@($rule.LocalPort)[0]
            Assert-AllowedDicomPort -Port $port
            $addresses = @($rule.RemoteAddress)
            Assert-ExplicitRemoteAddresses -Addresses $addresses -Purpose "rollback firewall $port"
            New-NetFirewallRule -Name $rule.Name -DisplayName $rule.DisplayName -Group $script:ManagedFirewallGroup `
                -Direction Inbound -Action $rule.Action -Enabled $rule.Enabled -Profile $rule.Profile `
                -Protocol TCP -LocalPort $port -RemoteAddress $addresses | Out-Null
        }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $service = Get-OrthancServiceState
    if ($service.Exists) {
        if ($manifest.Service.StartMode -eq 'Auto') {
            Set-Service -Name $script:ServiceName -StartupType Automatic
        } elseif ($manifest.Service.StartMode -eq 'Manual') {
            Set-Service -Name $script:ServiceName -StartupType Manual
        } elseif ($manifest.Service.StartMode -eq 'Disabled') {
            Set-Service -Name $script:ServiceName -StartupType Disabled
        }

        if ($manifest.Service.State -eq 'Running' -and (Get-Service -Name $script:ServiceName).Status -ne 'Running') {
            Start-Service -Name $script:ServiceName
        } elseif ($manifest.Service.State -ne 'Running' -and (Get-Service -Name $script:ServiceName).Status -eq 'Running') {
            Stop-Service -Name $script:ServiceName -Force
        }
    }
}

[pscustomobject]@{
    Service  = Get-OrthancServiceState
    Firewall = Get-ManagedFirewallSnapshot
}
