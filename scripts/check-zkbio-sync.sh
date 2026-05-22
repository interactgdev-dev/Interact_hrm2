#!/usr/bin/env bash
# Quick ZKBio sync diagnostics on Ubuntu/Linux (run from repo root).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/scripts/zkbio-sync.local.env"

echo "=== ZKBio sync diagnostics ==="
echo "Repo: $ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "MISSING: $ENV_FILE"
  echo "Copy scripts/zkbio-sync.env.example -> scripts/zkbio-sync.local.env"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
set +a

BASE="${ZKBIO_BASE:-https://192.168.10.29:8098}"
echo ""
echo "1) Reach ZKBio ($BASE)"
if curl -k -sS --connect-timeout 5 -o /dev/null -w "HTTP %{http_code}\n" "$BASE/" 2>/dev/null; then
  echo "   OK — server can reach ZKBio host"
else
  echo "   FAIL — Ubuntu often cannot reach 192.168.x.x unless on same LAN/VPN"
  echo "   Fix: run sync on office network, VPN, or tunnel to ZKBio"
fi

echo ""
echo "2) Python deps"
if python3 -c "import requests, mysql.connector" 2>/dev/null; then
  echo "   OK — requests + mysql-connector-python"
else
  echo "   FAIL — run: pip3 install requests mysql-connector-python"
fi

echo ""
echo "3) DB MAX(event_time) (incremental window start)"
export ROOT
python3 <<'PY'
import os
from pathlib import Path

def load_env():
    p = Path(os.environ.get("ROOT", ".")) / "scripts" / "zkbio-sync.local.env"
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and (k not in os.environ or not str(os.environ.get(k, "")).strip()):
            os.environ[k] = v

load_env()
import mysql.connector
cfg = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "interact_hrm"),
}
sock = os.environ.get("DB_SOCKET_PATH", "").strip()
if sock:
    cfg = {"unix_socket": sock, "user": cfg["user"], "password": cfg["password"], "database": cfg["database"]}
conn = mysql.connector.connect(**cfg)
cur = conn.cursor()
cur.execute("SELECT COUNT(*), MAX(event_time) FROM zkbio_punch_log")
n, mx = cur.fetchone()
print(f"   rows={n}  MAX(event_time)={mx}")
cur.close()
conn.close()
PY

echo ""
echo "4) Manual sync (debug)"
echo "   cd $ROOT && ZKBIO_DEBUG=1 python3 scripts/zkbio_sync_punches.py"
echo "   Read: Fetched N row(s) vs inserted M new — and any Hint lines"
