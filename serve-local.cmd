@echo off
REM Local dev server for בית עלמא. Open http://localhost:8857/
cd /d "%~dp0"
python -m http.server 8857
