$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Start-VisibleService([string]$name, [string]$script) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "cd /d `"$root`" && call $script" -WorkingDirectory $root
  Write-Host "$name startup terminal opened."
}
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $root 'start-ella-background.ps1') -WorkingDirectory $root -WindowStyle Hidden
Write-Host 'Ella backend, AI, speech, and public tunnel are starting in the background.'
Start-Sleep -Seconds 3
Start-VisibleService 'Bob and its public tunnel' 'start-bob-public.cmd'
Start-Sleep -Seconds 5
$ports = @(3001,3010,11434)
foreach ($port in $ports) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { Write-Host "Port $port is listening locally." }
  elseif ($port -eq 11434) { Write-Host 'WARNING: Ollama is not listening locally on 127.0.0.1:11434.' }
  else { Write-Host "WARNING: required service on port $port is not ready yet." }
}
Write-Host 'Current Ella URL file: %USERPROFILE%\.ella\ella-public-url.txt'
Write-Host 'Current Bob URL file: %USERPROFILE%\.ella\bob-public-url.txt'
Write-Host 'Ella and Bob startup commands were issued without starting duplicate listeners.'
