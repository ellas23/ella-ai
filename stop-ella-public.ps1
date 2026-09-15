$ErrorActionPreference = 'SilentlyContinue'
$pidDir = Join-Path $env:TEMP 'ella-public'
foreach ($name in @('tunnel.pid','watcher.pid')) {
  $file = Join-Path $pidDir $name
  if (Test-Path $file) {
    $processId = [int](Get-Content $file)
    Stop-Process -Id $processId -Force
    Remove-Item $file -Force
  }
}
Write-Host 'Ella Cloudflare Tunnel stopped. Ella itself is still running on 127.0.0.1:3001.'
