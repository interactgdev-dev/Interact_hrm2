#!/usr/bin/env bash
# Sync / import 10.40 MySQL-derived data into MongoDB on STAGING 10.6 only.
# NEVER run against 10.98 (production).
#
# Preferred path (10.40 host is decommissioned / unreachable):
#   1) Copy interact_hrm_10.40-mongo-export.zip to 10.6
#   2) bash deploy/sync-40-mongo-export-to-06.sh /path/to/zip
#
# Optional live MySQL path (only if 192.168.10.40:3306 is reachable again):
#   MYSQL_ENV_FILE=.mysql-10.40-sync.env bash deploy/sync-mysql-40-to-mongo-06.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/root/interact-hrm2}"
MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017}"
MONGO_DB="${MONGO_DB:-interact_hrm}"
LOG_DIR="${LOG_DIR:-/root/db-backup}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/sync-40-to-06.log}"
ZIP_OR_DIR="${1:-}"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

log() { echo "[sync-40-06] $(date -Is) $*" | tee -a "$LOG_FILE"; }

if [[ "$(hostname -I 2>/dev/null || true)" == *"192.168.10.98"* ]]; then
  echo "REFUSE: this script must not run on production 10.98" >&2
  exit 1
fi

if ! command -v mongosh >/dev/null 2>&1 && ! command -v mongo >/dev/null 2>&1; then
  log "MongoDB shell not found — install mongod first"
  exit 1
fi

if [[ -n "$ZIP_OR_DIR" ]]; then
  WORK="$(mktemp -d /tmp/mongo40import.XXXXXX)"
  cleanup() { rm -rf "$WORK"; }
  trap cleanup EXIT

  if [[ -f "$ZIP_OR_DIR" ]]; then
    log "Unzipping $ZIP_OR_DIR"
    unzip -qo "$ZIP_OR_DIR" -d "$WORK"
    # zip may contain mongo-export/ or flat json
    if [[ -d "$WORK/mongo-export" ]]; then
      IMPORT_DIR="$WORK/mongo-export"
    else
      IMPORT_DIR="$WORK"
    fi
  elif [[ -d "$ZIP_OR_DIR" ]]; then
    IMPORT_DIR="$ZIP_OR_DIR"
  else
    log "Not a file or directory: $ZIP_OR_DIR"
    exit 1
  fi

  if ! command -v mongoimport >/dev/null 2>&1; then
    log "mongoimport not found — install mongodb-database-tools"
    exit 1
  fi

  log "Importing JSON collections from $IMPORT_DIR → $MONGO_URI /$MONGO_DB"
  count=0
  shopt -s nullglob
  for f in "$IMPORT_DIR"/*.json; do
    base="$(basename "$f")"
    [[ "$base" == "manifest.json" ]] && continue
    col="${base%.json}"
    log "  $col"
    mongoimport --uri="$MONGO_URI" --db="$MONGO_DB" --collection="$col" --file="$f" --drop
    count=$((count + 1))
  done
  log "SUCCESS collections=$count"
  exit 0
fi

# Live MySQL → Mongo (needs scripts/mysql-to-mongodb.mjs + reachable 10.40)
MYSQL_ENV_FILE="${MYSQL_ENV_FILE:-$APP_DIR/.mysql-10.40-sync.env}"
MYSQL_HOST="${MYSQL_HOST:-192.168.10.40}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-hrm_sync}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-interact_hrm}"

if [[ -f "$MYSQL_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$MYSQL_ENV_FILE"
  set +a
  MYSQL_HOST="${DB_HOST:-$MYSQL_HOST}"
  MYSQL_PORT="${DB_PORT:-$MYSQL_PORT}"
  MYSQL_USER="${DB_USER:-$MYSQL_USER}"
  MYSQL_PASSWORD="${DB_PASSWORD:-$MYSQL_PASSWORD}"
  MYSQL_DATABASE="${DB_NAME:-$MYSQL_DATABASE}"
fi

export DB_HOST="$MYSQL_HOST" DB_PORT="$MYSQL_PORT" DB_USER="$MYSQL_USER"
export DB_PASSWORD="$MYSQL_PASSWORD" DB_NAME="$MYSQL_DATABASE"
export MONGO_URI MONGO_DB
# Force TCP (do not use local mysqld socket for remote 10.40)
export MYSQL_FORCE_TCP=1

log "starting live MySQL sync $MYSQL_HOST → local Mongo $MONGO_DB"
if [[ ! -f "$APP_DIR/scripts/mysql-to-mongodb.mjs" ]]; then
  log "missing scripts/mysql-to-mongodb.mjs"
  exit 1
fi
node "$APP_DIR/scripts/mysql-to-mongodb.mjs" --replace 2>&1 | tee -a "$LOG_FILE"
log "SUCCESS live sync"
