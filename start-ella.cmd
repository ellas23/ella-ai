@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0.."
set "VOSK_PYTHON=%ROOT%\venv_coqui\Scripts\python.exe"
set "FORCE_SAPI_VOICE=Microsoft Zira Desktop"

if not exist "%VOSK_PYTHON%" (
  echo Missing Vosk Python environment at "%VOSK_PYTHON%"
  echo Expected project venv to exist at repo root.
  pause
  exit /b 1
)

echo Starting Ella from the new assistant folder...
node "%~dp0ella-ollama-female.mjs"
