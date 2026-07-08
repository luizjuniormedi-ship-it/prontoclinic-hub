$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".local-runtime"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Test-Port($Port) {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-Port 8000)) {
  $auth = Start-Process -FilePath "node" -ArgumentList "local-auth-server.mjs" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $RuntimeDir "auth.pid") -Value $auth.Id
  Write-Host "Backend auth iniciado na porta 8000 (PID $($auth.Id))."
} else {
  Write-Host "Backend auth ja esta respondendo na porta 8000."
}

if (-not (Test-Port 8080)) {
  $front = Start-Process -FilePath "npm" -ArgumentList "run preview -- --host 127.0.0.1 --port 8080" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $RuntimeDir "preview.pid") -Value $front.Id
  Write-Host "Frontend preview iniciado na porta 8080 (PID $($front.Id))."
} else {
  Write-Host "Frontend preview ja esta respondendo na porta 8080."
}

Write-Host "Execute: npm run local:health"
