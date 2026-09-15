$ErrorActionPreference = 'SilentlyContinue'
$pidDir = Join-Path $env:TEMP 'ella-bob'
foreach ($name in @('tunnel.pid','watcher.pid')) {
  $file = Join-Path $pidDir $name
  if (Test-Path $file) {
    $processId = [int](Get-Content $file)
    Stop-Process -Id $processId -Force
    Remove-Item $file -Force
  }
}
Get-CimInstance Win32_Process -Filter "name='cloudflared.exe'" | Where-Object { $_.CommandLine -match '127\.0\.0\.1:3010|localhost:3010' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Bob Cloudflare Tunnel stopped. Bob itself is still running on 127.0.0.1:3010.'
