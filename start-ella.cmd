@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
set "VENV_DIR=%ROOT%venv_coqui"
set "WHISPER_PYTHON=%VENV_DIR%\Scripts\python.exe"
set "FORCE_SAPI_VOICE=Microsoft Zira Desktop"
set "WHISPER_PYTHON=%WHISPER_PYTHON%"
if not defined ELLA_WATCH_ENV_FILE set "ELLA_WATCH_ENV_FILE=%USERPROFILE%\.ella\watch.env"
if exist "%ELLA_WATCH_ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ELLA_WATCH_ENV_FILE%") do (
    if /I "%%A"=="ELLA_WATCH_TOKEN" set "ELLA_WATCH_TOKEN=%%B"
  )
)

if not exist "%WHISPER_PYTHON%" (
  echo Creating local Ella Python environment...
  python -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo Failed to create venv. Falling back to system Python.
    set "WHISPER_PYTHON=python"
  )
)

if exist "%VENV_DIR%\Scripts\python.exe" (
  set "WHISPER_PYTHON=%VENV_DIR%\Scripts\python.exe"
  "%WHISPER_PYTHON%" -m pip install --upgrade pip
  "%WHISPER_PYTHON%" -m pip install faster-whisper sounddevice numpy requests
)

echo Starting Ella from the local assistant folder...
start "Ella Minecraft Backend" /D "%ROOT%" cmd /k node server.js
timeout /t 2 /nobreak >nul
node "%~dp0ella-ollama-female.mjs" --whisper
