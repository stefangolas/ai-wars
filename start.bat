@echo off
set ROOT=%~dp0

echo Killing any existing server/orchestrator processes...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)

if "%1"=="--fresh" (
  echo Wiping database...
  del /f "%ROOT%server\game.db" 2>nul
)

echo Starting server...
start "TW Server" cmd /k "cd /d "%ROOT%server" && node server.js"

echo Waiting for server to start...
timeout /t 3 /nobreak >nul

echo Starting orchestrator...
start "TW Orchestrator" cmd /k "cd /d "%ROOT%bots" && node orchestrate.js"

echo Starting mastermind...
start "TW Mastermind" cmd /k "cd /d "%ROOT%bots" && node run_mastermind.js"

echo Done. Close the windows to stop.
