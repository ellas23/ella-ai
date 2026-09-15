$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidDir = Join-Path $env:TEMP 'ella-public'
$logDir = Join-Path $env:USERPROFILE '.ella\logs'
New-Item -ItemType Directory -Force -Path $pidDir,$logDir | Out-Null

& (Join-Path $root 'start-ella-public.ps1') | Out-File (Join-Path $logDir 'ella-public-start.log') -Encoding utf8
Remove-Item Env:ELLA_ADMIN_PASSWORD -ErrorAction SilentlyContinue

$ollamaListener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ollamaListener) {
  $ollama = Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WorkingDirectory $root -RedirectStandardOutput (Join-Path $logDir 'ollama.log') -RedirectStandardError (Join-Path $logDir 'ollama-error.log') -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $pidDir 'launcher-owned-ollama.pid') -Value $ollama.Id
  Start-Sleep -Seconds 2
}

$assistant = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like '*ella-ollama-female.mjs*' } | Select-Object -First 1
if (-not $assistant) {
  $venvPython = Join-Path $root 'venv_coqui\Scripts\python.exe'
  if (Test-Path $venvPython) { $env:WHISPER_PYTHON = $venvPython }
  $env:FASTER_WHISPER_MODEL = 'medium.en'
  $env:FASTER_WHISPER_MODEL_DIR = Join-Path $root 'models\faster-whisper-medium.en'
  $env:FORCE_SAPI_VOICE = 'Microsoft Zira Desktop'
  $stdout = Join-Path $logDir 'ella-ai.log'
  $stderr = Join-Path $logDir 'ella-ai-error.log'
  $assistant = Start-Process -FilePath 'node' -ArgumentList 'ella-ollama-female.mjs','--whisper' -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $pidDir 'launcher-owned-assistant.pid') -Value $assistant.Id
  Write-Host 'Ella AI and speech process started in the background.'
} else {
  Write-Host 'Ella AI and speech process is already running; not starting a duplicate.'
}
Write-Host 'Ella background startup complete.'
