import { createHash } from "crypto";
import { pool } from "@/lib/db";
import {
  getPresenceSettings,
  resolveFaceScanIntervalSeconds,
  savePresenceSettings,
} from "@/lib/presence-settings";

const TABLE = "presence_agents";

/** One-time per process: backfill pc_key + collapse historical duplicates. */
let pcKeyReady = false;

export type AgentHealth = "healthy" | "stale" | "offline";

export type PresenceAgentRow = {
  id: number;
  machineId: string;
  hostname: string | null;
  windowsUser: string | null;
  hrmBaseUrl: string | null;
  localEmployeeId: string | null;
  assignedEmployeeId: string | null;
  agentVersion: string | null;
  agentProduct: string | null;
  adminEnabled: boolean;
  idleSeconds: number;
  assignmentLocked: boolean;
  lastIp: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  health: AgentHealth;
  /** Windows service heartbeat — Admin remote Start needs this online. */
  serviceLastSeenAt: string | null;
  serviceHealth: AgentHealth;
  serviceVersion: string | null;
  assignedEmployeeName: string | null;
  assignedEmployeeCode: string | null;
  assignedPseudonym: string | null;
};

type DbRow = {
  id: number;
  machine_id: string;
  hostname: string | null;
  windows_user: string | null;
  hrm_base_url: string | null;
  local_employee_id: string | null;
  assigned_employee_id: string | null;
  agent_version: string | null;
  agent_product?: string | null;
  admin_enabled?: number | boolean | null;
  idle_seconds?: number | null;
  assignment_locked?: number | boolean | null;
  last_ip: string | null;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  service_last_seen_at?: Date | string | null;
  service_version?: string | null;
  assigned_first_name?: string | null;
  assigned_last_name?: string | null;
  assigned_employee_code?: string | null;
  assigned_pseudonym?: string | null;
};

async function addColumn(sql: string) {
  try {
    await pool.execute(sql);
  } catch {
    /* already exists */
  }
}

export async function ensurePresenceAgentsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id int(11) NOT NULL AUTO_INCREMENT,
      machine_id varchar(128) NOT NULL,
      hostname varchar(255) DEFAULT NULL,
      windows_user varchar(255) DEFAULT NULL,
      hrm_base_url varchar(512) DEFAULT NULL,
      local_employee_id varchar(64) DEFAULT NULL,
      assigned_employee_id varchar(64) DEFAULT NULL,
      agent_version varchar(32) DEFAULT NULL,
      agent_product varchar(64) DEFAULT NULL,
      admin_enabled tinyint(1) NOT NULL DEFAULT 0,
      idle_seconds int(11) NOT NULL DEFAULT 120,
      last_ip varchar(45) DEFAULT NULL,
      first_seen_at datetime DEFAULT NULL,
      last_seen_at datetime DEFAULT NULL,
      service_last_seen_at datetime DEFAULT NULL,
      service_version varchar(32) DEFAULT NULL,
      pending_command varchar(32) DEFAULT NULL,
      command_issued_at datetime DEFAULT NULL,
      pc_key varchar(64) DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT current_timestamp(),
      updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      UNIQUE KEY uq_presence_agents_machine (machine_id),
      KEY idx_presence_agents_last_seen (last_seen_at),
      KEY idx_presence_agents_assigned (assigned_employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN pending_command varchar(32) DEFAULT NULL`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN command_issued_at datetime DEFAULT NULL`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN agent_product varchar(64) DEFAULT NULL`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN admin_enabled tinyint(1) NOT NULL DEFAULT 0`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN idle_seconds int(11) NOT NULL DEFAULT 120`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN pc_key varchar(64) DEFAULT NULL`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN assignment_locked tinyint(1) NOT NULL DEFAULT 0`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN service_last_seen_at datetime DEFAULT NULL`,
  );
  await addColumn(
    `ALTER TABLE ${TABLE} ADD COLUMN service_version varchar(32) DEFAULT NULL`,
  );

  if (!pcKeyReady) {
    pcKeyReady = true;
    try {
      await backfillPcKeysAndDedupe();
    } catch {
      /* non-fatal — next heartbeat still merges */
    }
    try {
      await pool.execute(
        `ALTER TABLE ${TABLE} ADD UNIQUE KEY uq_presence_agents_pc_key (pc_key)`,
      );
    } catch {
      /* already exists */
    }
  }
}

/** Normalize DOMAIN\\user → user (lowercase). */
export function normalizeWindowsUser(windowsUser: string | null | undefined): string {
  const s = String(windowsUser ?? "").trim();
  if (!s) return "";
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return (i >= 0 ? s.slice(i + 1) : s).trim().toLowerCase();
}

export function normalizeHostname(hostname: string | null | undefined): string {
  return String(hostname ?? "").trim().toLowerCase();
}

