[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)]
    [string]$BackupPath,

    [switch]$StartService
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"
Assert-Administrator

$BackupPath = Assert-ProntoMedicPath -Path $BackupPath
$manifestPath = Join-Path $BackupPath 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Manifesto de backup ausente: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.SchemaVersion -ne 1) {
    throw "Versao de manifesto nao suportada: $($manifest.SchemaVersion)"
}
if ($manifest.ComputerName -ne $env:COMPUTERNAME) {
    throw "Backup pertence a outro servidor ($($manifest.ComputerName)). Restore bloqueado."
}

$configurationTarget = Assert-ProntoMedicPath -Path $manifest.ConfigurationSourcePath
$serviceXmlTarget = Assert-ProntoMedicPath -Path $manifest.ServiceXmlSourcePath
$configurationBackup = Join-Path $BackupPath 'Configuration'

foreach ($file in $manifest.ConfigurationFiles) {
    $source = Join-Path $configurationBackup $file.RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Arquivo de backup ausente: $source"
    }
    $actualHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($actualHash -ne $file.Sha256) {
        throw "Hash divergente no backup: $($file.RelativePath)"
    }
}

$serviceBefore = Get-OrthancServiceState
if ($PSCmdlet.ShouldProcess($configurationTarget, "restaurar configuracao Orthanc do backup $BackupPath")) {
    if ($serviceBefore.Exists -and $serviceBefore.State -eq 'Running') {
        Stop-Service -Name $script:ServiceName -Force
        (Get-Service -Name $script:ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }

    New-Item -ItemType Directory -Path $configurationTarget -Force | Out-Null
    Get-ChildItem -LiteralPath $configurationTarget -Force | Remove-Item -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $configurationBackup '*') -Destination $configurationTarget -Recurse -Force

    $serviceXmlBackup = Join-Path $BackupPath 'OrthancProntoMedic.xml'
    if (Test-Path -LiteralPath $serviceXmlBackup -PathType Leaf) {
        $xmlHash = (Get-FileHash -LiteralPath $serviceXmlBackup -Algorithm SHA256).Hash
        if ($manifest.ServiceXmlSha256 -and $xmlHash -ne $manifest.ServiceXmlSha256) {
            throw 'Hash divergente no XML do servico.'
        }
        Copy-Item -LiteralPath $serviceXmlBackup -Destination $serviceXmlTarget -Force
    }

    if ($StartService -or ($serviceBefore.Exists -and $serviceBefore.State -eq 'Running')) {
        Start-Service -Name $script:ServiceName
        (Get-Service -Name $script:ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
    }
}

Get-OrthancServiceState
