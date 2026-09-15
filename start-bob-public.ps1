$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidDir = Join-Path $env:TEMP 'ella-bob'
$secretDir = Join-Path $env:USERPROFILE '.ella'
$urlFile = Join-Path $secretDir 'bob-public-url.txt'
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null
New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
$env:BOB_HOST = '127.0.0.1'
$env:BOB_MODEL = 'gemma3:4b'
$listener = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  $bob = Start-Process -FilePath 'node' -ArgumentList 'bob.js' -WorkingDirectory $root -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $pidDir 'bob.pid') -Value $bob.Id
  Set-Content -Path (Join-Path $pidDir 'launcher-owned-bob.pid') -Value $bob.Id
  Start-Sleep -Seconds 2
} else { Write-Host 'Bob is already running on localhost:3010; not starting a duplicate.' }
$watcherPidFile = Join-Path $pidDir 'watcher.pid'
$watcher = if (Test-Path $watcherPidFile) { Get-Process -Id ([int](Get-Content $watcherPidFile) ) -ErrorAction SilentlyContinue } else { $null }
if (-not $watcher) {
  $watcher = Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'watch-bob-public.ps1') -WorkingDirectory $root -PassThru -WindowStyle Hidden
  Set-Content $watcherPidFile $watcher.Id
}
Write-Host 'Bob Cloudflare Quick Tunnel supervisor is running in the background.'
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  if (Test-Path $urlFile) { Write-Host "Bob public URL: $((Get-Content $urlFile -Raw).Trim())"; break }
}
