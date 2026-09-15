$ErrorActionPreference = 'Continue'
$pidDir = Join-Path $env:TEMP 'ella-bob'
$secretDir = Join-Path $env:USERPROFILE '.ella'
$urlFile = Join-Path $secretDir 'bob-public-url.txt'
$logFile = Join-Path $pidDir 'tunnel-error.log'
$tunnelPidFile = Join-Path $pidDir 'tunnel.pid'
New-Item -ItemType Directory -Force -Path $pidDir,$secretDir | Out-Null
$pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
function Test-BobUrl([string]$candidate) {
  try {
    $hostName = ([uri]$candidate).Host
    $addresses = @(Resolve-DnsName $hostName -Server 1.1.1.1 -Type A -ErrorAction Stop | Select-Object -ExpandProperty IPAddress)
    foreach ($address in $addresses) {
      & curl.exe --fail --silent --show-error --max-time 15 --resolve "${hostName}:443:${address}" ($candidate + '/') *> $null
      if ($LASTEXITCODE -eq 0) { return $true }
    }
  } catch {}
  return $false
}
while ($true) {
  Remove-Item $urlFile,$logFile -Force -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath 'cloudflared' -ArgumentList 'tunnel','--url','http://127.0.0.1:3010','--protocol','http2','--no-autoupdate' -WorkingDirectory $pidDir -RedirectStandardOutput (Join-Path $pidDir 'tunnel-output.log') -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
  Set-Content $tunnelPidFile $tunnel.Id
  $url = $null
  for ($attempt = 0; $attempt -lt 180 -and -not $tunnel.HasExited; $attempt++) {
    Start-Sleep -Milliseconds 500
    $match = if (Test-Path $logFile) { Select-String -Path $logFile -Pattern $pattern -AllMatches | Select-Object -First 1 } else { $null }
    if ($match) {
      $candidate = $match.Matches[0].Value
      if (Test-BobUrl $candidate) {
        $url = $candidate
        Set-Content $urlFile $url -Encoding ascii
        Write-Host "Bob public URL: $url"
        break
      }
    }
  }
  while (-not $tunnel.HasExited) {
    Start-Sleep -Seconds 10
    if (-not $url) { continue }
    if (-not (Test-BobUrl $url)) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue; break }
  }
  $tunnel.WaitForExit()
  Remove-Item $tunnelPidFile,$urlFile -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 5
}
