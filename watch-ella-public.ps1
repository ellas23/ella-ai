$ErrorActionPreference = 'Continue'
$pidDir = Join-Path $env:TEMP 'ella-public'
$secretDir = Join-Path $env:USERPROFILE '.ella'
$urlFile = Join-Path $secretDir 'ella-public-url.txt'
$logFile = Join-Path $pidDir 'tunnel-error.log'
$tunnelPidFile = Join-Path $pidDir 'tunnel.pid'
New-Item -ItemType Directory -Force -Path $pidDir,$secretDir | Out-Null
$pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
while ($true) {
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force -ErrorAction SilentlyContinue }
  Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  $tunnel = Start-Process -FilePath 'cloudflared' -ArgumentList 'tunnel','--url','http://127.0.0.1:3001','--protocol','http2','--no-autoupdate' -WorkingDirectory $pidDir -RedirectStandardOutput (Join-Path $pidDir 'tunnel-output.log') -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
  Set-Content -Path $tunnelPidFile -Value $tunnel.Id
  $url = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $logFile) {
      $match = Select-String -Path $logFile -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($match) { $url = $match.Matches[0].Value; Set-Content -Path $urlFile -Value $url -Encoding ascii; Write-Host "Ella public URL: $url"; break }
    }
    if ($tunnel.HasExited) { break }
  }
  if (-not $url -and -not $tunnel.HasExited) { Write-Host "Cloudflare Tunnel started but no URL was reported yet." }
  $unhealthyChecks = 0
  while (-not $tunnel.HasExited) {
    Start-Sleep -Seconds 10
    if (-not $url) { continue }
    try {
      $probe = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
      $unhealthyChecks = 0
    } catch {
      $unhealthyChecks++
      if ($unhealthyChecks -ge 3) {
        Write-Host "Cloudflare public URL is unreachable; restarting cloudflared."
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
        break
      }
    }
  }
  $tunnel.WaitForExit()
  Remove-Item $tunnelPidFile -Force -ErrorAction SilentlyContinue
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force -ErrorAction SilentlyContinue }
  Write-Host "Cloudflare Tunnel exited; retrying in 5 seconds."
  Start-Sleep -Seconds 5
}
