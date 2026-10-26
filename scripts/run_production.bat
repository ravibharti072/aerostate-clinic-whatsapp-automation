@echo off
TITLE Aerostate Clinic Backend Service (Production)
cd /d "%~dp0\.."

echo ========================================================
echo  Starting Aerostate Clinic WhatsApp Automation Backend
echo ========================================================

:: Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found in PATH. Please install Python 3.10+ and try again.
    pause
    exit /b 1
)

:: Verify .env existence
if not exist .env (
    echo [WARNING] .env file not found. Creating from .env.example...
    copy .env.example .env
)

:: Perform pre-flight database backup
echo [*] Taking automatic pre-flight database backup...
python backup_db.py

:: Run production uvicorn server bound to localhost (reverse-proxied via Caddy)
echo [*] Launching Uvicorn production server on 127.0.0.1:8000...
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2 --log-level info
