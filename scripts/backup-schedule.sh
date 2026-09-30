#!/usr/bin/env bash
# Nightly backups for the Compose `backup` service (#203): a sleep loop around scripts/backup.sh,
# so no cron daemon, systemd timer or Docker socket is needed. The service writes to a host
# directory (deploy/backups by default), off the office-data volume it protects.
#
# Environment:
#   OFFICE_BACKUP_DIR             where backups go (Compose: /backups, the host bind mount)
#   OFFICE_BACKUP_TIME            daily run time, HH:MM in UTC (default 03:00)
#   OFFICE_BACKUP_RETENTION_DAYS  passed to backup.sh (default 14; 0 keeps all)
#   OFFICE_BACKUP_MAX_AGE_HOURS   `check` fails when the newest backup is older (default 26)
#
# Usage:
#   scripts/backup-schedule.sh          loop: back up now unless a backup from the last 24 hours
#                                       exists, then every day at OFFICE_BACKUP_TIME
#   scripts/backup-schedule.sh check    health check: a backup newer than OFFICE_BACKUP_MAX_AGE_HOURS
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${OFFICE_BACKUP_DIR:-${OFFICE_DATA_DIR:-./data}/backups}"
AT="${OFFICE_BACKUP_TIME:-03:00}"
MAX_AGE_HOURS="${OFFICE_BACKUP_MAX_AGE_HOURS:-26}"

log() { printf '%s backup-schedule: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# An office-*.db modified within the last <minutes>, if any.
recent_backup() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'office-*.db' -mmin "-$1" -print -quit 2>/dev/null
}

if [[ "${1:-}" == check ]]; then
  [[ "$MAX_AGE_HOURS" =~ ^[0-9]+$ ]] || { echo "OFFICE_BACKUP_MAX_AGE_HOURS must be a whole number" >&2; exit 1; }
  if [[ -z "$(recent_backup $((MAX_AGE_HOURS * 60)))" ]]; then
    echo "no backup in $BACKUP_DIR from the last $MAX_AGE_HOURS hours" >&2
    exit 1
  fi
  exit 0
fi
[[ $# -eq 0 ]] || { echo "usage: $0 [check]" >&2; exit 2; }

[[ "$AT" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || { log "OFFICE_BACKUP_TIME must be HH:MM (UTC), got '$AT'"; exit 1; }
if [[ ! -d "$BACKUP_DIR" || ! -w "$BACKUP_DIR" ]]; then
  log "cannot write to $BACKUP_DIR as uid $(id -u); on the host: install -d -m 700 -o $(id -u) -g $(id -g) <backup dir> (scripts/setup.sh does this)"
  exit 1
fi

backup() { "$HERE/backup.sh" || log "backup failed; retrying at the next scheduled time"; }

# `sleep` runs in the background so SIGTERM from `docker compose stop` ends the loop at once.
trap 'log "stopping"; exit 0' TERM INT
log "backing up to $BACKUP_DIR daily at $AT UTC, keeping ${OFFICE_BACKUP_RETENTION_DAYS:-14} days"
if [[ -z "$(recent_backup $((24 * 60)))" ]]; then backup; fi
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today $AT" +%s)
  [[ $next -gt $now ]] || next=$(date -u -d "tomorrow $AT" +%s)
  log "next backup at $(date -u -d "@$next" +%Y-%m-%dT%H:%MZ)"
  sleep $((next - now)) &
  wait $! || true
  backup
done
