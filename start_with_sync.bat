@echo off
title FEAAM Priority Sender + Auto-Sync

echo ============================================
echo   FEAAM Priority Sender
echo   Auto-sync: PC -> GitHub -> Render
echo ============================================
echo.

cd /d "%~dp0"
pip install -r requirements.txt -q
pip install watchdog -q

echo Starting app on http://localhost:5055 ...
start "FEAAM App" python app.py

echo.
echo Starting auto-sync watcher...
echo (Any code change will push to GitHub + Render redeploys)
echo.
python auto_sync.py

pause
