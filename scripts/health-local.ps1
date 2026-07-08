$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Assert-HttpJson($Name, $Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "$Name respondeu HTTP $($response.StatusCode)"
    }
    Write-Host "OK  $Name -> $Url"
  } catch {
    Write-Error "FALHA $Name -> $Url :: $($_.Exception.Message)"
    exit 1
  }
}

function Assert-Tcp($Name, $Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(1500)) { throw "timeout" }
    $client.EndConnect($iar)
    Write-Host "OK  $Name -> 127.0.0.1:$Port"
  } catch {
    Write-Error "FALHA $Name -> 127.0.0.1:$Port :: $($_.Exception.Message)"
    exit 1
  } finally {
    $client.Close()
  }
}

Assert-Tcp "PostgreSQL" 5432
Assert-HttpJson "Local Auth" "http://127.0.0.1:8000/auth/v1/settings"
Assert-HttpJson "Frontend Preview" "http://127.0.0.1:8080/"
Write-Host "Ambiente local ProntoMedic operacional."
