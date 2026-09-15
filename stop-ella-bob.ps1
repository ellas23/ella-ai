$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $root 'stop-ella-public.ps1')
& (Join-Path $root 'stop-bob-public.ps1')
foreach ($name in @('launcher-owned-ella.pid','launcher-owned-bob.pid')) {
  $file = Join-Path $env:TEMP ("ella-public\" + $name)
  if ($name -like '*bob*') { $file = Join-Path $env:TEMP ("ella-bob\" + $name) }
  if (Test-Path $file) {
    $processId = [int](Get-Content $file)
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}
foreach ($name in @('launcher-owned-assistant.pid')) {
  $file = Join-Path $env:TEMP ("ella-public\" + $name)
  if (Test-Path $file) {
    $processId = [int](Get-Content $file)
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}
foreach ($name in @('launcher-owned-ollama.pid')) {
  $file = Join-Path $env:TEMP ("ella-public\" + $name)
  if (Test-Path $file) {
    $processId = [int](Get-Content $file)
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}
Write-Host 'Ella and Bob public tunnels stopped. Only servers started by this launcher were stopped.'
