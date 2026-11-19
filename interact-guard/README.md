# Interact Guard

Mature Windows presence agent for Interact HRM (separate from `desktop-presence-agent` / Interact Presence).

## What it does

1. **Install** → shows in **Add or remove programs**; uninstall removes completely.
2. After install, agent **heartbeats** → appears on HRM Admin device list.
3. Monitoring starts only when **Admin turns ON** (remote).
4. Idle (keyboard/mouse) → **face verification** via HRM `/presence-silent`.
5. Face fail + no active break/meeting → **auto ticket** with employee **name + pseudonym + HRM id**.
6. Exit requires **admin password**; Watchdog + optional Windows Service restart the agent.

## Folder

```
interact-guard/
  InteractGuard.Agent/      # tray agent
  InteractGuard.Watchdog/   # restarts agent
  InteractGuard.Service/    # Windows Service (SYSTEM)
  installer/                # Install.ps1 / Uninstall.ps1
  scripts/Pack-Zip.ps1      # build + zip
  dist/                     # output zip
```

## Build zip installer

```powershell
cd interact-guard
powershell -ExecutionPolicy Bypass -File .\scripts\Pack-Zip.ps1
```

Zip: `interact-guard\dist\InteractGuard-Installer-v1.0.0.zip`

## Install on a PC

1. Unzip `InteractGuard-Installer-v1.0.0.zip`
2. Double-click **`Setup.exe`** (Windows UAC → Install wizard)
3. App appears under **Add or remove programs**
4. Assign employee in HRM Admin; turn **ON** to start monitoring

Do **not** open `Install.ps1` — that was an early script; use **Setup.exe**.

## Auto employee bind

After install, employee opens **Employee Dashboard** once (logged in).  
Dashboard pushes **ID + name + pseudonym** to the agent on `127.0.0.1:19501`.  
No manual ID entry. Admin page still shows the bound employee; Admin **ON** starts monitoring.

## HRM APIs used / expected

| Endpoint | Purpose |
|----------|---------|
| `POST /api/presence-agent/heartbeat` | Register PC + pull Admin ON/pause + employee |
| `GET /api/presence/active-break?employeeId=` | Skip ticket if break active |
| `POST /api/presence/seat-absent-ticket` | Auto ticket (name + pseudo + id) |
| `/presence-silent?employeeId=` | Face check UI |

Heartbeat response fields Guard understands: `admin_enabled`, `idle_seconds`, `command` (`pause`/`resume`/`on`/`restart`), `assigned_employee_id`, `assigned_employee_name`, `pseudonym`, `exit_password`.
