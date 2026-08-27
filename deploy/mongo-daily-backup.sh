#!/usr/bin/env bash
# Full MongoDB dump for Interact HRM (10.98 test).
# Cron: Tue–Sat 09:00 Asia/Karachi → /home/hrm/db-backup/
# Matches 10.40 MySQL backup schedule (0 9 * * 2-6).
set -euo pipefail

APP_DIR="${APP_DIR:-/home/hrm/interact-hrm2.0}"
BACKUP_DIR="${BACKUP_DIR:-/home/hrm/db-backup}"
ENV_FILE="${ENV_FILE:-}"
LOG_FILE="${LOG_FILE:-$BACKUP_DIR/backup.log}"

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "$APP_DIR/.env.local" ]]; then
    ENV_FILE="$APP_DIR/.env.local"
  else
    ENV_FILE="$APP_DIR/.env"
  fi
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

ts="$(date '+%Y-%m-%d_%H-%M-%S')"
stamp_day="$(date '+%Y-%m-%d')"
out_archive="$BACKUP_DIR/interact_hrm_${ts}.archive.gz"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $*" | tee -a "$LOG_FILE"
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

if ! command -v mongodump >/dev/null 2>&1; then
  log "ERROR: mongodump not found"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  log "ERROR: python3 not found (needed to parse MONGO_URI safely)"
  exit 1
fi

log "Starting full mongodump → ${out_archive}"

# mongodump's --uri auth can fail with URL-encoded passwords; parse once and
# dump with discrete flags + authSource=admin (matches 10.98 hrm user).
# Never print credentials.
export BACKUP_ENV_FILE="$ENV_FILE"
export BACKUP_OUT_ARCHIVE="$out_archive"
python3 <<'PY'
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

env_file = Path(os.environ["BACKUP_ENV_FILE"])
out = os.environ["BACKUP_OUT_ARCHIVE"]
uri = db = None
for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.strip().strip('"').strip("'")
    if k == "MONGO_URI":
        uri = v
    elif k == "MONGO_DB":
        db = v
    elif k == "DB_NAME" and not db:
        db = v

db = db or "interact_hrm"
if not uri:
    print("ERROR: MONGO_URI missing in env", file=sys.stderr)
    sys.exit(1)

parsed = urlparse(uri)
user = unquote(parsed.username or "")
password = unquote(parsed.password or "")
host = parsed.hostname or "127.0.0.1"
port = str(parsed.port or 27017)
if not user:
    print("ERROR: MONGO_URI has no username", file=sys.stderr)
    sys.exit(1)

cmd = [
    "mongodump",
    f"--host={host}:{port}",
    f"--username={user}",
    f"--password={password}",
    "--authenticationDatabase=admin",
    f"--db={db}",
    f"--archive={out}",
    "--gzip",
]
# Hide mongodump stdout/stderr noise that may echo connection strings.
proc = subprocess.run(cmd, capture_output=True, text=True)
if proc.returncode != 0:
    msg = (proc.stderr or proc.stdout or "mongodump failed").strip()
    for secret in (password, uri, user):
        if secret:
            msg = msg.replace(secret, "***")
    print(f"ERROR: mongodump failed: {msg[:300]}", file=sys.stderr)
    sys.exit(proc.returncode)
print(f"db={db} host={host}:{port} user={user}")
PY

chmod 600 "$out_archive"
size="$(du -h "$out_archive" | awk '{print $1}')"
log "OK: $out_archive ($size)"

echo "$stamp_day $ts $out_archive $size" > "$BACKUP_DIR/LAST_SUCCESS.txt"

# Do not delete old dumps — retain all backups on disk (same as 10.40).

log "Done."
exit 0