/** Stable PC fingerprint — same host + Windows login = one agent row forever. */
export function computePcKey(
  hostname: string | null | undefined,
  windowsUser: string | null | undefined,
): string | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  const user = normalizeWindowsUser(windowsUser);
  return createHash("sha256")
    .update(`${host}|${user}`)
    .digest("hex")
    .slice(0, 32);
}

async function backfillPcKeysAndDedupe(): Promise<void> {
  const [rows] = await pool.execute(
    `SELECT id, machine_id, hostname, windows_user, pc_key,
            assigned_employee_id, admin_enabled, idle_seconds, local_employee_id,
            last_seen_at
     FROM ${TABLE}
     ORDER BY last_seen_at DESC, id DESC`,
  );
  const list = rows as {
    id: number;
    machine_id: string;
    hostname: string | null;
    windows_user: string | null;
    pc_key: string | null;
    assigned_employee_id: string | null;
    admin_enabled: number | boolean | null;
    idle_seconds: number | null;
    local_employee_id: string | null;
  }[];

  const byKey = new Map<string, typeof list>();
  for (const r of list) {
    const key = computePcKey(r.hostname, r.windows_user);
    if (!key) continue;
    if (!r.pc_key || r.pc_key !== key) {
      await pool.execute(`UPDATE ${TABLE} SET pc_key = ? WHERE id = ?`, [key, r.id]);
    }
    const bucket = byKey.get(key) ?? [];
    bucket.push(r);
    byKey.set(key, bucket);
  }

  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    const keep = group[0];
    const others = group.slice(1);
    let assigned = keep.assigned_employee_id;
    let adminOn = asBool(keep.admin_enabled);
    let idle = Number(keep.idle_seconds) > 0 ? Number(keep.idle_seconds) : 120;
    let localId = keep.local_employee_id;
    for (const o of others) {
      if (!assigned && o.assigned_employee_id) assigned = o.assigned_employee_id;
      if (!adminOn && asBool(o.admin_enabled)) adminOn = true;
      if ((!localId || !String(localId).trim()) && o.local_employee_id)
        localId = o.local_employee_id;
      const oi = Number(o.idle_seconds);
      if (oi > 0) idle = oi;
    }
    for (const o of others) {
      await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [o.id]);
    }
    await pool.execute(
      `UPDATE ${TABLE}
       SET assigned_employee_id = ?,
           local_employee_id = ?,
           admin_enabled = ?,
           idle_seconds = ?,
           pc_key = ?
       WHERE id = ?`,
      [
        assigned,
        localId,
        adminOn ? 1 : 0,
        idle,
        computePcKey(keep.hostname, keep.windows_user),
        keep.id,
      ],
    );
  }
}

export function agentHealthFromLastSeen(lastSeen: Date | string | null): AgentHealth {
  if (!lastSeen) return "offline";
  const t = lastSeen instanceof Date ? lastSeen.getTime() : new Date(lastSeen).getTime();
  if (!Number.isFinite(t)) return "offline";
  const ageMs = Date.now() - t;
  if (ageMs <= 3 * 60 * 1000) return "healthy";
  if (ageMs <= 30 * 60 * 1000) return "stale";
  return "offline";
}

function toIso(v: Date | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(v);
}

function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function mapRow(r: DbRow): PresenceAgentRow {
  const assignedEmployeeName =
    [r.assigned_first_name, r.assigned_last_name].filter(Boolean).join(" ").trim() || null;
  return {
    id: r.id,
    machineId: r.machine_id,
    hostname: r.hostname,
    windowsUser: r.windows_user,
    hrmBaseUrl: r.hrm_base_url,
    localEmployeeId: r.local_employee_id,
    assignedEmployeeId: r.assigned_employee_id,
    agentVersion: r.agent_version,
    agentProduct: r.agent_product ?? null,
    adminEnabled: asBool(r.admin_enabled),
    idleSeconds: Number(r.idle_seconds) > 0 ? Number(r.idle_seconds) : 120,
    assignmentLocked: asBool(r.assignment_locked),
    lastIp: r.last_ip,
    firstSeenAt: toIso(r.first_seen_at),
    lastSeenAt: toIso(r.last_seen_at),
    health: agentHealthFromLastSeen(r.last_seen_at),
    serviceLastSeenAt: toIso(r.service_last_seen_at ?? null),
    serviceHealth: agentHealthFromLastSeen(r.service_last_seen_at ?? null),
    serviceVersion: r.service_version?.trim() || null,
    assignedEmployeeName,
    assignedEmployeeCode: r.assigned_employee_code ?? null,
    assignedPseudonym: r.assigned_pseudonym?.trim() || null,
  };
}

