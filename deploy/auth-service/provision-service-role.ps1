[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[a-z_][a-z0-9_]{2,62}$')] [string] $ServiceLogin,
  [string] $Database = $env:PGDATABASE,
  [string] $HostName = $env:PGHOST,
  [int] $Port = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 }),
  [string] $AdminUser = $env:PGUSER
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ServiceLogin -in @('app_prontomedic', 'service_role', 'postgres')) {
  throw 'ServiceLogin deve ser um login exclusivo e nao pode ser app_prontomedic, service_role ou postgres.'
}
if ([string]::IsNullOrWhiteSpace($env:LOCAL_AUTH_SERVICE_PGPASSWORD) -or $env:LOCAL_AUTH_SERVICE_PGPASSWORD.Length -lt 24) {
  throw 'LOCAL_AUTH_SERVICE_PGPASSWORD deve estar definido com pelo menos 24 caracteres.'
}
foreach ($required in @{ Database = $Database; HostName = $HostName; AdminUser = $AdminUser }.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$required.Value)) { throw "$($required.Key) obrigatorio." }
}
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql nao encontrado no PATH.' }

$sqlPath = Join-Path $PSScriptRoot 'provision-service-role.sql'
if (-not $PSCmdlet.ShouldProcess("PostgreSQL $HostName`:$Port/$Database", "provisionar login exclusivo $ServiceLogin")) { return }

function ConvertTo-PsqlMetaLiteral([string] $Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = (Get-Command psql).Source
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
foreach ($argument in @('-X', '-v', 'ON_ERROR_STOP=1', '-h', $HostName, '-p', [string]$Port, '-U', $AdminUser, '-d', $Database)) {
  [void]$startInfo.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::Start($startInfo)
$process.StandardInput.WriteLine("\set service_login $(ConvertTo-PsqlMetaLiteral $ServiceLogin)")
$process.StandardInput.WriteLine("\set service_password $(ConvertTo-PsqlMetaLiteral $env:LOCAL_AUTH_SERVICE_PGPASSWORD)")
$process.StandardInput.WriteLine("\i $(ConvertTo-PsqlMetaLiteral ($sqlPath -replace '\\', '/'))")
$process.StandardInput.Close()
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "psql falhou com exit code $($process.ExitCode)." }

Write-Host 'Provisionamento concluido; execute a verificacao de startup do auth service antes do restart.'
