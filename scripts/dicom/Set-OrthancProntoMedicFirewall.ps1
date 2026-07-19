[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [string[]]$EquipmentRemoteAddresses,

    [string[]]$AdminRemoteAddresses = @(),

    [ValidateSet('Domain', 'Private', 'Public', 'Domain,Private', 'Domain,Private,Public')]
    [string]$Profile = 'Domain,Private',

    [switch]$FailOnUnmanagedExposure
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"
Assert-Administrator
Assert-ExplicitRemoteAddresses -Addresses $EquipmentRemoteAddresses -Purpose 'DICOM 4242'
if ($AdminRemoteAddresses.Count -gt 0) {
    Assert-ExplicitRemoteAddresses -Addresses $AdminRemoteAddresses -Purpose 'administracao Orthanc 8042'
}

if ($PSCmdlet.ShouldProcess('Windows Firewall', 'aplicar regra DICOM 4242 restrita aos equipamentos')) {
    Set-ManagedFirewallRule -Name $script:DicomRuleName -DisplayName 'ProntoMedic Orthanc DICOM 4242 - equipamentos autorizados' `
        -LocalPort 4242 -RemoteAddress $EquipmentRemoteAddresses -Profile $Profile
}

$httpRule = Get-NetFirewallRule -Name $script:HttpRuleName -ErrorAction SilentlyContinue
if ($AdminRemoteAddresses.Count -eq 0) {
    if ($httpRule -and $PSCmdlet.ShouldProcess($script:HttpRuleName, 'remover acesso remoto 8042; localhost continua local')) {
        Remove-NetFirewallRule -Name $script:HttpRuleName
    }
} elseif ($PSCmdlet.ShouldProcess('Windows Firewall', 'aplicar regra 8042 restrita aos administradores')) {
    Set-ManagedFirewallRule -Name $script:HttpRuleName -DisplayName 'ProntoMedic Orthanc HTTP 8042 - administradores autorizados' `
        -LocalPort 8042 -RemoteAddress $AdminRemoteAddresses -Profile $Profile
}

$unmanaged = Test-UnmanagedPortExposure -Ports 4242, 8042
if ($unmanaged.Count -gt 0) {
    $unmanaged | Format-Table -AutoSize | Out-String | Write-Warning
    if ($FailOnUnmanagedExposure) {
        throw 'Existem regras de firewall nao gerenciadas que podem ampliar a exposicao de 4242/8042. Revise-as manualmente.'
    }
}

[pscustomobject]@{
    ManagedRules      = Get-ManagedFirewallSnapshot
    UnmanagedFindings = $unmanaged
}
