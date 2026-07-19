[CmdletBinding()]
param(
    [string]$HostAddress = '127.0.0.1',
    [int]$DicomPort = 4242,
    [int]$HttpPort = 8042,
    [string]$CalledAet = 'PRONTOMEDIC',
    [string]$CallingAet = 'PRONTOMEDIC_DIAG',
    [ValidatePattern('^[A-Z0-9_]{1,16}$')]
    [string]$Modality = 'US',
    [string]$DcmtkBinPath,
    [pscredential]$OrthancCredential,
    [switch]$SkipEcho,
    [switch]$SkipMwl
)

. "$PSScriptRoot\OrthancProntoMedic.Common.ps1"
Assert-AllowedDicomPort -Port $DicomPort
Assert-AllowedDicomPort -Port $HttpPort

$results = [Collections.Generic.List[object]]::new()
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject]@{ Check = $Name; Passed = $Passed; Detail = $Detail })
}

$tcpDicom = Test-NetConnection -ComputerName $HostAddress -Port $DicomPort -InformationLevel Quiet -WarningAction SilentlyContinue
Add-Result 'TCP DICOM' $tcpDicom "$HostAddress`:$DicomPort"
$tcpHttp = Test-NetConnection -ComputerName $HostAddress -Port $HttpPort -InformationLevel Quiet -WarningAction SilentlyContinue
Add-Result 'TCP HTTP' $tcpHttp "$HostAddress`:$HttpPort"

$restParams = @{
    Uri         = "http://$HostAddress`:$HttpPort/system"
    Method      = 'Get'
    TimeoutSec  = 10
    ErrorAction = 'Stop'
}
if ($OrthancCredential) { $restParams.Credential = $OrthancCredential }
try {
    $system = Invoke-RestMethod @restParams
    $identityMatches = $system.DicomAet -eq $CalledAet -and [int]$system.DicomPort -eq $DicomPort
    Add-Result 'Orthanc REST /system' $identityMatches "Name=$($system.Name); AET=$($system.DicomAet); Port=$($system.DicomPort)"
} catch {
    Add-Result 'Orthanc REST /system' $false $_.Exception.Message
}

$pluginsParams = $restParams.Clone()
$pluginsParams.Uri = "http://$HostAddress`:$HttpPort/plugins"
try {
    $plugins = @(Invoke-RestMethod @pluginsParams)
    $hasWorklist = @($plugins | Where-Object { $_ -match 'worklist' }).Count -gt 0
    Add-Result 'Plugin Worklists' $hasWorklist ($plugins -join ',')
} catch {
    Add-Result 'Plugin Worklists' $false $_.Exception.Message
}

if (-not $DcmtkBinPath) {
    $candidates = @(
        'C:\Program Files\Orthanc Server\Tools',
        'C:\Program Files\DCMTK\bin',
        'C:\dcmtk\bin'
    )
    $DcmtkBinPath = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'echoscu.exe') } | Select-Object -First 1
}

if (-not $SkipEcho) {
    $echoScu = if ($DcmtkBinPath) { Join-Path $DcmtkBinPath 'echoscu.exe' } else { $null }
    if (-not $echoScu -or -not (Test-Path -LiteralPath $echoScu -PathType Leaf)) {
        Add-Result 'DICOM C-ECHO' $false 'echoscu.exe nao encontrado; informe -DcmtkBinPath.'
    } else {
        & $echoScu -v -aet $CallingAet -aec $CalledAet $HostAddress $DicomPort 2>&1 | Out-Host
        Add-Result 'DICOM C-ECHO' ($LASTEXITCODE -eq 0) "DCMTK exit=$LASTEXITCODE"
    }
}

if (-not $SkipMwl) {
    $findScu = if ($DcmtkBinPath) { Join-Path $DcmtkBinPath 'findscu.exe' } else { $null }
    if (-not $findScu -or -not (Test-Path -LiteralPath $findScu -PathType Leaf)) {
        Add-Result 'MWL C-FIND' $false 'findscu.exe nao encontrado; informe -DcmtkBinPath.'
    } else {
        $queryArgs = @(
            '-W', '-v', '-aet', $CallingAet, '-aec', $CalledAet,
            '-k', '0008,0050',
            '-k', '0010,0010',
            '-k', '0010,0020',
            '-k', "0040,0100[0].0008,0060=$Modality",
            '-k', '0040,0100[0].0040,0001',
            '-k', '0040,0100[0].0040,0002',
            $HostAddress, $DicomPort
        )
        & $findScu @queryArgs 2>&1 | Out-Host
        Add-Result 'MWL C-FIND' ($LASTEXITCODE -eq 0) "DCMTK exit=$LASTEXITCODE; CallingAET=$CallingAet; Modality=$Modality"
    }
}

$results | Format-Table -AutoSize
if (@($results | Where-Object { -not $_.Passed }).Count -gt 0) {
    exit 1
}
exit 0
