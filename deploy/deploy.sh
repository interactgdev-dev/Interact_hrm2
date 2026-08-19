#!/usr/bin/env bash
#
# Interact HRM — auto-deploy (pull + conditional install + build + restart)
#
# Runs on each Ubuntu server via cron every minute. Because the servers sit on
# private IPs (10.6.x.x staging, 10.40.x.x production) GitHub cannot reach them
# with webhooks/Actions, so the server PULLS from GitHub instead.
#
# Per-server config (edit these on each box, or export before calling):
#   APP_DIR   – absolute path to the checkout
#   REMOTE    – git remote for this environment
#               staging     -> waqas         (waqasahmad18/Interact_hrm.git)
#               production  -> interactgdev  (interactgdev-dev/Interact_hrm2.git)
#   BRANCH    – deploy branch (main)
#   PM2_NAME  – pm2 process name
#
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/interact-hrm}"
REMOTE="${REMOTE:-waqas}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-interact-hrm}"

LOCK_FILE="/tmp/interact-hrm-deploy.lock"
LOG_FILE="${APP_DIR}/deploy/deploy.log"

# Prevent overlapping runs when a build takes longer than the cron interval.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG_FILE"; }

cd "$APP_DIR"

git fetch "$REMOTE" "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "${REMOTE}/${BRANCH}")"

# Nothing new — exit quietly (keeps logs clean on every-minute cron).
if [ "$LOCAL" = "$REMOTE_HEAD" ]; then
  exit 0
fi

log "New commit detected: ${LOCAL:0:7} -> ${REMOTE_HEAD:0:7}. Deploying…"

# Remember lockfile state so we only reinstall deps when they actually change.
LOCK_BEFORE="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}' || echo none)"

git reset --hard "${REMOTE}/${BRANCH}" >>"$LOG_FILE" 2>&1

LOCK_AFTER="$(md5sum package-lock.json 2>/dev/null | awk '{print $1}' || echo none)"

if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "Dependencies changed — running npm ci."
  npm ci >>"$LOG_FILE" 2>&1
else
  log "Dependencies unchanged — skipping install."
fi

# Mongo (10.98) has no MySQL schema_migrations — skip SQL runner there.
DRIVER="$(
  grep -E '^DB_DRIVER=' "$APP_DIR/.env.local" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true
)"
if [ "${DRIVER}" = "mongo" ] || [ "${DB_DRIVER:-}" = "mongo" ]; then
  log "Skipping SQL migrations (DB_DRIVER=mongo)."
else
  log "Running DB migrations…"
  node "$APP_DIR/scripts/run-migrations.mjs" >>"$LOG_FILE" 2>&1
fi

log "Building…"
npm run build >>"$LOG_FILE" 2>&1

# Restart via PM2 (start on first run if not already registered).
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >>"$LOG_FILE" 2>&1
else
  pm2 start npm --name "$PM2_NAME" -- start >>"$LOG_FILE" 2>&1
  pm2 save >>"$LOG_FILE" 2>&1
fi

log "Deploy complete at ${REMOTE_HEAD:0:7}."
