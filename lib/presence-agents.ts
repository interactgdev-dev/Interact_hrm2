import { pool } from "@/lib/db";

const TABLE = "presence_agents";

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
  lastIp: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  health: AgentHealth;
  assignedEmployeeName: string | null;
  assignedEmployeeCode: string | null;
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
  last_ip: string | null;
  first_seen_at: Date | string | null;
  last_seen_at: Date | string | null;
  assigned_first_name?: string | null;
  assigned_last_name?: string | null;
  assigned_employee_code?: string | null;
};

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
      last_ip varchar(45) DEFAULT NULL,
      first_seen_at datetime DEFAULT NULL,
      last_seen_at datetime DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT current_timestamp(),
      updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      UNIQUE KEY uq_presence_agents_machine (machine_id),
      KEY idx_presence_agents_last_seen (last_seen_at),
      KEY idx_presence_agents_assigned (assigned_employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
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
    lastIp: r.last_ip,
    firstSeenAt: toIso(r.first_seen_at),
    lastSeenAt: toIso(r.last_seen_at),
    health: agentHealthFromLastSeen(r.last_seen_at),
    assignedEmployeeName,
    assignedEmployeeCode: r.assigned_employee_code ?? null,
  };
}

export type HeartbeatInput = {
  machineId: string;
  hostname?: string | null;
  windowsUser?: string | null;
  hrmBaseUrl?: string | null;
  localEmployeeId?: string | null;
  agentVersion?: string | null;
  clientIp?: string | null;
};

export type HeartbeatResult = {
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
};

export async function upsertAgentHeartbeat(
  input: HeartbeatInput
): Promise<HeartbeatResult> {
  await ensurePresenceAgentsTable();
  const machineId = String(input.machineId ?? "").trim();
  if (!machineId || machineId.length > 128) {
    throw new Error("machine_id required");
  }

  const hostname = trimOrNull(input.hostname, 255);
  const windowsUser = trimOrNull(input.windowsUser, 255);
  const hrmBaseUrl = trimOrNull(input.hrmBaseUrl, 512);
  const localEmployeeId = trimOrNull(input.localEmployeeId, 64);
  const agentVersion = trimOrNull(input.agentVersion, 32);
  const lastIp = trimOrNull(input.clientIp, 45);
  const now = new Date();

  await pool.execute(
    `INSERT INTO ${TABLE}
      (machine_id, hostname, windows_user, hrm_base_url, local_employee_id, agent_version, last_ip, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       hostname = VALUES(hostname),
       windows_user = VALUES(windows_user),
       hrm_base_url = VALUES(hrm_base_url),
       local_employee_id = VALUES(local_employee_id),
       agent_version = VALUES(agent_version),
       last_ip = VALUES(last_ip),
       last_seen_at = VALUES(last_seen_at)`,
    [
      machineId,
      hostname,
      windowsUser,
      hrmBaseUrl,
      localEmployeeId,
      agentVersion,
      lastIp,
      now,
      now,
    ]
  );

  const [rows] = await pool.execute(
    `SELECT pa.assigned_employee_id,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name
     FROM ${TABLE} pa
     LEFT JOIN employees e ON e.id = pa.assigned_employee_id
     WHERE pa.machine_id = ?
     LIMIT 1`,
    [machineId]
  );
  const list = rows as {
    assigned_employee_id: string | null;
    assigned_first_name: string | null;
    assigned_last_name: string | null;
  }[];
  const row = list[0];
  const assignedEmployeeId = row?.assigned_employee_id?.trim() || null;
  const assignedEmployeeName =
    [row?.assigned_first_name, row?.assigned_last_name].filter(Boolean).join(" ").trim() ||
    null;
  return { assignedEmployeeId, assignedEmployeeName };
}

export async function listPresenceAgents(): Promise<PresenceAgentRow[]> {
  await ensurePresenceAgentsTable();
  const [rows] = await pool.execute(
    `SELECT pa.*,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name,
            e.employee_code AS assigned_employee_code
     FROM ${TABLE} pa
     LEFT JOIN employees e ON e.id = pa.assigned_employee_id
     ORDER BY pa.last_seen_at IS NULL, pa.last_seen_at DESC, pa.id DESC`
  );
  return (rows as DbRow[]).map(mapRow);
}

export async function setAgentAssignedEmployee(
  machineId: string,
  assignedEmployeeId: string | null
): Promise<PresenceAgentRow | null> {
  await ensurePresenceAgentsTable();
  const mid = String(machineId ?? "").trim();
  if (!mid) throw new Error("machine_id required");

  let assigned: string | null = assignedEmployeeId?.trim() || null;
  if (assigned) {
    const [empRows] = await pool.execute(
      "SELECT id FROM employees WHERE id = ? LIMIT 1",
      [assigned]
    );
    const emp = empRows as { id: number }[];
    if (!emp[0]) throw new Error("Employee not found");
  }

  await pool.execute(
    `UPDATE ${TABLE} SET assigned_employee_id = ? WHERE machine_id = ?`,
    [assigned, mid]
  );

  const [rows] = await pool.execute(
    `SELECT pa.*,
            e.first_name AS assigned_first_name,
            e.last_name AS assigned_last_name,
            e.employee_code AS assigned_employee_code
     FROM ${TABLE} pa
     LEFT JOIN employees e ON e.id = pa.assigned_employee_id
     WHERE pa.machine_id = ?
     LIMIT 1`,
    [mid]
  );
  const list = rows as DbRow[];
  return list[0] ? mapRow(list[0]) : null;
}

function trimOrNull(v: string | null | undefined, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}