export type HeartbeatInput = {
  machineId: string;
  hostname?: string | null;
  windowsUser?: string | null;
  hrmBaseUrl?: string | null;
  localEmployeeId?: string | null;
  agentVersion?: string | null;
  agentProduct?: string | null;
  clientIp?: string | null;
  /** "service" = Windows service (does not mark tray agent Online). */
  component?: string | null;
  /** Service acks launch after CreateProcessAsUser succeeds. */
  completedCommand?: string | null;
  agentRunning?: boolean | null;
};

export type AgentCommand = "restart" | "exit" | "start" | "pause" | "resume" | "on";

const LAUNCH_COMMANDS: AgentCommand[] = ["start", "on", "resume", "restart"];

function isServiceComponent(input: HeartbeatInput): boolean {
  const c = String(input.component ?? "").trim().toLowerCase();
  if (c === "service") return true;
  const p = String(input.agentProduct ?? "").trim().toLowerCase();
  if (p.includes("service")) return true;
  // Legacy / mis-routed service heartbeats (never treat as tray agent)
  const user = String(input.windowsUser ?? "").trim().toUpperCase();
  if (user === "SYSTEM" || user === "NT AUTHORITY\\SYSTEM") return true;
  return false;
}

export type HeartbeatResult = {
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  pseudonym: string | null;
  command: AgentCommand | null;
  adminEnabled: boolean;
  idleSeconds: number;
  recheckWhileIdleSeconds: number;
  /** Periodic face scan interval (clocked in, no break). Idle ignored. */
  faceScanIntervalSeconds: number;
  faceVerifyMaxAttempts: number;
  faceVerifyRetryGapSeconds: number;
  exitPassword: string;
  presenceEnabled: boolean;
  cameraVerificationEnabled: boolean;
  /** True when assigned employee has an open clock-in (no clock-out). */
  clockedIn: boolean;
  screenshotCaptureEnabled: boolean;
  screenshotIntervalSeconds: number;
  screenshotJpegQuality: number;
  screenshotScalePercent: number;
  agentHrmBaseUrl: string;
  /** Admin Guard Screenshots live view is open. */
  livePreviewActive: boolean;
  liveIntervalMs: number;
  liveJpegQuality: number;
  liveScalePercent: number;
};

