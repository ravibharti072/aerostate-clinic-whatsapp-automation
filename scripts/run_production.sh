#!/usr/bin/env bash
# ========================================================
# Aerostate Clinic Production Runner (Linux / macOS)
# ========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

echo "========================================================"
echo " Starting Aerostate Clinic Backend Service (Production)"
echo "========================================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "[WARNING] .env file not found. Copying from .env.example..."
    cp .env.example .env
    echo "[IMPORTANT] Please edit .env with your production credentials before continuing."
fi

# Activate virtual environment if present
if [ -d ".venv" ]; then
    echo "[*] Activating virtual environment (.venv)..."
    source .venv/bin/activate
elif [ -d "venv" ]; then
    echo "[*] Activating virtual environment (venv)..."
    source venv/bin/activate
fi

# Run pre-flight database backup
echo "[*] Performing pre-flight database backup..."
python backup_db.py

# Launch Uvicorn with multi-worker support
PORT=${PORT:-8000}
WORKERS=${WORKERS:-2}
echo "[*] Launching Uvicorn on 127.0.0.1:${PORT} with ${WORKERS} workers..."
exec python -m uvicorn main:app --host 127.0.0.1 --port "$PORT" --workers "$WORKERS" --log-level info
