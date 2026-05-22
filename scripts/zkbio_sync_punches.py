#!/usr/bin/env python3
"""
ZKBio CVAccess — pull All Transactions (jqGrid / dhtmlx) and INSERT into MySQL.

Deduplication: MySQL UNIQUE on log_id (device row) + (pin, event_time) fallback; INSERT IGNORE — same punch not stored twice.

Default window (no --start/--end):
  - Never ask the machine before 1 March (see default_sync_since_march_floor) or ZKBIO_SYNC_SINCE env.
  - Start = max(that floor, latest event_time in DB minus overlap). End = now.

Manual range:  --start / --end  (start is clamped to ZKBIO_SYNC_SINCE unless ZKBIO_ALLOW_BEFORE_SYNC_SINCE=1).

Setup:
  pip install requests mysql-connector-python
  Copy scripts/zkbio-sync.env.example → scripts/zkbio-sync.local.env

Run:
  powershell -ExecutionPolicy Bypass -File scripts/run-zkbio-sync.ps1
  python scripts/zkbio_sync_punches.py --start "2026-03-24 00:00:00" --end "2026-03-24 23:59:59"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlparse


_ZKBIO_ENV_PATH: Optional[Path] = None


def _env_bool(key: str, default: bool = True) -> bool:
    v = os.environ.get(key, "").strip().lower()
    if not v:
        return default
    return v not in ("0", "false", "no")


def _load_zkbio_env_file() -> None:
    """Load scripts/zkbio-sync.local.env into os.environ (only keys not already set)."""
    global _ZKBIO_ENV_PATH
    here = Path(__file__).resolve().parent
    root = here.parent
    for path in (here / "zkbio-sync.local.env", root / "zkbio-sync.local.env"):
        if not path.is_file():
            continue
        _ZKBIO_ENV_PATH = path
        try:
            raw = path.read_text(encoding="utf-8-sig")
        except OSError:
            continue
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if not key:
                continue
            existing = os.environ.get(key)
            # Next.js/PM2 may inject empty ZKBIO_/DB_ vars; local file should still win.
            if existing is None or (
                not str(existing).strip() and key.startswith(("ZKBIO_", "DB_"))
            ):
                os.environ[key] = val
        break


_load_zkbio_env_file()

try:
    import requests
except ImportError:
    print("Install: pip install requests mysql-connector-python", file=sys.stderr)
    raise

try:
    import mysql.connector
except ImportError:
    print("Install: pip install mysql-connector-python", file=sys.stderr)
    raise

START_PARAM = os.environ.get("ZKBIO_START_PARAM", "startTime")
END_PARAM = os.environ.get("ZKBIO_END_PARAM", "endTime")
PAGE_PARAM = os.environ.get("ZKBIO_PAGE_PARAM", "page")
ROWS_PARAM = os.environ.get("ZKBIO_ROWS_PARAM", "rows")
POS_START_PARAM = os.environ.get("ZKBIO_POS_START_PARAM", "posStart")
COUNT_PARAM = os.environ.get("ZKBIO_COUNT_PARAM", "count")
PAGE_SIZE = int(os.environ.get("ZKBIO_PAGE_SIZE", "200"))
PAGINATION_STYLE = os.environ.get("ZKBIO_PAGINATION", "jqgrid").strip().lower()

def default_sync_since_march_floor() -> datetime:
    """
    Earliest window start when ZKBIO_SYNC_SINCE is not set:
    1 March of the active year — March–December → this year's 1 Mar; Jan–Feb → previous year's 1 Mar.
    So we never ask the machine for data before "this March season"; after that, incremental uses DB MAX(event_time).
    """
    now = datetime.now()
    if now.month >= 3:
        return datetime(now.year, 3, 1, 0, 0, 0)
    return datetime(now.year - 1, 3, 1, 0, 0, 0)


def parse_dt(v: Any) -> Optional[datetime]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(float(v))
        except (OSError, OverflowError, ValueError):
            pass
    s = str(v).strip()
    if not s:
        return None
    if "T" in s and len(s) >= 10:
        s2 = s.replace("Z", "+00:00") if s.endswith("Z") else s
        try:
            d = datetime.fromisoformat(s2)
            if d.tzinfo is not None:
                d = d.astimezone(timezone.utc).replace(tzinfo=None)
            return d
        except ValueError:
            pass
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%d-%m-%Y %H:%M:%S",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d-%m-%Y %H:%M",
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def normalize_pin(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def row_from_grid_cells(c: list, row_id: Any = None) -> Dict[str, Any]:
    rid = row_id if row_id is not None else (c[0] if len(c) > 0 else "")
    return {
        "logId": str(rid or ""),
        "eventTime": c[1] if len(c) > 1 else None,
        "areaName": c[2] if len(c) > 2 else None,
        "devAlias": c[3] if len(c) > 3 else None,
        "eventPointName": c[4] if len(c) > 4 else None,
        "eventName": c[5] if len(c) > 5 else None,
        "pin": c[8] if len(c) > 8 else None,
        "name": c[9] if len(c) > 9 else None,
        "lastName": c[10] if len(c) > 10 else None,
        "cardNo": c[11] if len(c) > 11 else None,
        "deptCode": c[12] if len(c) > 12 else None,
        "deptName": c[13] if len(c) > 13 else None,
        "readerName": c[14] if len(c) > 14 else None,
        "verifyModeName": c[15] if len(c) > 15 else None,
    }


def normalize_rows(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw: Any = data.get("rows")
    if raw is None:
        raw = data.get("list")
    if raw is None and isinstance(data.get("data"), list):
        raw = data["data"]
    if raw is None and isinstance(data.get("data"), dict):
        inner = data["data"]
        raw = inner.get("rows") or inner.get("data") or inner.get("list")
    if raw is None and isinstance(data.get("result"), dict):
        inner = data["result"]
        raw = inner.get("rows") or inner.get("data") or inner.get("list")
    if raw is None:
        for key in ("datas", "gridData"):
            v = data.get(key)
            if isinstance(v, list):
                raw = v
                break
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raw = []
    out: List[Dict[str, Any]] = []
    for r in raw:
        if isinstance(r, dict) and "cell" in r and isinstance(r["cell"], list):
            c = r["cell"]
            row = row_from_grid_cells(c, r.get("id"))
            out.append(row)
        elif isinstance(r, dict) and "data" in r and isinstance(r["data"], list):
            c = r["data"]
            row = row_from_grid_cells(c, r.get("id"))
            out.append(row)
        elif isinstance(r, dict):
            out.append(r)
    return out


def merge_extra_form(params: Dict[str, Any], extra: str) -> None:
    if not (extra or "").strip():
        return
    for k, v in parse_qsl(extra.strip(), keep_blank_values=True):
        params[k] = v


def _parse_json_response(resp: Any) -> Optional[Dict[str, Any]]:
    text = resp.text or ""
    try:
        out = resp.json()
        return _coerce_json_to_grid_dict(out)
    except json.JSONDecodeError:
        pass
    t = text.lstrip()
    if t.startswith("{") or t.startswith("["):
        try:
            out = json.loads(text)
            return _coerce_json_to_grid_dict(out)
        except json.JSONDecodeError:
            return None
    return None


def _coerce_json_to_grid_dict(out: Any) -> Optional[Dict[str, Any]]:
    """ZKBio may return a jqGrid object, a bare array of rows, or a wrapper. Always normalize to dict."""
    if isinstance(out, dict):
        return out
    if isinstance(out, list):
        return {"rows": out}
    return None


def _url_append_list_query(url: str) -> str:
    p = urlparse(url)
    q = p.query or ""
    keys = [x.split("=", 1)[0].strip().lower() for x in q.split("&") if x.strip()]
    if "list" in keys or q.strip().lower() == "list":
        return url
    sep = "&" if q else "?"
    return f"{url}{sep}list"


def fetch_grid_json(
    session_req: Any,
    list_url: str,
    params: Dict[str, Any],
    http_method: str,
    verify_ssl: bool,
) -> Optional[Dict[str, Any]]:
    parsed = urlparse(list_url)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    post_urls = [list_url, _url_append_list_query(list_url)]
    if post_urls[1] == post_urls[0]:
        post_urls = [list_url]

    errors: List[str] = []
    last_json: Optional[Dict[str, Any]] = None

    def try_req(method: str, url: str) -> Optional[Dict[str, Any]]:
        try:
            if method == "post":
                r = session_req.post(url, data=params, timeout=120, verify=verify_ssl)
            else:
                r = session_req.get(url, params=params, timeout=120, verify=verify_ssl)
        except requests.RequestException as e:
            errors.append(f"{method.upper()} {url}: {e}")
            return None
        # Some ZKBio builds return 201 Created instead of 200 for JSON grid responses.
        if r.status_code < 200 or r.status_code >= 300:
            errors.append(f"{method.upper()} {url}: HTTP {r.status_code}")
            return None
        data = _parse_json_response(r)
        if data is not None:
            nonlocal last_json
            last_json = data
            if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
                keys = list(data.keys())
                pkeys = sorted(list(params.keys()))
                brief = {k: params.get(k) for k in pkeys if k in (START_PARAM, END_PARAM, PAGE_PARAM, ROWS_PARAM, POS_START_PARAM, COUNT_PARAM, "pageSize", "rows", "page", "posStart", "count")}
                try:
                    tc = int(data.get("total_count") or 0)
                except (TypeError, ValueError):
                    tc = None
                try:
                    rl = len(data.get("rows") or [])
                except TypeError:
                    rl = None
                print(
                    f"ZKBio debug: {method.upper()} {url} HTTP {r.status_code} keys={keys} total_count={tc} rows_len={rl} params_brief={brief}",
                    file=sys.stderr,
                )
            return data
        ct = r.headers.get("Content-Type", "")
        snip = (r.text or "")[:180].replace("\n", " ")
        errors.append(f"{method.upper()} {url}: not JSON ({ct}) {snip!r}")
        return None

    if http_method == "post":
        for u in post_urls:
            d = try_req("post", u)
            if d is not None:
                return d
        if origin and "accTransaction" in (parsed.path or ""):
            get_u = f"{origin}/accTransaction.do?list"
            d = try_req("get", get_u)
            if d is not None:
                return d
    else:
        for u in post_urls:
            d = try_req("get", u)
            if d is not None:
                return d

    # If we got a JSON wrapper like {timestamp,status,error,message,path}, return it to caller
    # so caller can decide whether to auto-login and retry.
    if last_json is not None:
        return last_json

    print("ZKBio: could not get JSON. Attempts:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    print(
        "\nFix: DevTools → accTransaction (dhx/json wali) → Payload → saari fields "
        "ZKBIO_EXTRA_FORM mein (key=value&...). Ya ZKBIO_LIST_PATH=accTransaction.do?list set karo.",
        file=sys.stderr,
    )
    return None


def looks_like_auth_wrapper(data: Dict[str, Any]) -> bool:
    """Detects the Spring-style wrapper returned when session is invalid/expired."""
    keys = set(data.keys())
    if {"timestamp", "status", "error", "path"}.issubset(keys):
        return True
    # Sometimes it returns only status/message/path
    if "status" in data and "path" in data and "rows" not in data:
        return True
    return False


def persist_zkbio_session(session_value: str) -> None:
    """Write refreshed SESSION back to zkbio-sync.local.env (gitignored)."""
    session_value = (session_value or "").strip()
    if not session_value:
        return
    os.environ["ZKBIO_SESSION"] = session_value
    if not _env_bool("ZKBIO_PERSIST_SESSION", True):
        return
    if _ZKBIO_ENV_PATH is None or not _ZKBIO_ENV_PATH.is_file():
        return
    try:
        lines = _ZKBIO_ENV_PATH.read_text(encoding="utf-8-sig").splitlines(keepends=True)
    except OSError:
        return
    out: List[str] = []
    found = False
    for line in lines:
        if line.strip().startswith("ZKBIO_SESSION="):
            out.append(f"ZKBIO_SESSION={session_value}\n")
            found = True
        else:
            out.append(line if line.endswith("\n") else line + "\n")
    if not found:
        out.append(f"ZKBIO_SESSION={session_value}\n")
    try:
        _ZKBIO_ENV_PATH.write_text("".join(out), encoding="utf-8")
    except OSError as e:
        print(f"ZKBio: could not save SESSION to {_ZKBIO_ENV_PATH}: {e}", file=sys.stderr)


def login_password_candidates() -> List[str]:
    """Password values to try on login.do (hash from DevTools, else MD5 of plain)."""
    seen: set[str] = set()
    out: List[str] = []

    def add(value: str) -> None:
        v = (value or "").strip()
        if v and v not in seen:
            seen.add(v)
            out.append(v)

    add(os.environ.get("ZKBIO_PASSWORD_HASH", ""))
    plain = os.environ.get("ZKBIO_PASSWORD", "").strip()
    if plain and _env_bool("ZKBIO_PASSWORD_MD5", True):
        add(hashlib.md5(plain.encode("utf-8")).hexdigest())
    if plain and _env_bool("ZKBIO_PASSWORD_TRY_PLAIN", False):
        add(plain)
    return out


def session_cookie_value(session_req: Any) -> str:
    for c in session_req.cookies:
        if c.name.upper() == "SESSION":
            return (c.value or "").strip()
    return ""


def ensure_zkbio_session(session_req: Any, base: str, verify_ssl: bool, *, force: bool = False) -> bool:
    """
    Auto-login + SESSION refresh. Uses ZKBIO_USERNAME + ZKBIO_PASSWORD(_HASH).
    On success, persists SESSION to zkbio-sync.local.env so manual copy is not needed each run.
    """
    user = os.environ.get("ZKBIO_USERNAME", "").strip()
    candidates = login_password_candidates()
    if not _env_bool("ZKBIO_AUTO_LOGIN", True) or not user or not candidates:
        return bool(session_cookie_value(session_req) or os.environ.get("ZKBIO_SESSION", "").strip())

    every_run = _env_bool("ZKBIO_LOGIN_EVERY_RUN", True)
    if session_cookie_value(session_req) and not force and not every_run:
        return True

    if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
        print("ZKBio debug: auto-login (session refresh)…", file=sys.stderr)

    for pwd in candidates:
        if try_login(session_req, base, verify_ssl, pwd):
            sess = session_cookie_value(session_req)
            if sess:
                persist_zkbio_session(sess)
                if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
                    print(
                        f"ZKBio debug: SESSION refreshed ({sess[:8]}…)",
                        file=sys.stderr,
                    )
                return True
    return bool(session_cookie_value(session_req))


def try_login(session_req: Any, base: str, verify_ssl: bool, password: str) -> bool:
    """
    Login via login.do. Password is usually MD5(plain) or ZKBIO_PASSWORD_HASH from DevTools.
    """
    user = os.environ.get("ZKBIO_USERNAME", "").strip()
    pwd_to_send = (password or "").strip()
    if not user or not pwd_to_send:
        return False

    login_url = f"{base}/login.do"
    form: Dict[str, Any] = {
        "username": user,
        "password": pwd_to_send,
    }
    cc = os.environ.get("ZKBIO_CHECKCODE", "").strip()
    if cc:
        form["checkCode"] = cc

    # Some builds require XHR headers even for login.
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": f"{base}/bioLogin.do",
        "Origin": base,
    }
    token = os.environ.get("ZKBIO_BROWSER_TOKEN", "").strip()
    if token:
        headers["browser-token"] = token
        # Some builds also expect browserToken in form body.
        form.setdefault("browserToken", token)

    try:
        # First load login page (some servers set additional cookies / params)
        session_req.get(f"{base}/bioLogin.do", headers=headers, timeout=30, verify=verify_ssl)
        r = session_req.post(login_url, data=form, headers=headers, timeout=60, verify=verify_ssl)
    except requests.RequestException:
        return False

    if r.status_code < 200 or r.status_code >= 300:
        if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
            print(
                f"ZKBio debug: login.do HTTP {r.status_code} body={(r.text or '')[:300]!r}",
                file=sys.stderr,
            )
        return False

    data = _parse_json_response(r)
    has_session = any(c.name.upper() == "SESSION" for c in session_req.cookies)
    if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
        print(
            f"ZKBio debug: login.do HTTP {r.status_code} SESSION_cookie={has_session} "
            f"json={(str(data)[:300] if data else (r.text or '')[:300])!r}",
            file=sys.stderr,
        )

    if isinstance(data, dict):
        if data.get("success") in (False, "false", 0):
            msg = data.get("msg") or data.get("message") or data
            print(f"ZKBio: login failed — {msg}", file=sys.stderr)
            print(
                "Use ZKBIO_PASSWORD_HASH from DevTools → login.do → Payload (encrypted password), "
                "or paste fresh ZKBIO_SESSION after logging in via browser.",
                file=sys.stderr,
            )
            return False
        if data.get("success") in (True, "true", 1):
            return True
        if data.get("status") in (200, "200") and data.get("error") in (None, "", "OK"):
            return True
        if looks_like_auth_wrapper(data):
            print(
                "ZKBio: login failed — set ZKBIO_PASSWORD_HASH or fresh ZKBIO_SESSION.",
                file=sys.stderr,
            )
            return False
    return has_session


def _missing_dedupe_indexes(cur: Any) -> List[str]:
    """Both indexes matter: log_id stops same device row re-inserted; pin+event catches empty log_id."""
    names = ("uq_zkbio_log_id", "uq_zkbio_pin_event")
    missing: List[str] = []
    for idx in names:
        cur.execute(
            """
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'zkbio_punch_log'
              AND index_name = %s
            LIMIT 1
            """,
            (idx,),
        )
        if cur.fetchone() is None:
            missing.append(idx)
    return missing


def resolve_sync_window(
    cur: Any,
    args: argparse.Namespace,
    sync_since: datetime,
) -> tuple[str, str, str]:
    """
    Returns (start_str, end_str, mode_label).
    mode_label: 'manual' | 'incremental'
    """
    allow_early = os.environ.get("ZKBIO_ALLOW_BEFORE_SYNC_SINCE", "").lower() in ("1", "true", "yes")
    overlap_min = max(0, int(os.environ.get("ZKBIO_SYNC_OVERLAP_MINUTES", "5")))

    end_dt = datetime.now()
    end_str = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    if args.start and args.end:
        start_str, end_str = args.start, args.end
        st = parse_dt(start_str)
        if st is not None and st < sync_since and not allow_early:
            start_str = sync_since.strftime("%Y-%m-%d %H:%M:%S")
            print(
                f"Clamped --start to ZKBIO_SYNC_SINCE ({start_str}). "
                f"Set ZKBIO_ALLOW_BEFORE_SYNC_SINCE=1 for earlier backfill.",
                file=sys.stderr,
            )
        return start_str, end_str, "manual"

    cur.execute(
        """
        SELECT MAX(event_time) AS m
        FROM zkbio_punch_log
        WHERE event_time IS NOT NULL AND event_time >= %s
        """,
        (sync_since,),
    )
    row = cur.fetchone()
    last = row[0] if row else None
    if last is not None and not isinstance(last, datetime):
        last = parse_dt(str(last))

    if last is not None:
        start_dt = max(sync_since, last - timedelta(minutes=overlap_min))
    else:
        start_dt = sync_since

    start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    return start_str, end_str, "incremental"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", help="Start datetime e.g. 2026-03-24 00:00:00")
    parser.add_argument("--end", help="End datetime e.g. 2026-03-24 23:59:59")
    args = parser.parse_args()

    base = os.environ.get("ZKBIO_BASE", "https://192.168.10.29:8098").rstrip("/")
    list_path = os.environ.get("ZKBIO_LIST_PATH", "accTransaction.do?list").strip()
    if list_path.startswith("http://") or list_path.startswith("https://"):
        list_url = list_path
    else:
        list_url = f"{base}/{list_path.lstrip('/')}"
    session = os.environ.get("ZKBIO_SESSION", "").strip()
    token = os.environ.get("ZKBIO_BROWSER_TOKEN", "").strip()
    verify_ssl = os.environ.get("ZKBIO_VERIFY_SSL", "false").lower() in ("1", "true", "yes")
    if not verify_ssl:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    http_method = os.environ.get("ZKBIO_HTTP_METHOD", "get").strip().lower()
    extra_form = os.environ.get("ZKBIO_EXTRA_FORM", "").strip()

    user = os.environ.get("ZKBIO_USERNAME", "").strip()
    creds = login_password_candidates()
    if not session and not (user and creds):
        print(
            "Missing ZKBIO_SESSION and no auto-login credentials. Set ZKBIO_USERNAME + ZKBIO_PASSWORD "
            "(MD5 login) or ZKBIO_PASSWORD_HASH in scripts/zkbio-sync.local.env.",
            file=sys.stderr,
        )
        return 1

    sync_since = parse_dt(os.environ.get("ZKBIO_SYNC_SINCE", "").strip()) or default_sync_since_march_floor()

    db_cfg = {
        "host": os.environ.get("DB_HOST", "localhost"),
        "port": int(os.environ.get("DB_PORT", "3306")),
        "user": os.environ.get("DB_USER", "root"),
        "password": os.environ.get("DB_PASSWORD", ""),
        "database": os.environ.get("DB_NAME", "interact_hrm"),
    }
    socket_path = os.environ.get("DB_SOCKET_PATH", "").strip()
    if not socket_path and platform.system() != "Windows":
        default_sock = "/var/run/mysqld/mysqld.sock"
        if os.path.exists(default_sock):
            socket_path = default_sock
    if socket_path:
        # Ubuntu: root@localhost often uses auth_socket via unix socket (same as lib/db.ts).
        db_cfg["unix_socket"] = socket_path
        db_cfg.pop("host", None)
        db_cfg.pop("port", None)
        if not os.environ.get("DB_PASSWORD", "").strip():
            db_cfg["password"] = ""

    try:
        conn = mysql.connector.connect(**db_cfg)
    except mysql.connector.Error as e:
        if getattr(e, "errno", None) == 1698:
            print(
                "MySQL auth failed (1698): root@localhost is likely socket-auth on Ubuntu.\n"
                "Set DB_SOCKET_PATH=/var/run/mysqld/mysqld.sock in scripts/zkbio-sync.local.env\n"
                "and run the script with sudo, or use a dedicated DB user/password.",
                file=sys.stderr,
            )
        raise
    cur = conn.cursor()

    start_str, end_str, window_mode = resolve_sync_window(cur, args, sync_since)

    miss = _missing_dedupe_indexes(cur)
    if miss:
        print(
            "WARNING: Missing MySQL index(es): "
            + ", ".join(miss)
            + " — duplicates will not be skipped. Run: mysql ... < scripts/zkbio-punch-log-dedupe.sql",
            file=sys.stderr,
        )

    referer = f"{base}/main.do?home&selectSysCode=Acc"

    session_req = requests.Session()
    headers: Dict[str, str] = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
    }
    if token:
        headers["browser-token"] = token
    if http_method == "post":
        headers["Origin"] = base
    session_req.headers.update(headers)
    # IMPORTANT: do not set Cookie header manually; use cookie jar so it can refresh after login.
    sess_val = session.replace("SESSION=", "", 1) if session.startswith("SESSION=") else session
    if sess_val:
        session_req.cookies.set("SESSION", sess_val)

    if not ensure_zkbio_session(session_req, base, verify_ssl):
        print(
            "ZKBio: auto-login failed. Check ZKBIO_USERNAME / ZKBIO_PASSWORD in zkbio-sync.local.env.",
            file=sys.stderr,
        )
        return 1

    insert_sql = """
    INSERT IGNORE INTO zkbio_punch_log
    (log_id, event_time, pin, first_name, last_name, event_name, verify_mode, device_name, reader_name, dept_name, raw_json, imported_at)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    """

    page = 1
    inserted = 0
    skipped_no_time = 0
    fetched_rows = 0

    while True:
        params: Dict[str, Any] = {}
        merge_extra_form(params, extra_form)
        params[START_PARAM] = start_str
        params[END_PARAM] = end_str
        if PAGINATION_STYLE == "dhtmlx":
            params[POS_START_PARAM] = (page - 1) * PAGE_SIZE
            params[COUNT_PARAM] = PAGE_SIZE
        else:
            params[PAGE_PARAM] = page
            params[ROWS_PARAM] = PAGE_SIZE

        if os.environ.get("ZKBIO_JQGRID_EXTRAS", "true").lower() in ("1", "true", "yes"):
            params.setdefault("_search", "false")
            params.setdefault("nd", str(int(time.time() * 1000)))
            params.setdefault("sidx", "")
            params.setdefault("sord", "asc")

        data = fetch_grid_json(session_req, list_url, params, http_method, verify_ssl)
        if data is None:
            cur.close()
            conn.close()
            return 1

        # Auto re-login on expired session wrapper, then retry once.
        if isinstance(data, dict) and looks_like_auth_wrapper(data):
            if os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
                print("ZKBio debug: auth wrapper detected, refreshing session…", file=sys.stderr)
            if ensure_zkbio_session(session_req, base, verify_ssl, force=True):
                data = fetch_grid_json(session_req, list_url, params, http_method, verify_ssl)
            if not isinstance(data, dict) or looks_like_auth_wrapper(data):
                print(
                    "ZKBio: session expired/unauthorized. Check ZKBIO_USERNAME + ZKBIO_PASSWORD "
                    "(or ZKBIO_PASSWORD_HASH) in zkbio-sync.local.env.",
                    file=sys.stderr,
                )
                cur.close()
                conn.close()
                return 1

        rows = normalize_rows(data)
        if not rows:
            if page == 1 and isinstance(data, dict):
                rec = data.get("records")
                try:
                    nrec = int(rec) if rec is not None and str(rec).strip() != "" else 0
                except (TypeError, ValueError):
                    nrec = 0
                if nrec > 0:
                    print(
                        f"ZKBio: API reports records={nrec} but 0 rows parsed — "
                        f"column layout may differ or need ZKBIO_EXTRA_FORM. JSON keys: {list(data.keys())}",
                        file=sys.stderr,
                    )
                elif os.environ.get("ZKBIO_DEBUG", "").lower() in ("1", "true", "yes"):
                    print(f"ZKBio debug: JSON keys={list(data.keys())} snippet={str(data)[:400]}", file=sys.stderr)
            break

        # dhtmlx-style pagination: stop when we reached total_count.
        # Many CVAccess builds return: { total_count, pos, rows, total } and expect posStart/count.
        if isinstance(data, dict) and PAGINATION_STYLE == "dhtmlx":
            try:
                total_count = int(data.get("total_count") or 0)
            except (TypeError, ValueError):
                total_count = 0
            try:
                pos_val = int(data.get("pos") or params.get(POS_START_PARAM) or 0)
            except (TypeError, ValueError):
                pos_val = int(params.get(POS_START_PARAM) or 0)
            # If server keeps returning full pages, prevent infinite looping.
            if total_count > 0 and (pos_val + len(rows)) >= total_count:
                total_pages = None  # do not use jqgrid logic below
                # We'll finish after processing this page.
                reached_end_dhtmlx = True
            else:
                reached_end_dhtmlx = False
        else:
            reached_end_dhtmlx = False

        total_pages: Optional[int] = None
        if isinstance(data, dict):
            raw_tp = data.get("total")
            if raw_tp is not None and str(raw_tp).strip() != "":
                try:
                    total_pages = int(raw_tp)
                except (TypeError, ValueError):
                    total_pages = None

        fetched_rows += len(rows)

        for row in rows:
            log_id = (row.get("logId") or row.get("log_id") or "").strip() or None
            event_time = parse_dt(row.get("eventTime") or row.get("event_time"))
            if event_time is None:
                skipped_no_time += 1
                continue
            pin = normalize_pin(row.get("pin"))
            first_name = row.get("name") or row.get("firstName")
            last_name = row.get("lastName") or row.get("last_name")
            event_name = row.get("eventName") or row.get("event_name")
            verify_mode = row.get("verifyModeName") or row.get("verify_mode")
            device_name = row.get("devAlias") or row.get("device_name")
            reader_name = row.get("readerName") or row.get("reader_name")
            dept_name = row.get("deptName") or row.get("dept_name")

            cur.execute(
                insert_sql,
                (
                    log_id,
                    event_time,
                    pin,
                    first_name,
                    last_name,
                    event_name,
                    verify_mode,
                    device_name,
                    reader_name,
                    dept_name,
                    json.dumps(row, ensure_ascii=False),
                ),
            )
            if cur.rowcount and cur.rowcount > 0:
                inserted += cur.rowcount

        conn.commit()

        if reached_end_dhtmlx:
            break

        if total_pages is not None and total_pages > 0:
            if page >= total_pages:
                break
        elif len(rows) < PAGE_SIZE:
            break
        page += 1

    cur.close()
    conn.close()

    summary = (
        f"ZKBio sync ({window_mode}): window {start_str} .. {end_str}. "
        f"Fetched {fetched_rows} row(s) from API; inserted {inserted} new; "
        f"skipped {skipped_no_time} without event time."
    )
    print(summary)
    if inserted == 0 and fetched_rows == 0:
        print(
            "Hint: 0 rows from ZKBio — check (1) server can reach ZKBIO_BASE (often 192.168.x.x only on LAN), "
            "(2) ZKBIO_SESSION not expired, (3) sync window vs MAX(event_time) in DB. Run with ZKBIO_DEBUG=1 for details.",
            file=sys.stderr,
        )
    elif inserted == 0 and fetched_rows > 0:
        print(
            "Hint: API returned rows but none were new (already in DB via INSERT IGNORE / unique keys).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