export async function upsertAgentHeartbeat(
  input: HeartbeatInput,
): Promise<HeartbeatResult> {
  await ensurePresenceAgentsTable();
  let machineId = String(input.machineId ?? "").trim();
  if (!machineId || machineId.length > 128) {
    throw new Error("machine_id required");
  }

  const hostname = trimOrNull(input.hostname, 255);
  const windowsUser = trimOrNull(input.windowsUser, 255);
  const hrmBaseUrl = trimOrNull(input.hrmBaseUrl, 512);
  const localEmployeeId = trimOrNull(input.localEmployeeId, 64);
  const agentVersion = trimOrNull(input.agentVersion, 32);
  const agentProduct = trimOrNull(input.agentProduct, 64);
  const lastIp = trimOrNull(input.clientIp, 45);
  const now = new Date();
  const asService = isServiceComponent(input);
  const pcKey = asService ? null : computePcKey(hostname, windowsUser);

  // Windows service: touch service_* only (shared machine_id with tray agent).
  // Do not rematch by pc_key (SYSTEM user) and do not flip agent Online.
  if (asService) {
    await pool.execute(
      `INSERT INTO ${TABLE}
        (machine_id, hostname, hrm_base_url, service_version, last_ip, first_seen_at, last_seen_at, service_last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE
         hostname = COALESCE(VALUES(hostname), hostname),
         hrm_base_url = COALESCE(VALUES(hrm_base_url), hrm_base_url),
         service_version = VALUES(service_version),
         last_ip = COALESCE(VALUES(last_ip), last_ip),
         service_last_seen_at = VALUES(service_last_seen_at)`,
      [machineId, hostname, hrmBaseUrl, agentVersion, lastIp, now, now],
    );

    // Repair rows polluted when service HB was treated as tray agent (no SQL CASE — mongo-safe).
    try {
      const [polluteRows] = await pool.execute(
        `SELECT windows_user, agent_version, agent_product FROM ${TABLE} WHERE machine_id = ? LIMIT 1`,
        [machineId],
      );
      const pr = (polluteRows as {
        windows_user?: string | null;
        agent_version?: string | null;
        agent_product?: string | null;
      }[])[0];
      if (pr) {
        const wu = String(pr.windows_user ?? "").trim();
        const av = String(pr.agent_version ?? "").trim();
        const ap = String(pr.agent_product ?? "").trim().toLowerCase();
        const wuBad =
          !wu ||
          wu.toUpperCase() === "SYSTEM" ||
          wu.toUpperCase() === "NT AUTHORITY\\SYSTEM" ||
          wu.toUpperCase().startsWith("CASE WHEN");
        const avBad =
          !av ||
          (agentVersion != null && av === agentVersion) ||
          ap.includes("service");
        const apBad = ap.includes("service");
        if (wuBad || avBad || apBad) {
          await pool.execute(
            `UPDATE ${TABLE}
             SET windows_user = ?,
                 agent_version = ?,
                 agent_product = ?
             WHERE machine_id = ?`,
            [
              wuBad ? null : wu,
              avBad ? null : av || null,
              apBad ? "InteractGuard" : pr.agent_product ?? "InteractGuard",
              machineId,
            ],
          );
        }
      }
    } catch {
      /* non-fatal */
    }

    const completed = String(input.completedCommand ?? "")
      .trim()
      .toLowerCase();
    if (LAUNCH_COMMANDS.includes(completed as AgentCommand)) {
      await pool.execute(
        `UPDATE ${TABLE}
         SET pending_command = NULL, command_issued_at = NULL, admin_enabled = 1
         WHERE machine_id = ?
           AND LOWER(TRIM(COALESCE(pending_command, ''))) IN ('start','on','resume','restart')`,
        [machineId],
      );
    }
  }

  // Reinstalls used to send a new random machine_id — reuse the existing PC row.
  if (!asService && pcKey) {
    const [byKey] = await pool.execute(
      `SELECT machine_id FROM ${TABLE} WHERE pc_key = ? LIMIT 1`,
      [pcKey],
    );
    const existing = (byKey as { machine_id: string }[])[0]?.machine_id?.trim();
    if (existing) {
      machineId = existing;
    } else {
      const host = normalizeHostname(hostname);
      const user = normalizeWindowsUser(windowsUser);
      const [legacy] = await pool.execute(
        `SELECT machine_id, windows_user FROM ${TABLE}
         WHERE LOWER(TRIM(hostname)) = ?
         ORDER BY last_seen_at DESC, id DESC`,
        [host],
      );
      const match = (
        legacy as { machine_id: string; windows_user: string | null }[]
      ).find((r) => normalizeWindowsUser(r.windows_user) === user);
      if (match?.machine_id?.trim()) machineId = match.machine_id.trim();
    }
  }

  // Tray agent path only (service already wrote service_* above)
  if (!asService) {
    // If admin locked this profile, only refresh last_seen / version — never overwrite ID/name/IP
    const [lockRows] = await pool.execute(
      `SELECT assignment_locked FROM ${TABLE} WHERE machine_id = ? LIMIT 1`,
      [machineId],
    );
    const isLocked = asBool(
      (lockRows as { assignment_locked?: number | boolean | null }[])[0]
        ?.assignment_locked,
    );

    if (isLocked) {
      await pool.execute(
        `UPDATE ${TABLE}
         SET agent_version = COALESCE(?, agent_version),
             agent_product = COALESCE(?, agent_product),
             last_seen_at = ?
         WHERE machine_id = ?`,
        [agentVersion, agentProduct, now, machineId],
      );
    } else {
      await pool.execute(
        `INSERT INTO ${TABLE}
          (machine_id, hostname, windows_user, hrm_base_url, local_employee_id, agent_version, agent_product, last_ip, first_seen_at, last_seen_at, pc_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           hostname = VALUES(hostname),
           windows_user = VALUES(windows_user),
           hrm_base_url = VALUES(hrm_base_url),
           local_employee_id = VALUES(local_employee_id),
           agent_version = VALUES(agent_version),
           agent_product = COALESCE(VALUES(agent_product), agent_product),
           last_ip = VALUES(last_ip),
           last_seen_at = VALUES(last_seen_at),
           pc_key = VALUES(pc_key)`,
        [
          machineId,
          hostname,
          windowsUser,
          hrmBaseUrl,
          localEmployeeId,
          agentVersion,
          agentProduct,
          lastIp,
          now,
          now,
          pcKey,
        ],
      );

      // Safety net for any race that slipped past pc_key
      await mergeDuplicateAgentsForPc(hostname, windowsUser, machineId);

      // Auto-bind only when unlocked
      if (localEmployeeId && /^\d+$/.test(localEmployeeId)) {
        await pool.execute(
          `UPDATE ${TABLE}
           SET assigned_employee_id = ?
           WHERE machine_id = ?
             AND (assigned_employee_id IS NULL OR assigned_employee_id = '' OR assigned_employee_id = local_employee_id)`,
          [localEmployeeId, machineId],
        );
      }
    }
  }

  const [rows] = await pool.execute(
    `SELECT pa.assigned_employee_id,
            pa.pending_command,
            pa.admin_enabled,
            pa.idle_seconds,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name,
            e.pseudonym AS assigned_pseudonym
     FROM ${TABLE} pa
     LEFT JOIN hrm_employees e ON e.id = pa.assigned_employee_id
     WHERE pa.machine_id = ?
     LIMIT 1`,
    [machineId],
  );
  const list = rows as {
    assigned_employee_id: string | null;
    pending_command: string | null;
    admin_enabled: number | boolean | null;
    idle_seconds: number | null;
    assigned_first_name: string | null;
    assigned_last_name: string | null;
    assigned_pseudonym: string | null;
  }[];
  const row = list[0];
  const assignedEmployeeId = row?.assigned_employee_id?.trim() || null;
  const assignedEmployeeName =
    [row?.assigned_first_name, row?.assigned_last_name].filter(Boolean).join(" ").trim() ||
    null;
  const pseudonym = row?.assigned_pseudonym?.trim() || null;

  let adminEnabled = asBool(row?.admin_enabled);
  let idleSeconds = Number(row?.idle_seconds) > 0 ? Number(row.idle_seconds) : 120;

  let command: AgentCommand | null = null;
  const rawCmd = (row?.pending_command ?? "").trim().toLowerCase();
  const allowed: AgentCommand[] = ["restart", "exit", "start", "pause", "resume", "on"];
  if (allowed.includes(rawCmd as AgentCommand)) {
    command = rawCmd as AgentCommand;
    if (asService) {
      // Launch cmds stay pending until service sends completed_command (retry if no user session).
      if (command === "pause") {
        adminEnabled = false;
        await pool.execute(
          `UPDATE ${TABLE}
           SET pending_command = NULL, command_issued_at = NULL, admin_enabled = 0
           WHERE machine_id = ?`,
          [machineId],
        );
      } else if (command === "exit") {
        await pool.execute(
          `UPDATE ${TABLE} SET pending_command = NULL, command_issued_at = NULL WHERE machine_id = ?`,
          [machineId],
        );
      } else if (LAUNCH_COMMANDS.includes(command)) {
        adminEnabled = true;
      }
    } else {
      if (command === "pause") {
        adminEnabled = false;
        await pool.execute(`UPDATE ${TABLE} SET admin_enabled = 0 WHERE machine_id = ?`, [
          machineId,
        ]);
      }
      if (command === "resume" || command === "on" || command === "start") {
        adminEnabled = true;
        await pool.execute(`UPDATE ${TABLE} SET admin_enabled = 1 WHERE machine_id = ?`, [
          machineId,
        ]);
      }
      await pool.execute(
        `UPDATE ${TABLE} SET pending_command = NULL, command_issued_at = NULL WHERE machine_id = ?`,
        [machineId],
      );
    }
  }

  const settings = await getPresenceSettings();
  if (settings.agentsRetired) {
    command = "exit";
    adminEnabled = false;
  }
  // Presence / Idle page owns timings for Guard + Presence agents
  if (settings.idleWarningSeconds > 0) {
    idleSeconds = settings.idleWarningSeconds;
  }
  const recheckWhileIdleSeconds =
    settings.recheckWhileIdleSeconds > 0 ? settings.recheckWhileIdleSeconds : 180;
  // Employee → department → global default
  const faceScanIntervalSeconds = await resolveFaceScanIntervalSeconds(
    settings,
    assignedEmployeeId
  );
  const faceVerifyMaxAttempts =
    settings.faceVerifyMaxAttempts > 0 ? settings.faceVerifyMaxAttempts : 3;
  const faceVerifyRetryGapSeconds =
    settings.faceVerifyRetryGapSeconds > 0
      ? settings.faceVerifyRetryGapSeconds
      : 10;

  // Face scan only while clocked in (no open session → skip)
  let clockedIn = true;
  if (assignedEmployeeId) {
    const { employeeHasOpenClockIn } = await import("./attendance-presence");
    clockedIn = await employeeHasOpenClockIn(assignedEmployeeId);
  }

  const monitoringOn = settings.presenceEnabled && !settings.agentsRetired;

  let livePreviewActive = false;
  let liveIntervalMs = 2000;
  let liveJpegQuality = 45;
  let liveScalePercent = 45;
  try {
    const { liveStreamParamsForEmployee, readLiveSession } = await import(
      "./guard-live"
    );
    const liveSession = await readLiveSession();
    const live = liveStreamParamsForEmployee(liveSession, assignedEmployeeId);
    livePreviewActive = live.livePreviewActive;
    liveIntervalMs = live.liveIntervalMs;
    liveJpegQuality = live.liveJpegQuality;
    liveScalePercent = live.liveScalePercent;
  } catch {
    /* live optional */
  }

  return {
    assignedEmployeeId,
    assignedEmployeeName,
    pseudonym,
    command,
    adminEnabled,
    idleSeconds,
    recheckWhileIdleSeconds,
    faceScanIntervalSeconds,
    faceVerifyMaxAttempts,
    faceVerifyRetryGapSeconds,
    exitPassword: settings.agentExitPassword || "InteractAdmin",
    // Existing Guard agents gate on presence_enabled — disarm while not clocked in
    presenceEnabled: monitoringOn && clockedIn,
    cameraVerificationEnabled: settings.cameraVerificationEnabled,
    clockedIn,
    screenshotCaptureEnabled: settings.screenshotCaptureEnabled,
    screenshotIntervalSeconds: settings.screenshotIntervalSeconds,
    screenshotJpegQuality: settings.screenshotJpegQuality,
    screenshotScalePercent: settings.screenshotScalePercent,
    agentHrmBaseUrl: settings.agentHrmBaseUrl,
    livePreviewActive,
    liveIntervalMs,
    liveJpegQuality,
    liveScalePercent,
  };
}

