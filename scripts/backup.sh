#!/usr/bin/env bash
# Back up the office SQLite database with `sqlite3 .backup` (safe while the
# server runs in WAL mode) and prune old backups. Research 01 §9.
#
# Environment:
#   OFFICE_DATA_DIR               data directory (default: ./data); DB is <dir>/office.db
#   OFFICE_DB_PATH                explicit database path (overrides OFFICE_DATA_DIR)
#   OFFICE_BACKUP_DIR             where backups go (default: $OFFICE_DATA_DIR/backups)
#   OFFICE_BACKUP_RETENTION_DAYS  delete backups older than this many days (default: 14; 0 keeps all)
#
# Usage: scripts/backup.sh [db-path]
set -euo pipefail

DATA_DIR="${OFFICE_DATA_DIR:-./data}"
DB_PATH="${1:-${OFFICE_DB_PATH:-$DATA_DIR/office.db}}"
BACKUP_DIR="${OFFICE_BACKUP_DIR:-$DATA_DIR/backups}"
RETENTION_DAYS="${OFFICE_BACKUP_RETENTION_DAYS:-14}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "backup: sqlite3 CLI not found on PATH" >&2
  exit 1
fi
if [[ ! -f "$DB_PATH" ]]; then
  echo "backup: database not found: $DB_PATH" >&2
  exit 1
fi
case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "backup: OFFICE_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2; exit 1 ;;
esac

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/office-$STAMP.db"
TMP="$DEST.partial"

# .backup copies a consistent snapshot page by page and honours the busy timeout.
sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$TMP'"
if [[ "$(sqlite3 "$TMP" "PRAGMA integrity_check;")" != "ok" ]]; then
  rm -f "$TMP"
  echo "backup: integrity check failed for $TMP" >&2
  exit 1
fi
mv "$TMP" "$DEST"
echo "backup: wrote $DEST"

if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'office-*.db' -mtime +"$RETENTION_DAYS" -print -delete \
    | sed 's/^/backup: pruned /'
fi
