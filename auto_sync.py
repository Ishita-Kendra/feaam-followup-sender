"""
FEAAM Auto-Sync
===============
Watches the app folder for any code changes.
When a change is detected:
  1. Waits 8 seconds (debounce — lets you finish editing)
  2. git add + commit + push  →  GitHub
  3. Render auto-deploys from GitHub automatically

Run this alongside the app:  python auto_sync.py
Or use start_with_sync.bat to launch both at once.

Ignores: __pycache__, .git, *.pyc, settings.json, sent_log.json,
         library/ folder (file uploads don't need redeployment)
"""

import os, sys, time, subprocess, threading
from pathlib import Path
from datetime import datetime

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("[auto-sync] Installing watchdog...")
    subprocess.run([sys.executable, "-m", "pip", "install", "watchdog", "-q"])
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

# ── Config ────────────────────────────────────────────────────────────────────
WATCH_DIR   = Path(__file__).parent
DEBOUNCE_S  = 8          # seconds to wait after last change before pushing
LOG_PREFIX  = "[auto-sync]"

# Files/dirs to ignore (changes here don't trigger a push)
IGNORE_DIRS  = {".git", "__pycache__", "library", "uploads"}
IGNORE_FILES = {"settings.json", "sent_log.json", "auto_sync.py", ".gitignore"}
IGNORE_EXTS  = {".pyc", ".pyo", ".log", ".tmp"}

# ── State ─────────────────────────────────────────────────────────────────────
_pending_timer  = None
_pending_files  = set()
_lock           = threading.Lock()
_last_push_hash = None


def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{ts} {LOG_PREFIX} {msg}", flush=True)


def get_current_hash():
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"],
                           capture_output=True, text=True, cwd=WATCH_DIR)
        return r.stdout.strip()
    except Exception:
        return None


def git_push(changed_files):
    global _last_push_hash

    log(f"Changes detected in: {', '.join(sorted(changed_files))}")
    log("Running git add / commit / push…")

    try:
        # Stage everything (respects .gitignore)
        subprocess.run(["git", "add", "-A"], cwd=WATCH_DIR, check=True)

        # Check if there's actually anything to commit
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True, text=True, cwd=WATCH_DIR
        )
        if not status.stdout.strip():
            log("Nothing new to commit — already up to date.")
            return

        # Build commit message
        ts  = datetime.now().strftime("%Y-%m-%d %H:%M")
        msg = f"Auto-sync {ts}\n\nChanged: {', '.join(sorted(changed_files))}"
        subprocess.run(["git", "commit", "-m", msg], cwd=WATCH_DIR, check=True)

        # Push to GitHub
        result = subprocess.run(
            ["git", "push"], cwd=WATCH_DIR,
            capture_output=True, text=True
        )
        if result.returncode == 0:
            new_hash = get_current_hash()
            _last_push_hash = new_hash
            log(f"✓ Pushed to GitHub  →  Render will redeploy automatically")
            log(f"  Commit: {new_hash[:8] if new_hash else '?'}")
        else:
            log(f"✗ Push failed: {result.stderr.strip()}")

    except subprocess.CalledProcessError as e:
        log(f"✗ Git error: {e}")
    except Exception as e:
        log(f"✗ Unexpected error: {e}")


def schedule_push(filepath):
    global _pending_timer, _pending_files

    with _lock:
        _pending_files.add(filepath)

        # Cancel existing timer and restart
        if _pending_timer and _pending_timer.is_alive():
            _pending_timer.cancel()

        files_snapshot = set(_pending_files)

        def do_push():
            with _lock:
                _pending_files.clear()
            git_push(files_snapshot)

        _pending_timer = threading.Timer(DEBOUNCE_S, do_push)
        _pending_timer.daemon = True
        _pending_timer.start()
        log(f"  → Queued (pushing in {DEBOUNCE_S}s unless more changes come)…")


def should_ignore(path):
    p = Path(path)
    # Ignore specific files
    if p.name in IGNORE_FILES:
        return True
    # Ignore extensions
    if p.suffix.lower() in IGNORE_EXTS:
        return True
    # Ignore specific dirs anywhere in the path
    parts = set(p.parts)
    if parts & IGNORE_DIRS:
        return True
    return False


class ChangeHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if not event.is_directory and not should_ignore(event.src_path):
            rel = os.path.relpath(event.src_path, WATCH_DIR)
            schedule_push(rel)

    def on_created(self, event):
        if not event.is_directory and not should_ignore(event.src_path):
            rel = os.path.relpath(event.src_path, WATCH_DIR)
            schedule_push(rel)

    def on_deleted(self, event):
        if not event.is_directory and not should_ignore(event.src_path):
            rel = os.path.relpath(event.src_path, WATCH_DIR)
            schedule_push(rel)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log(f"Watching: {WATCH_DIR}")
    log(f"Debounce: {DEBOUNCE_S} seconds")
    log(f"Any code change → GitHub push → Render auto-redeploys")
    log("Press Ctrl+C to stop.\n")

    observer = Observer()
    observer.schedule(ChangeHandler(), str(WATCH_DIR), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log("Stopping…")
        observer.stop()
    observer.join()
