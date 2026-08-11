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

"%HUB_ELECTRON%" "." "--quit-existing"
set "HUB_EXIT_CODE=%ERRORLEVEL%"
if not "%HUB_EXIT_CODE%"=="0" (
  echo [The Hub] The graceful stop request failed with exit code %HUB_EXIT_CODE%.
  pause
)
exit /b %HUB_EXIT_CODE%