export async function listPresenceAgents(): Promise<PresenceAgentRow[]> {
  await ensurePresenceAgentsTable();
  const [rows] = await pool.execute(
    `SELECT pa.*,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name,
            e.employee_code AS assigned_employee_code,
            e.pseudonym AS assigned_pseudonym
     FROM ${TABLE} pa
     LEFT JOIN hrm_employees e ON e.id = pa.assigned_employee_id
     ORDER BY pa.last_seen_at IS NULL, pa.last_seen_at DESC, pa.id DESC`,
  );
  const mapped = await enrichAssignedNames((rows as DbRow[]).map(mapRow));

  // Collapse clones (same machine_id or same PC) that mongo upsert used to spawn
  const byMachine = new Map<string, PresenceAgentRow>();
  for (const a of mapped) {
    const prev = byMachine.get(a.machineId);
    if (!prev || String(a.lastSeenAt || "") > String(prev.lastSeenAt || "")) {
      byMachine.set(a.machineId, a);
    }
  }
  const byPc = new Map<string, PresenceAgentRow>();
  for (const a of byMachine.values()) {
    const key = computePcKey(a.hostname, a.windowsUser) || `mid:${a.machineId}`;
    const prev = byPc.get(key);
    if (!prev || String(a.lastSeenAt || "") > String(prev.lastSeenAt || "")) {
      byPc.set(key, a);
    }
  }
  return Array.from(byPc.values()).sort((a, b) => {
    const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return tb - ta;
  });
}

