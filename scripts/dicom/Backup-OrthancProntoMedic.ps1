[CmdletBinding()]
param(
    [string]$ConfigurationPath = 'C:\Program Files\Orthanc Server\Configuration',
    [string]$ServiceXmlPath = 'C:\Program Files\Orthanc Server\OrthancProntoMedic.xml',
    [string]$BackupRoot = 'C:\ProgramData\ProntoMedic\Orthanc\backups',
    [switch]$Compress
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"

$ConfigurationPath = Assert-ProntoMedicPath -Path $ConfigurationPath
$ServiceXmlPath = Assert-ProntoMedicPath -Path $ServiceXmlPath
$BackupRoot = Assert-ProntoMedicPath -Path $BackupRoot

if (-not (Test-Path -LiteralPath $ConfigurationPath -PathType Container)) {
    throw "Diretorio de configuracao Orthanc nao encontrado: $ConfigurationPath"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $BackupRoot "orthanc-prontomedic-$timestamp"
$configBackupPath = Join-Path $backupPath 'Configuration'
New-Item -ItemType Directory -Path $configBackupPath -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $ConfigurationPath '*') -Destination $configBackupPath -Recurse -Force
if (Test-Path -LiteralPath $ServiceXmlPath -PathType Leaf) {
    Copy-Item -LiteralPath $ServiceXmlPath -Destination (Join-Path $backupPath 'OrthancProntoMedic.xml') -Force
}

$firewallSnapshot = Get-ManagedFirewallSnapshot
$firewallSnapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backupPath 'firewall-managed.json') -Encoding UTF8
$serviceState = Get-OrthancServiceState

$manifest = [ordered]@{
    SchemaVersion             = 1
    CreatedAt                 = (Get-Date).ToString('o')
    ComputerName              = $env:COMPUTERNAME
    ConfigurationSourcePath   = $ConfigurationPath
    ServiceXmlSourcePath      = $ServiceXmlPath
    Service                   = $serviceState
    ManagedFirewallRuleNames  = @($script:DicomRuleName, $script:HttpRuleName)
    ConfigurationFiles        = Get-FileInventory -Root $configBackupPath
    ServiceXmlSha256          = if (Test-Path -LiteralPath (Join-Path $backupPath 'OrthancProntoMedic.xml')) {
        (Get-FileHash -LiteralPath (Join-Path $backupPath 'OrthancProntoMedic.xml') -Algorithm SHA256).Hash
    } else { $null }
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $backupPath 'manifest.json') -Encoding UTF8

if ($Compress) {
    $zipPath = "$backupPath.zip"
    Compress-Archive -LiteralPath $backupPath -DestinationPath $zipPath -Force
    Write-Output $zipPath
} else {
    Write-Output $backupPath
}
