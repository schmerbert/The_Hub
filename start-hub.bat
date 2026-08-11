@echo off
setlocal
cd /d "%~dp0"

set "HUB_ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%HUB_ELECTRON%" (
  echo [The Hub] Electron is not installed.
  echo Run npm install in "%~dp0" and try again.
  pause
  exit /b 1
)

start "" "%HUB_ELECTRON%" "."
if errorlevel 1 (
  echo [The Hub] Electron could not be started.
  pause
  exit /b 1
)
exit /b 0