export async function setAgentAssignedEmployee(
  machineId: string,
  assignedEmployeeId: string | null,
  opts?: { hrmBaseUrl?: string | null },
): Promise<PresenceAgentRow | null> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");

  const current = await getAgentByMachineId(mid);
  if (!current) throw new Error("Agent not found");
  if (current.assignmentLocked) {
    throw new Error("Profile is locked. Edit first to change details.");
  }

  let assigned: string | null = assignedEmployeeId?.trim() || null;
  if (assigned) {
    const [empRows] = await pool.execute(
      "SELECT id FROM hrm_employees WHERE id = ? LIMIT 1",
      [assigned],
    );
    const emp = empRows as { id: number }[];
    if (!emp[0]) throw new Error("Employee not found");
  }

  const hrmUrl =
    opts && opts.hrmBaseUrl !== undefined
      ? trimOrNull(opts.hrmBaseUrl, 512)
      : undefined;

  // Save with an employee → lock name / ID / URL / IP against further edits
  if (hrmUrl !== undefined) {
    await pool.execute(
      `UPDATE ${TABLE}
       SET assigned_employee_id = ?,
           hrm_base_url = ?,
           assignment_locked = ?
       WHERE machine_id = ?`,
      [assigned, hrmUrl, assigned ? 1 : 0, mid],
    );
  } else {
    await pool.execute(
      `UPDATE ${TABLE}
       SET assigned_employee_id = ?,
           assignment_locked = ?
       WHERE machine_id = ?`,
      [assigned, assigned ? 1 : 0, mid],
    );
  }
  return getAgentByMachineId(mid);
}

/** Unlock a saved profile so admin can Edit employee / HRM URL. */
export async function unlockAgentAssignment(
  machineId: string,
): Promise<PresenceAgentRow | null> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");
  await pool.execute(
    `UPDATE ${TABLE} SET assignment_locked = 0 WHERE machine_id = ?`,
    [mid],
  );
  return getAgentByMachineId(mid);
}

export async function setAgentAdminEnabled(
  machineId: string,
  enabled: boolean,
): Promise<PresenceAgentRow | null> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");
  await pool.execute(`UPDATE ${TABLE} SET admin_enabled = ? WHERE machine_id = ?`, [
    enabled ? 1 : 0,
    mid,
  ]);
  // Also queue resume/pause so running agent flips immediately
  await queueAgentCommand({
    machineId: mid,
    command: enabled ? "on" : "pause",
  });
  return getAgentByMachineId(mid);
}

