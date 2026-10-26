"""
Aerostate Clinic Database Backup Utility
Performs online, lock-free, atomic snapshots of the live SQLite database
and rotates older backup archives.
Usage:
    python backup_db.py
"""

import os
import sys
import sqlite3
import datetime
from pathlib import Path


def perform_database_backup(
    db_path: str = "clinic.db",
    backup_dir: str = "backups",
    max_backups: int = 14,
) -> dict:
    source_path = Path(db_path).resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Database file not found at {source_path}")

    destination_dir = Path(backup_dir).resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"clinic_backup_{timestamp}.sqlite3"
    target_path = destination_dir / backup_filename

    # Perform online atomic backup (safe even during live concurrent writes)
    src_conn = sqlite3.connect(str(source_path))
    dst_conn = sqlite3.connect(str(target_path))

    try:
        src_conn.backup(dst_conn, pages=100)
    finally:
        dst_conn.close()
        src_conn.close()

    # Verify backup integrity
    verify_conn = sqlite3.connect(str(target_path))
    try:
        cursor = verify_conn.cursor()
        cursor.execute("PRAGMA integrity_check;")
        check_result = cursor.fetchone()
        if not check_result or check_result[0] != "ok":
            raise RuntimeError(f"Backup verification failed: {check_result}")
    finally:
        verify_conn.close()

    # Clean up / rotate older backups exceeding max_backups
    all_backups = sorted(
        destination_dir.glob("clinic_backup_*.sqlite3"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    removed_count = 0
    if len(all_backups) > max_backups:
        for old_backup in all_backups[max_backups:]:
            try:
                old_backup.unlink()
                removed_count += 1
            except Exception:
                pass

    size_kb = round(target_path.stat().st_size / 1024, 2)
    return {
        "status": "success",
        "backup_file": str(target_path),
        "filename": backup_filename,
        "size_kb": size_kb,
        "timestamp": timestamp,
        "total_backups_retained": len(list(destination_dir.glob("clinic_backup_*.sqlite3"))),
        "pruned_old_backups": removed_count,
    }


if __name__ == "__main__":
    print("--- Starting Aerostate Clinic Live Database Backup ---")
    try:
        result = perform_database_backup()
        print(f"[OK] Backup created successfully: {result['filename']}")
        print(f"     Path: {result['backup_file']}")
        print(f"     Size: {result['size_kb']} KB")
        print(f"     Total backups stored: {result['total_backups_retained']} (Pruned: {result['pruned_old_backups']})")
    except Exception as e:
        print(f"[ERROR] Database backup failed: {e}")
        sys.exit(1)
