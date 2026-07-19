[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$OrthancRoot = 'C:\Program Files\Orthanc Server',
    [string]$WinSWExecutable = 'C:\Program Files\Orthanc Server\OrthancProntoMedic.exe',
    [string]$OrthancExecutable = 'C:\Program Files\Orthanc Server\Orthanc.exe',
    [string]$ConfigurationPath = 'C:\Program Files\Orthanc Server\Configuration',
    [string]$StorageDirectory = 'C:\Orthanc',
    [string]$LogPath = 'C:\ProgramData\ProntoMedic\Orthanc\logs',
    [switch]$Start
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"
Assert-Administrator

$OrthancRoot = Assert-ProntoMedicPath -Path $OrthancRoot
$WinSWExecutable = Assert-ProntoMedicPath -Path $WinSWExecutable
$OrthancExecutable = Assert-ProntoMedicPath -Path $OrthancExecutable
$ConfigurationPath = Assert-ProntoMedicPath -Path $ConfigurationPath
$StorageDirectory = Assert-ProntoMedicPath -Path $StorageDirectory
$LogPath = Assert-ProntoMedicPath -Path $LogPath
$serviceXmlPath = Join-Path $OrthancRoot 'OrthancProntoMedic.xml'

foreach ($requiredPath in @($WinSWExecutable, $OrthancExecutable, $ConfigurationPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Pre-requisito ausente: $requiredPath"
    }
}

$xml = @"
<service>
  <id>$script:ServiceName</id>
  <name>Orthanc ProntoMedic</name>
  <description>Orthanc local do ProntoMedic. Nao gerencia DataSIGH, DICOMDS ou porta 104.</description>
  <executable>$(ConvertTo-XmlEscapedText $OrthancExecutable)</executable>
  <arguments>&quot;$(ConvertTo-XmlEscapedText $ConfigurationPath)&quot;</arguments>
  <serviceaccount>
    <username>NT AUTHORITY\LocalService</username>
  </serviceaccount>
  <logpath>$(ConvertTo-XmlEscapedText $LogPath)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <stoptimeout>30 sec</stoptimeout>
</service>
"@

$currentService = Get-OrthancServiceState
if ($currentService.Exists -and $currentService.PathName -notmatch [regex]::Escape($WinSWExecutable)) {
    throw "Ja existe um servico $script:ServiceName apontando para outro binario: $($currentService.PathName)"
}

if ($Start) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort 4242 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and (-not $currentService.Exists -or $listener.OwningProcess -ne $currentService.ProcessId)) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        throw "A porta 4242 ja esta ocupada pelo processo $($owner.ProcessName) PID $($listener.OwningProcess). Nenhum processo sera encerrado automaticamente."
    }
}

if ($PSCmdlet.ShouldProcess($serviceXmlPath, 'gravar XML WinSW idempotente')) {
    New-Item -ItemType Directory -Path $LogPath -Force | Out-Null
    Grant-OrthancServiceAccess -ProgramRoot $OrthancRoot -StorageRoot $StorageDirectory -LogRoot $LogPath
    $xml | Set-Content -LiteralPath $serviceXmlPath -Encoding UTF8
}

if (-not $currentService.Exists -and $PSCmdlet.ShouldProcess($script:ServiceName, 'instalar servico WinSW')) {
    & $WinSWExecutable install
    if ($LASTEXITCODE -ne 0) {
        throw "WinSW install falhou com codigo $LASTEXITCODE"
    }
}

if ((Get-OrthancServiceState).Exists -and $PSCmdlet.ShouldProcess($script:ServiceName, 'definir inicializacao automatica')) {
    Set-Service -Name $script:ServiceName -StartupType Automatic
}

if ($Start -and $PSCmdlet.ShouldProcess($script:ServiceName, 'iniciar servico')) {
    Start-Service -Name $script:ServiceName
    (Get-Service -Name $script:ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

Get-OrthancServiceState