export async function setAgentIdleSeconds(
  machineId: string,
  idleSeconds: number,
): Promise<PresenceAgentRow | null> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");
  const sec = Math.max(30, Math.min(86400, Math.floor(Number(idleSeconds) || 120)));
  await pool.execute(`UPDATE ${TABLE} SET idle_seconds = ? WHERE machine_id = ?`, [
    sec,
    mid,
  ]);
  return getAgentByMachineId(mid);
}

async function getAgentByMachineId(mid: string): Promise<PresenceAgentRow | null> {
  const [rows] = await pool.execute(
    `SELECT pa.*,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name,
            e.employee_code AS assigned_employee_code,
            e.pseudonym AS assigned_pseudonym
     FROM ${TABLE} pa
     LEFT JOIN hrm_employees e ON e.id = pa.assigned_employee_id
     WHERE pa.machine_id = ?
     LIMIT 1`,
    [mid],
  );
  const list = rows as DbRow[];
  if (!list[0]) return null;
  const mapped = mapRow(list[0]);
  const [enriched] = await enrichAssignedNames([mapped]);
  return enriched;
}

/** Fill assignedEmployeeName when JOIN misses (mongo id type / adapter gaps). */
async function enrichAssignedNames(
  rows: PresenceAgentRow[],
): Promise<PresenceAgentRow[]> {
  const need = rows.filter(
    (r) => r.assignedEmployeeId && !r.assignedEmployeeName?.trim(),
  );
  if (!need.length) return rows;

  const ids = [
    ...new Set(
      need
        .map((r) => String(r.assignedEmployeeId ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return rows;

  const byId = new Map<
    string,
    {
      first_name: string | null;
      last_name: string | null;
      employee_code: string | null;
      pseudonym: string | null;
    }
  >();

  for (const id of ids) {
    try {
      const n = Number(id);
      const [emps] = await pool.execute(
        `SELECT id, first_name, last_name, employee_code, pseudonym
         FROM hrm_employees WHERE id = ? LIMIT 1`,
        [Number.isFinite(n) && String(n) === id ? n : id],
      );
      const e = (
        emps as {
          id: number | string;
          first_name: string | null;
          last_name: string | null;
          employee_code: string | null;
          pseudonym: string | null;
        }[]
      )[0];
      if (e) byId.set(String(e.id), e);
    } catch {
      /* next */
    }
  }

  return rows.map((r) => {
    if (r.assignedEmployeeName?.trim() || !r.assignedEmployeeId) return r;
    const e = byId.get(String(r.assignedEmployeeId).trim());
    if (!e) return r;
    const name =
      [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || null;
    return {
      ...r,
      assignedEmployeeName: name,
      assignedEmployeeCode: e.employee_code ?? r.assignedEmployeeCode,
      assignedPseudonym: e.pseudonym?.trim() || r.assignedPseudonym,
    };
  });
}

function trimOrNull(v: string | null | undefined, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Collapse duplicate agent rows for the same hostname + Windows user.
 * Keeps the row matching `keepMachineId` (or newest), copies useful fields, deletes the rest.
 */
export async function mergeDuplicateAgentsForPc(
  hostname: string | null,
  windowsUser: string | null,
  keepMachineId: string,
): Promise<number> {
  const host = normalizeHostname(hostname);
  if (!host) return 0;
  const user = normalizeWindowsUser(windowsUser);

  // Keep WHERE mongo-adapter-friendly (no SUBSTRING_INDEX). Normalize user in JS.
  const [rows] = await pool.execute(
    `SELECT id, machine_id, hostname, windows_user, assigned_employee_id, admin_enabled, idle_seconds, local_employee_id
     FROM ${TABLE}
     WHERE LOWER(TRIM(hostname)) = ?
     ORDER BY last_seen_at DESC, id DESC`,
    [host],
  );
  const list = (
    rows as {
      id: number;
      machine_id: string;
      hostname: string | null;
      windows_user: string | null;
      assigned_employee_id: string | null;
      admin_enabled: number | boolean | null;
      idle_seconds: number | null;
      local_employee_id: string | null;
    }[]
  ).filter((r) => normalizeWindowsUser(r.windows_user) === user);
  if (list.length <= 1) return 0;

  const keep =
    list.find((r) => r.machine_id === keepMachineId) || list[0];
  const others = list.filter((r) => r.id !== keep.id);
  if (!others.length) return 0;

  // Preserve best assignment / admin_enabled from any duplicate
  let assigned = keep.assigned_employee_id;
  let adminOn = asBool(keep.admin_enabled);
  let idle = Number(keep.idle_seconds) > 0 ? Number(keep.idle_seconds) : 120;
  let localId = keep.local_employee_id;
  for (const o of others) {
    if (!assigned && o.assigned_employee_id) assigned = o.assigned_employee_id;
    if (!adminOn && asBool(o.admin_enabled)) adminOn = true;
    if ((!localId || !String(localId).trim()) && o.local_employee_id)
      localId = o.local_employee_id;
    const oi = Number(o.idle_seconds);
    if (oi > 0) idle = oi;
  }

  // Delete duplicates one-by-one (mongo adapter IN() is fine, but ids may be mixed types)
  for (const o of others) {
    await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [o.id]);
  }

  const pcKey = computePcKey(hostname, windowsUser);
  await pool.execute(
    `UPDATE ${TABLE}
     SET machine_id = ?,
         assigned_employee_id = ?,
         local_employee_id = ?,
         admin_enabled = ?,
         idle_seconds = ?,
         pc_key = ?,
         last_seen_at = NOW()
     WHERE id = ?`,
    [
      keepMachineId,
      assigned,
      localId,
      adminOn ? 1 : 0,
      idle,
      pcKey,
      keep.id,
    ],
  );

  return others.length;
}

/** One-shot cleanup: merge all hostname+user groups that have duplicates. */
export async function purgeDuplicatePresenceAgents(): Promise<number> {
  await ensurePresenceAgentsTable();
  const [rows] = await pool.execute(
    `SELECT id, machine_id, hostname, windows_user
     FROM ${TABLE}
     WHERE hostname IS NOT NULL
     ORDER BY last_seen_at DESC, id DESC`,
  );
  const list = rows as {
    id: number;
    machine_id: string;
    hostname: string | null;
    windows_user: string | null;
  }[];
  const seen = new Set<string>();
  let removed = 0;
  for (const row of list) {
    const key = computePcKey(row.hostname, row.windows_user);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    removed += await mergeDuplicateAgentsForPc(
      row.hostname,
      row.windows_user,
      row.machine_id,
    );
  }
  return removed;
}

/** Delete every registered agent row (admin cleanup). */
export async function deleteAllPresenceAgents(): Promise<number> {
  await ensurePresenceAgentsTable();
  const [res] = await pool.execute(`DELETE FROM ${TABLE}`);
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

/** Delete one agent by machine_id. */
export async function deletePresenceAgent(machineId: string): Promise<boolean> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");
  const [res] = await pool.execute(`DELETE FROM ${TABLE} WHERE machine_id = ?`, [
    mid,
  ]);
  return ((res as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

export async function queueAgentCommand(input: {
  machineId?: string | null;
  all?: boolean;
  command: AgentCommand;
}): Promise<number> {
  await ensurePresenceAgentsTable();
  const cmd = input.command;
  const allowed: AgentCommand[] = ["restart", "exit", "start", "pause", "resume", "on"];
  if (!allowed.includes(cmd)) {
    throw new Error("invalid command");
  }
  const now = new Date();
  // Start/Stop for Guard = admin_enabled flip (do not rely on process exit — watchdog restarts)
  const adminFlip =
    cmd === "start" || cmd === "resume" || cmd === "on"
      ? 1
      : cmd === "pause"
        ? 0
        : null;
  const effectiveCmd = cmd === "start" ? "on" : cmd;

  if (input.all) {
    if (adminFlip !== null) {
      const [res] = await pool.execute(
        `UPDATE ${TABLE}
         SET pending_command = ?, command_issued_at = ?, admin_enabled = ?`,
        [effectiveCmd, now, adminFlip],
      );
      return (res as { affectedRows?: number }).affectedRows ?? 0;
    }
    const [res] = await pool.execute(
      `UPDATE ${TABLE} SET pending_command = ?, command_issued_at = ?`,
      [cmd, now],
    );
    return (res as { affectedRows?: number }).affectedRows ?? 0;
  }
  const mid = String(input.machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required unless all=true");
  if (adminFlip !== null) {
    const [res] = await pool.execute(
      `UPDATE ${TABLE}
       SET pending_command = ?, command_issued_at = ?, admin_enabled = ?
       WHERE machine_id = ?`,
      [effectiveCmd, now, adminFlip, mid],
    );
    const n = (res as { affectedRows?: number }).affectedRows ?? 0;
    if (n === 0) throw new Error("Agent not found");
    return n;
  }
  const [res] = await pool.execute(
    `UPDATE ${TABLE} SET pending_command = ?, command_issued_at = ? WHERE machine_id = ?`,
    [cmd, now, mid],
  );
  const n = (res as { affectedRows?: number }).affectedRows ?? 0;
  if (n === 0) throw new Error("Agent not found");
  return n;
}

export async function retireAllPresenceAgents(): Promise<{ queued: number }> {
  await savePresenceSettings({
    agentsRetired: true,
    presenceEnabled: false,
  });
  const queued = await queueAgentCommand({ all: true, command: "exit" });
  return { queued };
}

export async function activateAllPresenceAgents(): Promise<{ queued: number }> {
  await savePresenceSettings({
    agentsRetired: false,
    presenceEnabled: true,
  });
  const queued = await queueAgentCommand({ all: true, command: "restart" });
  return { queued };
}
