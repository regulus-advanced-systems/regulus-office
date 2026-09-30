#!/usr/bin/env bash
# Restore the office database from a backup on a Compose install (#203). Run on the host from
# anywhere in the checkout. Without an argument it lists the backups.
#
#   scripts/restore.sh                             list backups (newest last)
#   scripts/restore.sh office-20261001-030000.db   restore one from the backup directory
#   scripts/restore.sh /path/to/office-….db        restore a copy from elsewhere (readable by uid 1000)
#   scripts/restore.sh -y <backup>                 without asking
#
# It stops `office` and `backup`, puts the backup in place with scripts/restore-db.sh inside the
# `backup` service (as the office's user, uid 1000; the current database is kept in the volume as
# office.db.before-restore-<time>), then starts the stack again. Runners and robots keep running.
# Same as, by hand, from deploy/:
#   docker compose stop office backup
#   docker compose run --rm --no-deps backup scripts/restore-db.sh /backups/<name>
#   docker compose up -d --wait
#
# Environment: COMPOSE_PROJECT_NAME (default: deploy), as for docker compose itself.
set -euo pipefail

YES=0 NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y | --yes) YES=1; shift ;;
    -h | --help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) [[ -z "$NAME" ]] || { echo "one backup at a time" >&2; exit 2; }; NAME="$1"; shift ;;
  esac
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"
[[ -f "$DEPLOY/docker-compose.yml" ]] || { echo "run this from a Regulus Office checkout" >&2; exit 1; }

cd "$DEPLOY"
project="${COMPOSE_PROJECT_NAME:-deploy}"
# The backup directory belongs to uid 1000 with mode 700, so this user may not be able to read it:
# list and read it inside the `backup` service, which mounts it at /backups.
in_backup() { docker compose run --rm --no-deps -T "$@"; }

if [[ -z "$NAME" ]]; then
  echo "Backups of Compose project '$project' (UTC timestamps, newest last):"
  in_backup backup find /backups -maxdepth 1 -type f -name 'office-*.db' -printf '  %f  %s bytes\n' | sort
  echo "Restore one with: scripts/restore.sh <name>"
  exit 0
fi

mount=() target=""
if [[ "$NAME" == */* ]]; then
  # A path on this host, e.g. a copy brought back from off-site storage; readable by uid 1000.
  [[ -f "$NAME" ]] || { echo "restore: no such file: $NAME" >&2; exit 1; }
  src="$(cd "$(dirname "$NAME")" && pwd)/$(basename "$NAME")"
  [[ "$src" != *:* ]] || { echo "restore: the path must not contain ':' ($src)" >&2; exit 1; }
  mount=(-v "$src:/restore/office.db:ro") target=/restore/office.db
else
  [[ "$NAME" =~ ^office-[0-9]{8}-[0-9]{6}\.db$ ]] ||
    { echo "restore: '$NAME' is not a backup name (office-YYYYMMDD-HHMMSS.db); run scripts/restore.sh to list them" >&2; exit 1; }
  src="$NAME (in the backup directory)" target="/backups/$NAME"
  in_backup backup test -f "$target" ||
    { echo "restore: no backup named $NAME; run scripts/restore.sh to list them" >&2; exit 1; }
fi

echo "This replaces the office database of Compose project '$project' with"
echo "  $src"
echo "The office stops for a few seconds; the current database is kept as office.db.before-restore-<time>."
if [[ $YES -eq 0 ]]; then
  [[ -t 0 ]] || { echo "restore: not a terminal; pass -y to confirm" >&2; exit 1; }
  read -r -p "Continue? [y/N]: " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]] || { echo "Nothing changed."; exit 1; }
fi

docker compose stop office backup
if ! in_backup "${mount[@]}" backup scripts/restore-db.sh "$target"; then
  echo "restore failed; starting the office again with its previous database" >&2
  docker compose up -d --wait --no-build
  exit 1
fi
docker compose up -d --wait --no-build
echo "Restored. The office is back up."
