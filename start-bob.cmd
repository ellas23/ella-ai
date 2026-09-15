@echo off
setlocal
cd /d "%~dp0"
echo Starting Bob isolated browser session...
set BOB_HOST=127.0.0.1
set BOB_MODEL=gemma3:4b
for /f "delims=" %%T in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set BOB_CONTROL_TOKEN=%%T
node bob.js
