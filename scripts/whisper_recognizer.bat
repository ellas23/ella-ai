@echo off
REM whisper_recognizer.bat
REM This helper tries to run a whisper-streaming binary named whisper_stream.exe placed in the same folder.
REM Usage: whisper_recognizer.bat [model-path]

setlocal
set model=%1
if "%model%"=="" set model=%~dp0..\models\ggml-model-small.bin
necho Whisper recognizer helper starting. Looking for whisper_stream.exe in %~dp0
if exist "%~dp0whisper_stream.exe" (
  echo Found whisper_stream.exe - launching with model %model%
  "%~dp0whisper_stream.exe" --model "%model%" --device default --output-raw
  exit /b %errorlevel%
)
necho whisper_stream.exe not found in %~dp0.
echo To use whisper.cpp locally:
echo 1) Build or download a whisper.cpp compatible binary that supports mic streaming (whisper_stream.exe), place it in this scripts folder.
echo 2) Download a ggml model (e.g., ggml-large.bin or ggml-medium.bin) and place it under the repo models/ folder or pass its path as the first argument to this script.
echo 3) Run this script again; the orb will read stdout lines from the stream and react.
echo Example (manual test):
echo   whisper_stream.exe --model "C:\path\to\ggml-large.bin" --device default --output-raw
necho If you prefer, use the project's README for whisper.cpp build instructions: https://github.com/ggerganov/whisper.cpp
pause
exit /b 1