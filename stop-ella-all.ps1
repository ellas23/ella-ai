$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidDirs = @(
  (Join-Path $env:TEMP 'ella-public'),
  (Join-Path $env:TEMP 'ella-bob')
)
$pidFiles = @(
  'launcher-owned-ella.pid',
  'launcher-owned-assistant.pid',
  'launcher-owned-ollama.pid',
  'launcher-owned-bob.pid',
  'tunnel.pid',
  'watcher.pid'
)

foreach ($dir in $pidDirs) {
  foreach ($name in $pidFiles) {
    $file = Join-Path $dir $name
    if (-not (Test-Path $file)) { continue }
    $value = Get-Content $file -Raw
    $processId = 0
    if ([int]::TryParse($value.Trim(), [ref]$processId)) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item $file -Force -ErrorAction SilentlyContinue
  }
}

foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and (
    $_.CommandLine -like '*ella-ai-main*server.js*' -or
    $_.CommandLine -like '*ella-ollama-female.mjs*'
  )
})) {
  Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
}
foreach ($listener in @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($owner -and $owner.CommandLine -and $owner.CommandLine -like '*ella-ai-main*') {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Write-Host 'Launcher-owned Ella and Bob processes/tunnels stopped.'
