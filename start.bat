@echo off
setlocal
cd /d "%~dp0"

call "%~dp0start-hub.bat"
exit /b %ERRORLEVEL%
