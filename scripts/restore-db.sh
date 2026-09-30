#!/usr/bin/env bash
# Put a backup made by scripts/backup.sh in place of the office SQLite database (#203).
# The office must be stopped: a running server keeps the old database open. On a Compose install
# use scripts/restore.sh, which stops the office, runs this in the `backup` service and restarts.
# The current database is kept next to it as office.db.before-restore-<time>.
#
# Environment:
#   OFFICE_DATA_DIR  data directory (default: ./data); DB is <dir>/office.db
#   OFFICE_DB_PATH   explicit database path (overrides OFFICE_DATA_DIR)
#
# Usage: scripts/restore-db.sh <backup.db>
set -euo pipefail
umask 077

DATA_DIR="${OFFICE_DATA_DIR:-./data}"
DB_PATH="${OFFICE_DB_PATH:-$DATA_DIR/office.db}"

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <backup.db>" >&2
  exit 2
fi
SRC="$1"
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "restore: sqlite3 CLI not found on PATH" >&2
  exit 1
fi
[[ -f "$SRC" ]] || { echo "restore: backup not found: $SRC" >&2; exit 1; }
[[ -r "$SRC" ]] || { echo "restore: cannot read $SRC as uid $(id -u); make it readable for that user" >&2; exit 1; }
# immutable=1: read the file as is, without creating -wal/-shm files (the source may be read-only).
if [[ "$SRC" == *[?#%]* ]]; then echo "restore: rename $SRC without ? # or %" >&2; exit 1; fi
if [[ "$(sqlite3 "file:$SRC?immutable=1" "PRAGMA integrity_check;" 2>&1)" != "ok" ]]; then
  echo "restore: $SRC fails the integrity check; pick another backup" >&2
  exit 1
fi
mkdir -p "$(dirname "$DB_PATH")"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
if [[ -f "$DB_PATH" ]]; then
  for suffix in "" -wal -shm; do
    if [[ -e "$DB_PATH$suffix" ]]; then
      mv "$DB_PATH$suffix" "$DB_PATH.before-restore-$STAMP$suffix"
    fi
  done
  echo "restore: kept the previous database as $DB_PATH.before-restore-$STAMP"
fi
cp "$SRC" "$DB_PATH.partial"
mv "$DB_PATH.partial" "$DB_PATH"
echo "restore: restored $SRC to $DB_PATH"
