$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $env:USERPROFILE '.ella\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Wait-Http($uri, $timeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    try { return Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop } catch { Start-Sleep -Seconds 2 }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $uri"
}

& (Join-Path $root 'start-ella-background.ps1') | Out-File (Join-Path $logDir 'start-ella-all.log') -Encoding utf8
$auth = Wait-Http 'http://127.0.0.1:3001/api/auth/status'
if ($auth.StatusCode -ne 200) { throw "Ella backend did not respond successfully." }
$ollama = Wait-Http 'http://127.0.0.1:11434/api/tags'
$models = $ollama.Content | ConvertFrom-Json
$configured = (Get-Content (Join-Path $root 'data\runtime_config.json') -Raw | ConvertFrom-Json).brain.model
$available = @($models.models | ForEach-Object { $_.name }) -contains $configured
if (-not $available) { throw "Configured Ollama model '$configured' is not installed." }
$voice = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*ella-ollama-female.mjs*' }
if (-not $voice) { throw 'Ella voice/AI process did not start.' }
$lifecycle = Wait-Http 'http://127.0.0.1:3001/api/ella/status'
$lifecycleData = $lifecycle.Content | ConvertFrom-Json
if ($lifecycleData.apiVersion -ne 'ella-lifecycle-v2') { throw 'The backend on port 3001 is not the current Ella lifecycle implementation.' }
$state = [string]$lifecycleData.data.state
if ($state -notin @('READY', 'DEGRADED')) { throw "Ella backend reported lifecycle state '$state'." }
Start-Process 'http://127.0.0.1:3001/'
Write-Host "READY: Ella backend, Ollama model $configured, voice process, dashboard, and lifecycle state $state are verified."
