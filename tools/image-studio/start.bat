@echo off
setlocal
cd /d "%~dp0"
set GRADIO_ANALYTICS_ENABLED=False
if exist ".venv\Scripts\python.exe" goto run
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.12+ is required. Install Python and enable Add Python to PATH.
  pause
  exit /b 1
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)"
if errorlevel 1 (
  echo Python 3.12+ is required.
  pause
  exit /b 1
)
python -m venv .venv
if errorlevel 1 goto failed
:run
".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements-lock.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" app.py %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Please copy the error message above.
pause
exit /b 1
