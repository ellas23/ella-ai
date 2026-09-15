$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidDir = Join-Path $env:TEMP 'ella-public'
$secretDir = Join-Path $env:USERPROFILE '.ella'
$secretFile = Join-Path $secretDir 'ella-admin.env'
$watchSecretFile = if ($env:ELLA_WATCH_ENV_FILE) { $env:ELLA_WATCH_ENV_FILE } else { Join-Path $secretDir 'watch.env' }
$logDir = Join-Path $secretDir 'logs'
$urlFile = Join-Path $secretDir 'ella-public-url.txt'
New-Item -ItemType Directory -Force -Path $pidDir,$secretDir,$logDir | Out-Null
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $password = [Convert]::ToBase64String($bytes)
  Set-Content -Path $secretFile -Value "ELLA_ADMIN_PASSWORD=$password" -Encoding ascii
  icacls $secretFile /inheritance:r /grant:r "$($env:USERNAME):R,W" | Out-Null
}
$line = Get-Content $secretFile | Where-Object { $_ -match '^ELLA_ADMIN_PASSWORD=' } | Select-Object -First 1
if (-not $line) { throw "Ella admin password file is invalid: $secretFile. Add ELLA_ADMIN_PASSWORD=your-password." }
$env:ELLA_ADMIN_PASSWORD = $line.Substring('ELLA_ADMIN_PASSWORD='.Length)
if (Test-Path $watchSecretFile) {
  $watchLine = Get-Content $watchSecretFile | Where-Object { $_ -match '^ELLA_WATCH_TOKEN=' } | Select-Object -First 1
  if ($watchLine) { $env:ELLA_WATCH_TOKEN = $watchLine.Substring('ELLA_WATCH_TOKEN='.Length) }
}
$env:ELLA_HOST = '0.0.0.0'
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $current = $false
  if ($existing -and $existing.CommandLine -and $existing.CommandLine -match [regex]::Escape((Join-Path $root 'server.js'))) {
    try {
      $probe = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/ella/status' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
      $current = (($probe.Content | ConvertFrom-Json).apiVersion -eq 'ella-lifecycle-v2')
    } catch {}
  }
  if (-not $current) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
    Remove-Item (Join-Path $pidDir 'ella.pid') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $pidDir 'launcher-owned-ella.pid') -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  $ella = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root -RedirectStandardOutput (Join-Path $logDir 'ella-server.log') -RedirectStandardError (Join-Path $logDir 'ella-server-error.log') -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $pidDir 'ella.pid') -Value $ella.Id
  Set-Content -Path (Join-Path $pidDir 'launcher-owned-ella.pid') -Value $ella.Id
  Start-Sleep -Seconds 2
}
Write-Host "Ella is running locally on 127.0.0.1:3001."
Write-Host "Cloudflare Quick Tunnel launcher disabled. Use the permanent Tailscale Funnel for remote access."
