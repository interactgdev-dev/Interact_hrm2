import { getDbDriver, pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";
import {
  BASE_ROLES,
  DEFAULT_PERMISSIONS,
  FEATURE_MODULES,
  GLOBAL_FEATURES,
  orgDeptChipLabel,
  scopeLabelFromScope,
  type RoleDef,
} from "@/app/admin/roles-permissions/system-control-data";
import { normalizeOrgRole, ORG_ROLE_DB } from "@/lib/org-role";
import { permissionSetHas } from "@/lib/access-control/permission-scope";

export const ROLES_COLLECTION = "hrm_roles";
export const ROLE_PERMS_COLLECTION = "hrm_role_permissions";
export const GLOBAL_FEATURES_COLLECTION = "hrm_global_features";
export const EMPLOYEE_PERMS_COLLECTION = "hrm_employee_permissions";

export type AccessEmployee = {
  id: string;
  name: string;
  initials: string;
  pseudonym?: string;
  profilePhoto?: string;
  /** Effective primary role used for access (first explicit assign or legacy map). */
  roleId: string;
  /** Primary System Control assign; null = not assigned via Permissions tab. */
  accessRoleSlug: string | null;
  /** All System Control roles this employee is assigned to (multi-card org chart). */
  accessRoleSlugs: string[];
  departmentId: string;
  departmentName?: string;
  reportsTo: string | null;
  legacyRole?: string;
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

/**
 * Map Add Employee org role (+ optional department) → System Control role slug.
 * Used so Org Chart / Permissions reflect Team Lead, Manager, etc.
 */
export function mapLegacyEmployeeRole(
  role: unknown,
  departmentName?: string | null,
): string {
  const org = normalizeOrgRole(role);
  const chip = (orgDeptChipLabel(departmentName) || "").toLowerCase();

  if (org === ORG_ROLE_DB.CEO) return "exec_board";

  if (org === ORG_ROLE_DB.MANAGER) {
    if (chip === "it" || chip === "cest.") return "it_manager";
    if (chip === "finance") return "finance_manager";
    if (chip === "hr" || chip === "hit") return "hr_manager";
    if (chip === "dm") return "bd_sourcing";
    return "billing_ops_manager";
  }

  if (org === ORG_ROLE_DB.TEAM_LEAD) {
    if (chip === "it") return "team_lead_it";
    if (chip === "cest.") return "team_lead_cest";
    if (chip === "finance") return "team_lead_finance";
    if (chip === "hr") return "team_lead_hr";
    if (chip === "hit") return "team_lead_hit";
    if (chip === "dm") return "team_lead_dm";
    if (chip === "medical billing") return "team_lead_billing";
    return "team_lead_billing";
  }

  // Officer
  if (chip === "it" || chip === "cest.") return "helpdesk";
  if (chip === "finance") return "accountant_billing";
  if (chip === "hr" || chip === "hit") return "hr_coordinator";
  if (chip === "dm") return "data_analyst";
  return "helpdesk";
}

async function ensureMysqlTables() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${ROLES_COLLECTION} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        slug VARCHAR(64) NOT NULL,
        display_name VARCHAR(128) NOT NULL,
        description TEXT NULL,
        portal_type VARCHAR(64) NOT NULL DEFAULT 'employee-dashboard',
        data_scope VARCHAR(32) NOT NULL DEFAULT 'SELF',
        hierarchy_level INT NOT NULL DEFAULT 50,
        parent_slug VARCHAR(64) NULL,
        tier VARCHAR(32) NULL,
        accent VARCHAR(32) NULL,
        is_system TINYINT(1) NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_hrm_roles_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${ROLE_PERMS_COLLECTION} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        role_slug VARCHAR(64) NOT NULL,
        feature_key VARCHAR(128) NOT NULL,
        allowed TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_role_perm (role_slug, feature_key),
        KEY idx_role_slug (role_slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${GLOBAL_FEATURES_COLLECTION} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        feature_key VARCHAR(64) NOT NULL,
        display_name VARCHAR(128) NOT NULL,
        description TEXT NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_global_feature (feature_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${EMPLOYEE_PERMS_COLLECTION} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        employee_id VARCHAR(64) NOT NULL,
        feature_key VARCHAR(128) NOT NULL,
        allowed TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_emp_perm (employee_id, feature_key),
        KEY idx_emp_perm_employee (employee_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await conn.execute(
        `ALTER TABLE hrm_employees ADD COLUMN access_role_slug VARCHAR(64) NULL`,
      );
    } catch {
      /* column exists */
    }
    try {
      await conn.execute(
        `ALTER TABLE hrm_employees ADD COLUMN access_role_slugs JSON NULL`,
      );
    } catch {
      /* column exists */
    }
  } finally {
    conn.release();
  }
}

function parseAccessRoleSlugs(row: Record<string, unknown>): string[] {
  const raw = row.access_role_slugs;
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x || "").trim()).filter(Boolean);
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        list = parsed.map((x) => String(x || "").trim()).filter(Boolean);
      }
    } catch {
      list = raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  const primary =
    row.access_role_slug != null ? String(row.access_role_slug).trim() : "";
  if (primary && !list.includes(primary)) list = [primary, ...list];
  return [...new Set(list)];
}

/** True when System Control cleared assigns (`access_role_slugs = []`) — do not re-map from org role. */
function accessRolesIntentionallyCleared(row: Record<string, unknown>): boolean {
  const raw = row.access_role_slugs;
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "[]" || t === "") return true;
    try {
      const parsed = JSON.parse(t);
      return Array.isArray(parsed) && parsed.length === 0;
    } catch {
      return false;
    }
  }
  return false;
}

async function ensureMongoIndexes() {
  const db = await getMongoDb();
  await db.collection(ROLES_COLLECTION).createIndex({ slug: 1 }, { unique: true });
  await db
    .collection(ROLE_PERMS_COLLECTION)
    .createIndex({ role_slug: 1, feature_key: 1 }, { unique: true });
  await db
    .collection(GLOBAL_FEATURES_COLLECTION)
    .createIndex({ feature_key: 1 }, { unique: true });
  await db
    .collection(EMPLOYEE_PERMS_COLLECTION)
    .createIndex({ employee_id: 1, feature_key: 1 }, { unique: true });
}

async function nextId(collection: string): Promise<number> {
  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const last = await db
      .collection(collection)
      .find({ id: { $type: ["int", "long", "double"] } })
      .sort({ id: -1 })
      .limit(1)
      .toArray();
    return typeof last[0]?.id === "number" ? last[0].id + 1 : 1;
  }
  return 1;
}

async function seedIfEmpty() {
  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const roleCount = await db.collection(ROLES_COLLECTION).countDocuments();
    if (roleCount === 0) {
      let id = await nextId(ROLES_COLLECTION);
      const docs = BASE_ROLES.map((r) => ({
        id: id++,
        slug: r.id,
        display_name: r.name,
        description: r.description,
        portal_type: r.portal,
        data_scope: r.scope,
        hierarchy_level: r.hierarchyLevel,
        parent_slug: r.parentId ?? null,
        tier: r.tier ?? null,
        accent: r.accent ?? null,
        is_system: r.system ? 1 : 0,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      }));
      if (docs.length) await db.collection(ROLES_COLLECTION).insertMany(docs);
    }

    const permCount = await db.collection(ROLE_PERMS_COLLECTION).countDocuments();
    if (permCount === 0) {
      let pid = await nextId(ROLE_PERMS_COLLECTION);
      const perms: Record<string, unknown>[] = [];
      for (const [slug, set] of Object.entries(DEFAULT_PERMISSIONS)) {
        for (const key of set) {
          perms.push({
            id: pid++,
            role_slug: slug,
            feature_key: key,
            allowed: 1,
            created_at: new Date(),
          });
        }
      }
      if (perms.length) await db.collection(ROLE_PERMS_COLLECTION).insertMany(perms);
    }

    const featCount = await db.collection(GLOBAL_FEATURES_COLLECTION).countDocuments();
    if (featCount === 0) {
      let fid = await nextId(GLOBAL_FEATURES_COLLECTION);
      await db.collection(GLOBAL_FEATURES_COLLECTION).insertMany(
        GLOBAL_FEATURES.map((f) => ({
          id: fid++,
          feature_key: f.key,
          display_name: f.name,
          description: f.desc,
          is_enabled: f.on ? 1 : 0,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      );
    }
    return;
  }

  const [roleRows] = await pool.execute(`SELECT COUNT(*) AS c FROM ${ROLES_COLLECTION}`);
  const roleCount = Number((roleRows as any[])[0]?.c ?? 0);
  if (roleCount === 0) {
    for (const r of BASE_ROLES) {
      await pool.execute(
        `INSERT INTO ${ROLES_COLLECTION}
          (slug, display_name, description, portal_type, data_scope, hierarchy_level, parent_slug, tier, accent, is_system, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          r.id,
          r.name,
          r.description,
          r.portal,
          r.scope,
          r.hierarchyLevel,
          r.parentId ?? null,
          r.tier ?? null,
          r.accent ?? null,
          r.system ? 1 : 0,
        ],
      );
    }
  }

  const [permRows] = await pool.execute(`SELECT COUNT(*) AS c FROM ${ROLE_PERMS_COLLECTION}`);
  if (Number((permRows as any[])[0]?.c ?? 0) === 0) {
    for (const [slug, set] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const key of set) {
        await pool.execute(
          `INSERT INTO ${ROLE_PERMS_COLLECTION} (role_slug, feature_key, allowed) VALUES (?, ?, 1)`,
          [slug, key],
        );
      }
    }
  }

  const [featRows] = await pool.execute(
    `SELECT COUNT(*) AS c FROM ${GLOBAL_FEATURES_COLLECTION}`,
  );
  if (Number((featRows as any[])[0]?.c ?? 0) === 0) {
    for (const f of GLOBAL_FEATURES) {
      await pool.execute(
        `INSERT INTO ${GLOBAL_FEATURES_COLLECTION}
          (feature_key, display_name, description, is_enabled) VALUES (?, ?, ?, ?)`,
        [f.key, f.name, f.desc, f.on ? 1 : 0],
      );
    }
  }
}

export async function ensureAccessControlStore() {
  if (getDbDriver() === "mongo") {
    await ensureMongoIndexes();
  } else {
    await ensureMysqlTables();
  }
  await seedIfEmpty();
  await ensureMissingBaseRoles();
}

/** Insert any BASE_ROLES slugs that are missing (e.g. new per-dept Team Lead cards). */
async function ensureMissingBaseRoles() {
  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    for (const r of BASE_ROLES) {
      const exists = await db.collection(ROLES_COLLECTION).findOne({ slug: r.id });
      if (exists) {
        // Keep Team Lead display names current
        if (r.id.startsWith("team_lead_") || r.name.includes("Team Lead")) {
          await db.collection(ROLES_COLLECTION).updateOne(
            { slug: r.id },
            {
              $set: {
                display_name: r.name,
                parent_slug: r.parentId ?? null,
                tier: r.tier ?? null,
                updated_at: new Date(),
              },
            },
          );
        }
        continue;
      }
      const id = await nextId(ROLES_COLLECTION);
      await db.collection(ROLES_COLLECTION).insertOne({
        id,
        slug: r.id,
        display_name: r.name,
        description: r.description,
        portal_type: r.portal,
        data_scope: r.scope,
        hierarchy_level: r.hierarchyLevel,
        parent_slug: r.parentId ?? null,
        tier: r.tier ?? null,
        accent: r.accent ?? null,
        is_system: r.system ? 1 : 0,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const defaults = DEFAULT_PERMISSIONS[r.id];
      if (defaults) {
        let pid = await nextId(ROLE_PERMS_COLLECTION);
        for (const key of defaults) {
          await db.collection(ROLE_PERMS_COLLECTION).insertOne({
            id: pid++,
            role_slug: r.id,
            feature_key: key,
            allowed: 1,
            created_at: new Date(),
          });
        }
      }
    }
    return;
  }

  for (const r of BASE_ROLES) {
    const [existing] = await pool.execute(
      `SELECT slug FROM ${ROLES_COLLECTION} WHERE slug = ? LIMIT 1`,
      [r.id],
    );
    if ((existing as any[])?.length) {
      if (r.id.startsWith("team_lead_") || r.name.includes("Team Lead")) {
        await pool.execute(
          `UPDATE ${ROLES_COLLECTION}
           SET display_name = ?, parent_slug = ?, tier = ?, updated_at = CURRENT_TIMESTAMP
           WHERE slug = ?`,
          [r.name, r.parentId ?? null, r.tier ?? null, r.id],
        );
      }
      continue;
    }
    await pool.execute(
      `INSERT INTO ${ROLES_COLLECTION}
        (slug, display_name, description, portal_type, data_scope, hierarchy_level, parent_slug, tier, accent, is_system, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        r.id,
        r.name,
        r.description,
        r.portal,
        r.scope,
        r.hierarchyLevel,
        r.parentId ?? null,
        r.tier ?? null,
        r.accent ?? null,
        r.system ? 1 : 0,
      ],
    );
    const defaults = DEFAULT_PERMISSIONS[r.id];
    if (defaults) {
      for (const key of defaults) {
        await pool.execute(
          `INSERT IGNORE INTO ${ROLE_PERMS_COLLECTION} (role_slug, feature_key, allowed) VALUES (?, ?, 1)`,
          [r.id, key],
        );
      }
    }
  }
}

/**
 * After Add Employee / Edit sets overall org role (+ department), write
 * access_role_slug so Org Chart + Permissions Assigned list stay in sync.
 * Pass `clearOverrides: true` on explicit role set so TL/Manager/CEO inherit
 * role defaults (refine later in System Control → Permissions).
 */
export async function syncEmployeeAccessRoleFromOrg(
  employeeId: string | number,
  opts?: { clearOverrides?: boolean },
): Promise<string | null> {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) return null;

  const [rows] = await pool.execute(
    `SELECT e.role, d.name AS department_name
     FROM hrm_employees e
     LEFT JOIN employee_jobs j ON e.id = j.employee_id
     LEFT JOIN departments d ON j.department_id = d.id
     WHERE e.id = ?
     LIMIT 1`,
    [Number(eid)],
  );
  const row = (rows as { role?: string; department_name?: string }[])[0];
  if (!row) return null;

  const slug = mapLegacyEmployeeRole(row.role, row.department_name);
  if (!slug) return null;

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const numeric = Number(eid);
    await db.collection("hrm_employees").updateOne(
      { $or: [{ id: numeric }, { id: eid }, { id: String(numeric) }] },
      {
        $set: {
          access_role_slug: slug,
          access_role_slugs: [slug],
          updated_at: new Date(),
        },
      },
    );
  } else {
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = ?, access_role_slugs = ? WHERE id = ?`,
      [slug, JSON.stringify([slug]), Number(eid)],
    );
  }

  if (opts?.clearOverrides) {
    try {
      await saveEmployeePermissions(eid, null, { clear: true });
    } catch (err) {
      console.warn("clear employee overrides after org role sync:", err);
    }
  }
  return slug;
}

/**
 * Set Add Employee org role (Officer / Team Lead / Manager / CEO), map to
 * department-scoped System Control slug, and apply role default permissions.
 */
export async function setEmployeeOrgRole(
  employeeId: string | number,
  orgRole: unknown,
): Promise<string | null> {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) throw new Error("employeeId required");
  const role = normalizeOrgRole(orgRole);

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const numeric = Number(eid);
    const res = await db.collection("hrm_employees").updateOne(
      { $or: [{ id: numeric }, { id: eid }, { id: String(numeric) }] },
      { $set: { role, updated_at: new Date() } },
    );
    if (!res.matchedCount) throw new Error(`Employee ${eid} not found`);
  } else {
    const [result]: any = await pool.execute(
      `UPDATE hrm_employees SET role = ? WHERE id = ?`,
      [role, Number(eid)],
    );
    if (!result?.affectedRows) throw new Error(`Employee ${eid} not found`);
  }

  return syncEmployeeAccessRoleFromOrg(eid, { clearOverrides: true });
}

/** Unassign access roles + delete employee and related HR rows. */
export async function deleteHrmEmployeeCascade(employeeId: string | number): Promise<void> {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) throw new Error("employeeId required");
  const idParam = Number(eid);

  try {
    await saveEmployeePermissions(eid, null, { clear: true });
  } catch {
    /* ignore */
  }

  const tables = [
    "employee_contacts",
    "employee_emergency_contacts",
    "employee_jobs",
    "employee_salaries",
    "employee_attachments",
    "employee_attendance",
    "employee_breaks",
    "employee_leaves",
    "hrm_shifts_assignments",
    "prayer_breaks",
    EMPLOYEE_PERMS_COLLECTION,
  ];
  for (const table of tables) {
    try {
      await pool.execute(`DELETE FROM ${table} WHERE employee_id = ?`, [idParam]);
    } catch {
      /* table may not exist */
    }
  }

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    await db.collection("hrm_employees").deleteOne({
      $or: [{ id: idParam }, { id: eid }, { id: String(idParam) }],
    });
    return;
  }

  await pool.execute(`DELETE FROM hrm_employees WHERE id = ?`, [idParam]);
}

/** Fill / correct access_role_slug from Add Employee org role + department.
 *  Skips intentionally unassigned employees (`access_role_slugs = []`).
 *  Re-maps wrong auto slugs (e.g. Team Lead on billing instead of DM).
 */
export async function backfillMissingOrgAccessRoles(): Promise<number> {
  await ensureAccessControlStore();
  let updated = 0;
  try {
    const [rows] = await pool.execute(
      `SELECT e.id, e.role, e.access_role_slug, e.access_role_slugs, d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE e.role IS NOT NULL AND TRIM(e.role) <> ''`,
    );
    for (const r of rows as {
      id: number;
      role?: string;
      access_role_slug?: string | null;
      access_role_slugs?: unknown;
      department_name?: string | null;
    }[]) {
      if (accessRolesIntentionallyCleared(r as Record<string, unknown>)) continue;

      const expected = mapLegacyEmployeeRole(r.role, r.department_name);
      const current = String(r.access_role_slug || "").trim();
      if (current === expected) continue;

      // Don't overwrite multi-role manual System Control assigns
      const slugs = parseAccessRoleSlugs(r as Record<string, unknown>);
      if (slugs.length > 1) continue;

      const slug = await syncEmployeeAccessRoleFromOrg(r.id);
      if (slug) updated += 1;
    }
  } catch (err) {
    console.warn("backfillMissingOrgAccessRoles:", err);
  }
  return updated;
}

export async function loadPermissionMap(): Promise<Record<string, string[]>> {
  await ensureAccessControlStore();
  const out: Record<string, string[]> = {};
  for (const r of BASE_ROLES) out[r.id] = [];

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const rows = await db
      .collection(ROLE_PERMS_COLLECTION)
      .find({ allowed: { $in: [1, true, "1"] } })
      .toArray();
    for (const row of rows) {
      const slug = String(row.role_slug ?? "");
      const key = String(row.feature_key ?? "");
      if (!slug || !key) continue;
      if (!out[slug]) out[slug] = [];
      out[slug].push(key);
    }
    return out;
  }

  const [rows] = await pool.execute(
    `SELECT role_slug, feature_key FROM ${ROLE_PERMS_COLLECTION} WHERE allowed = 1`,
  );
  for (const row of rows as any[]) {
    const slug = String(row.role_slug ?? "");
    const key = String(row.feature_key ?? "");
    if (!slug || !key) continue;
    if (!out[slug]) out[slug] = [];
    out[slug].push(key);
  }
  return out;
}

export async function saveRolePermissions(roleSlug: string, keys: string[]) {
  await ensureAccessControlStore();
  const slug = String(roleSlug || "").trim();
  if (!slug) throw new Error("roleSlug required");
  const uniqueKeys = [...new Set(keys.map((k) => String(k).trim()).filter(Boolean))];

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    await db.collection(ROLE_PERMS_COLLECTION).deleteMany({ role_slug: slug });
    if (!uniqueKeys.length) return;
    let id = await nextId(ROLE_PERMS_COLLECTION);
    await db.collection(ROLE_PERMS_COLLECTION).insertMany(
      uniqueKeys.map((feature_key) => ({
        id: id++,
        role_slug: slug,
        feature_key,
        allowed: 1,
        created_at: new Date(),
      })),
    );
    return;
  }

  await pool.execute(`DELETE FROM ${ROLE_PERMS_COLLECTION} WHERE role_slug = ?`, [slug]);
  for (const key of uniqueKeys) {
    await pool.execute(
      `INSERT INTO ${ROLE_PERMS_COLLECTION} (role_slug, feature_key, allowed) VALUES (?, ?, 1)`,
      [slug, key],
    );
  }
}

export async function loadGlobalFeatures() {
  await ensureAccessControlStore();
  const defaults = GLOBAL_FEATURES.map((f) => ({ ...f }));

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const rows = await db.collection(GLOBAL_FEATURES_COLLECTION).find({}).toArray();
    const byKey = new Map(rows.map((r) => [String(r.feature_key), r]));
    return defaults.map((f) => {
      const row = byKey.get(f.key);
      if (!row) return f;
      return {
        ...f,
        name: String(row.display_name || f.name),
        desc: String(row.description || f.desc),
        on: row.is_enabled === true || row.is_enabled === 1 || row.is_enabled === "1",
      };
    });
  }

  const [rows] = await pool.execute(
    `SELECT feature_key, display_name, description, is_enabled FROM ${GLOBAL_FEATURES_COLLECTION}`,
  );
  const byKey = new Map((rows as any[]).map((r) => [String(r.feature_key), r]));
  return defaults.map((f) => {
    const row = byKey.get(f.key);
    if (!row) return f;
    return {
      ...f,
      name: String(row.display_name || f.name),
      desc: String(row.description || f.desc),
      on: Number(row.is_enabled) === 1,
    };
  });
}

export async function saveGlobalFeatures(
  features: { key: string; on: boolean; name?: string; desc?: string }[],
) {
  await ensureAccessControlStore();
  for (const f of features) {
    const key = String(f.key || "").trim();
    if (!key) continue;
    const meta = GLOBAL_FEATURES.find((g) => g.key === key);
    const name = f.name || meta?.name || key;
    const desc = f.desc || meta?.desc || "";
    const enabled = f.on ? 1 : 0;

    if (getDbDriver() === "mongo") {
      const db = await getMongoDb();
      const existing = await db.collection(GLOBAL_FEATURES_COLLECTION).findOne({ feature_key: key });
      if (existing) {
        await db.collection(GLOBAL_FEATURES_COLLECTION).updateOne(
          { feature_key: key },
          {
            $set: {
              display_name: name,
              description: desc,
              is_enabled: enabled,
              updated_at: new Date(),
            },
          },
        );
      } else {
        await db.collection(GLOBAL_FEATURES_COLLECTION).insertOne({
          id: await nextId(GLOBAL_FEATURES_COLLECTION),
          feature_key: key,
          display_name: name,
          description: desc,
          is_enabled: enabled,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
      continue;
    }

    await pool.execute(
      `INSERT INTO ${GLOBAL_FEATURES_COLLECTION} (feature_key, display_name, description, is_enabled)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description),
         is_enabled = VALUES(is_enabled)`,
      [key, name, desc, enabled],
    );
  }
}

export async function assignEmployeeRole(employeeId: string, roleSlug: string) {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  const slug = String(roleSlug || "").trim();
  if (!eid || !slug) throw new Error("employeeId and roleSlug required");

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const numeric = /^\d+$/.test(eid) ? Number(eid) : null;
    const filter =
      numeric != null
        ? { $or: [{ id: numeric }, { id: eid }, { id: String(numeric) }] }
        : { id: eid };
    const doc = await db.collection("hrm_employees").findOne(filter);
    if (!doc) throw new Error(`Employee ${eid} not found for role assign`);
    const slugs = parseAccessRoleSlugs(doc as Record<string, unknown>);
    if (!slugs.includes(slug)) slugs.push(slug);
    const primary = slugs[0] || slug;
    const res = await db.collection("hrm_employees").updateOne(filter, {
      $set: {
        access_role_slug: primary,
        access_role_slugs: slugs,
        updated_at: new Date(),
      },
    });
    if (!res.matchedCount) {
      throw new Error(`Employee ${eid} not found for role assign`);
    }
    return;
  }

  const idParam = /^\d+$/.test(eid) ? Number(eid) : eid;
  try {
    const [rows] = await pool.execute(
      `SELECT access_role_slug, access_role_slugs FROM hrm_employees WHERE id = ? LIMIT 1`,
      [idParam],
    );
    const row = (rows as any[])[0];
    if (!row) throw new Error(`Employee ${eid} not found for role assign`);
    const slugs = parseAccessRoleSlugs(row);
    if (!slugs.includes(slug)) slugs.push(slug);
    const primary = slugs[0] || slug;
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = ?, access_role_slugs = ? WHERE id = ?`,
      [primary, JSON.stringify(slugs), idParam],
    );
  } catch (err) {
    await ensureMysqlTables();
    const [rows] = await pool.execute(
      `SELECT access_role_slug, access_role_slugs FROM hrm_employees WHERE id = ? LIMIT 1`,
      [idParam],
    );
    const row = (rows as any[])[0];
    if (!row) throw new Error(`Employee ${eid} not found for role assign`);
    const slugs = parseAccessRoleSlugs(row);
    if (!slugs.includes(slug)) slugs.push(slug);
    const primary = slugs[0] || slug;
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = ?, access_role_slugs = ? WHERE id = ?`,
      [primary, JSON.stringify(slugs), idParam],
    );
  }
}

/** Remove one role from an employee (keeps other role cards). */
export async function unassignEmployeeFromRole(employeeId: string, roleSlug: string) {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  const slug = String(roleSlug || "").trim();
  if (!eid || !slug) throw new Error("employeeId and roleSlug required");

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const numeric = /^\d+$/.test(eid) ? Number(eid) : null;
    const filter =
      numeric != null
        ? { $or: [{ id: numeric }, { id: eid }, { id: String(numeric) }] }
        : { id: eid };
    const doc = await db.collection("hrm_employees").findOne(filter);
    if (!doc) throw new Error(`Employee ${eid} not found for role unassign`);
    const slugs = parseAccessRoleSlugs(doc as Record<string, unknown>).filter(
      (s) => s !== slug,
    );
    const primary = slugs[0] || null;
    // No remaining System Control roles → Edit Profile org role defaults to Officer
    const setDoc: Record<string, unknown> = {
      access_role_slug: primary,
      // Empty array = intentionally unassigned (backfill must not re-fill)
      access_role_slugs: slugs,
      updated_at: new Date(),
    };
    if (slugs.length === 0) {
      setDoc.role = ORG_ROLE_DB.OFFICER;
    }
    await db.collection("hrm_employees").updateOne(filter, { $set: setDoc });
    return;
  }

  const idParam = /^\d+$/.test(eid) ? Number(eid) : eid;
  const [rows] = await pool.execute(
    `SELECT access_role_slug, access_role_slugs FROM hrm_employees WHERE id = ? LIMIT 1`,
    [idParam],
  );
  const row = (rows as any[])[0];
  if (!row) throw new Error(`Employee ${eid} not found for role unassign`);
  const slugs = parseAccessRoleSlugs(row).filter((s) => s !== slug);
  const primary = slugs[0] || null;
  if (slugs.length === 0) {
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = ?, access_role_slugs = ?, role = ? WHERE id = ?`,
      [primary, JSON.stringify(slugs), ORG_ROLE_DB.OFFICER, idParam],
    );
  } else {
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = ?, access_role_slugs = ? WHERE id = ?`,
      [primary, JSON.stringify(slugs), idParam],
    );
  }
}

/** Clear System Control role assign (`access_role_slug` → null). */
export async function unassignEmployeeRole(employeeId: string) {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid) throw new Error("employeeId required");

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const numeric = /^\d+$/.test(eid) ? Number(eid) : null;
    const filter =
      numeric != null
        ? { $or: [{ id: numeric }, { id: eid }, { id: String(numeric) }] }
        : { id: eid };
    const res = await db.collection("hrm_employees").updateOne(filter, {
      $set: {
        access_role_slug: null,
        access_role_slugs: [],
        role: ORG_ROLE_DB.OFFICER,
        updated_at: new Date(),
      },
    });
    if (!res.matchedCount) {
      throw new Error(`Employee ${eid} not found for role unassign`);
    }
    return;
  }

  try {
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = NULL, access_role_slugs = ?, role = ? WHERE id = ?`,
      [JSON.stringify([]), ORG_ROLE_DB.OFFICER, eid],
    );
  } catch (err) {
    await ensureMysqlTables();
    await pool.execute(
      `UPDATE hrm_employees SET access_role_slug = NULL, access_role_slugs = ?, role = ? WHERE id = ?`,
      [JSON.stringify([]), ORG_ROLE_DB.OFFICER, eid],
    );
  }
}

export async function assignEmployeesToRole(employeeIds: string[], roleSlug: string) {
  const slug = String(roleSlug || "").trim();
  if (!slug) throw new Error("roleSlug required");
  const ids = [...new Set(employeeIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("employeeIds required");
  for (const id of ids) {
    await assignEmployeeRole(id, slug);
  }
  return ids.length;
}

export async function unassignEmployees(employeeIds: string[]) {
  const ids = [...new Set(employeeIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("employeeIds required");
  for (const id of ids) {
    await unassignEmployeeRole(id);
  }
  return ids.length;
}

export async function unassignEmployeesFromRole(employeeIds: string[], roleSlug: string) {
  const slug = String(roleSlug || "").trim();
  if (!slug) throw new Error("roleSlug required");
  const ids = [...new Set(employeeIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("employeeIds required");
  for (const id of ids) {
    await unassignEmployeeFromRole(id, slug);
  }
  return ids.length;
}

export async function loadAccessEmployees(): Promise<AccessEmployee[]> {
  await ensureAccessControlStore();

  let list: any[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.pseudonym, e.role, e.access_role_slug, e.access_role_slugs,
              d.name AS department_name, j.department_id
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       ORDER BY e.id ASC`,
    );
    list = (rows as any[]) || [];
  } catch {
    const [rows] = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.pseudonym, e.role, e.access_role_slug,
              d.name AS department_name, j.department_id
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       ORDER BY e.id ASC`,
    );
    list = (rows as any[]) || [];
  }

  return list.map((row) => {
    const id = String(row.id ?? "");
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || `Employee ${id}`;
    const legacyRole = row.role != null ? String(row.role) : "";
    const departmentName = row.department_name ? String(row.department_name) : undefined;
    const accessRoleSlugs = parseAccessRoleSlugs(row);
    const accessRoleSlug = accessRoleSlugs[0] || null;
    const cleared = accessRolesIntentionallyCleared(row);
    const roleId = cleared
      ? accessRoleSlug || ""
      : accessRoleSlug || mapLegacyEmployeeRole(legacyRole, departmentName);
    return {
      id,
      name,
      initials: initialsFromName(name),
      pseudonym: row.pseudonym ? String(row.pseudonym) : undefined,
      roleId,
      accessRoleSlug,
      accessRoleSlugs,
      departmentId: row.department_id != null ? String(row.department_id) : "",
      departmentName,
      reportsTo: null,
      legacyRole: legacyRole || undefined,
    };
  });
}

export function permissionCatalogKeys() {
  return FEATURE_MODULES.flatMap((m) => m.permissions.map((p) => p.key));
}

function docToRoleDef(row: Record<string, unknown>): RoleDef {
  const scope = String(row.data_scope || row.scope || "SELF");
  return {
    id: String(row.slug || row.id || ""),
    name: String(row.display_name || row.name || ""),
    description: String(row.description || ""),
    portal: String(row.portal_type || row.portal || "employee-dashboard"),
    scope,
    scopeLabel: scopeLabelFromScope(scope),
    hierarchyLevel: Number(row.hierarchy_level ?? 50),
    system: row.is_system === true || row.is_system === 1 || row.is_system === "1",
    parentId:
      row.parent_slug == null || row.parent_slug === ""
        ? null
        : String(row.parent_slug),
    tier: (row.tier as RoleDef["tier"]) || undefined,
    accent: row.accent != null ? String(row.accent) : undefined,
  };
}

/** Active org-chart roles from DB (Mongo/MySQL). */
export async function loadOrgRoles(): Promise<RoleDef[]> {
  await ensureAccessControlStore();

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const rows = await db
      .collection(ROLES_COLLECTION)
      .find({
        $or: [
          { is_active: { $in: [1, true, "1"] } },
          { is_active: { $exists: false } },
        ],
      })
      .toArray();
    const roles = rows
      .map((r) => docToRoleDef(r as Record<string, unknown>))
      .filter((r) => r.id && r.name);
    if (roles.length) {
      return roles.sort((a, b) => a.hierarchyLevel - b.hierarchyLevel);
    }
    return BASE_ROLES.map((r) => ({ ...r }));
  }

  const [rows] = await pool.execute(
    `SELECT slug, display_name, description, portal_type, data_scope, hierarchy_level,
            parent_slug, tier, accent, is_system
     FROM ${ROLES_COLLECTION}
     WHERE is_active = 1
     ORDER BY hierarchy_level ASC, slug ASC`,
  );
  const roles = (rows as any[])
    .map((r) => docToRoleDef(r))
    .filter((r: RoleDef) => r.id && r.name);
  if (roles.length) return roles;
  return BASE_ROLES.map((r) => ({ ...r }));
}

/** Persist full org-chart role tree. Missing roles are soft-deactivated. */
export async function saveOrgRoles(roles: RoleDef[]) {
  await ensureAccessControlStore();
  const list = roles
    .map((r) => ({
      ...r,
      id: String(r.id || "").trim(),
      name: String(r.name || "").trim(),
    }))
    .filter((r) => r.id && r.name);
  if (!list.length) throw new Error("At least one role required");

  const keep = new Set(list.map((r) => r.id));

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const col = db.collection(ROLES_COLLECTION);
    for (const r of list) {
      const existing = await col.findOne({ slug: r.id });
      const doc = {
        slug: r.id,
        display_name: r.name,
        description: r.description || "",
        portal_type: r.portal || "employee-dashboard",
        data_scope: r.scope || "SELF",
        hierarchy_level: Number(r.hierarchyLevel) || 50,
        parent_slug: r.parentId ?? null,
        tier: r.tier ?? null,
        accent: r.accent ?? null,
        is_system: r.system ? 1 : 0,
        is_active: 1,
        updated_at: new Date(),
      };
      if (existing) {
        await col.updateOne({ slug: r.id }, { $set: doc });
      } else {
        await col.insertOne({
          id: await nextId(ROLES_COLLECTION),
          ...doc,
          created_at: new Date(),
        });
      }
    }
    await col.updateMany(
      { slug: { $nin: [...keep] } },
      { $set: { is_active: 0, updated_at: new Date() } },
    );
    return;
  }

  for (const r of list) {
    await pool.execute(
      `INSERT INTO ${ROLES_COLLECTION}
        (slug, display_name, description, portal_type, data_scope, hierarchy_level,
         parent_slug, tier, accent, is_system, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         portal_type = VALUES(portal_type),
         data_scope = VALUES(data_scope),
         hierarchy_level = VALUES(hierarchy_level),
         parent_slug = VALUES(parent_slug),
         tier = VALUES(tier),
         accent = VALUES(accent),
         is_system = VALUES(is_system),
         is_active = 1`,
      [
        r.id,
        r.name,
        r.description || "",
        r.portal || "employee-dashboard",
        r.scope || "SELF",
        Number(r.hierarchyLevel) || 50,
        r.parentId ?? null,
        r.tier ?? null,
        r.accent ?? null,
        r.system ? 1 : 0,
      ],
    );
  }
  const placeholders = [...keep].map(() => "?").join(",");
  await pool.execute(
    `UPDATE ${ROLES_COLLECTION} SET is_active = 0 WHERE slug NOT IN (${placeholders})`,
    [...keep],
  );
}

/** Upsert catalog keys into global features without wiping existing toggles.
 * Team module is force-enabled so assigned team.* permissions always surface. */
export async function syncAccessControlCatalog() {
  await ensureAccessControlStore();

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    for (const f of GLOBAL_FEATURES) {
      const existing = await db
        .collection(GLOBAL_FEATURES_COLLECTION)
        .findOne({ feature_key: f.key });
      const forceOn = f.key === "team_lead_module";
      if (existing) {
        await db.collection(GLOBAL_FEATURES_COLLECTION).updateOne(
          { feature_key: f.key },
          {
            $set: {
              display_name: f.name,
              description: f.desc,
              updated_at: new Date(),
              ...(forceOn ? { is_enabled: 1 } : {}),
            },
          },
        );
      } else {
        await db.collection(GLOBAL_FEATURES_COLLECTION).insertOne({
          id: await nextId(GLOBAL_FEATURES_COLLECTION),
          feature_key: f.key,
          display_name: f.name,
          description: f.desc,
          is_enabled: forceOn || f.on ? 1 : 0,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
    return;
  }

  for (const f of GLOBAL_FEATURES) {
    const forceOn = f.key === "team_lead_module";
    if (forceOn) {
      await pool.execute(
        `INSERT INTO ${GLOBAL_FEATURES_COLLECTION}
          (feature_key, display_name, description, is_enabled)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           description = VALUES(description),
           is_enabled = 1`,
        [f.key, f.name, f.desc],
      );
    } else {
      await pool.execute(
        `INSERT INTO ${GLOBAL_FEATURES_COLLECTION}
          (feature_key, display_name, description, is_enabled)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           description = VALUES(description)`,
        [f.key, f.name, f.desc, f.on ? 1 : 0],
      );
    }
  }
}


export async function resolveEmployeeAccessRoleSlug(employeeId: string): Promise<{
  employeeId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  legacyRole: string;
  roleSlug: string;
  roleSlugs: string[];
}> {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid) throw new Error("employeeId required");

  const [rows] = await pool.query(
    `SELECT id, first_name, last_name, role, access_role_slug, access_role_slugs
     FROM hrm_employees
     WHERE id = ?
     LIMIT 1`,
    [/^\d+$/.test(eid) ? Number(eid) : eid],
  );
  let row = (rows as any[])[0];

  if (!row && getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const ids = /^\d+$/.test(eid) ? [Number(eid), eid] : [eid];
    row = await db.collection("hrm_employees").findOne({ id: { $in: ids } });
  }

  if (!row) throw new Error("Employee not found");

  const legacyRole = row.role != null ? String(row.role) : "";
  const roleSlugs = parseAccessRoleSlugs(row);
  const roleSlug = roleSlugs[0] || mapLegacyEmployeeRole(legacyRole);
  const firstName = row.first_name != null ? String(row.first_name).trim() : null;
  const lastName = row.last_name != null ? String(row.last_name).trim() : null;
  const name =
    [firstName, lastName].filter(Boolean).join(" ").trim() || `Employee ${eid}`;

  return {
    employeeId: String(row.id ?? eid),
    name,
    firstName,
    lastName,
    legacyRole,
    roleSlug,
    roleSlugs: roleSlugs.length ? roleSlugs : [roleSlug],
  };
}

export async function loadPermissionsForRole(roleSlug: string): Promise<string[]> {
  const map = await loadPermissionMap();
  const slug = String(roleSlug || "").trim();
  if (!slug) return [];
  if (slug === "exec_board") {
    // Board / locked role: full catalog
    return permissionCatalogKeys();
  }
  return [...(map[slug] || [])];
}

/** All employees that have custom permission overrides (full key lists). */
export async function loadAllEmployeePermissionOverrides(): Promise<
  Record<string, string[]>
> {
  await ensureAccessControlStore();
  const out: Record<string, string[]> = {};

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const rows = await db
      .collection(EMPLOYEE_PERMS_COLLECTION)
      .find({ allowed: { $in: [1, true, "1"] } })
      .toArray();
    for (const row of rows) {
      const eid = String(row.employee_id ?? "").trim();
      const key = String(row.feature_key ?? "").trim();
      if (!eid || !key || key === "__custom__") continue;
      if (!out[eid]) out[eid] = [];
      out[eid].push(key);
    }
    // Include employees who only have the __custom__ marker (empty custom set)
    const markers = await db
      .collection(EMPLOYEE_PERMS_COLLECTION)
      .find({ feature_key: "__custom__" })
      .toArray();
    for (const row of markers) {
      const eid = String(row.employee_id ?? "").trim();
      if (eid && out[eid] == null) out[eid] = [];
    }
    return out;
  }

  const [rows] = await pool.execute(
    `SELECT employee_id, feature_key FROM ${EMPLOYEE_PERMS_COLLECTION} WHERE allowed = 1`,
  );
  for (const row of rows as any[]) {
    const eid = String(row.employee_id ?? "").trim();
    const key = String(row.feature_key ?? "").trim();
    if (!eid || !key) continue;
    if (!out[eid]) out[eid] = [];
    out[eid].push(key);
  }
  return out;
}

export async function loadEmployeePermissionOverrides(
  employeeId: string,
): Promise<string[] | null> {
  const eid = String(employeeId || "").trim();
  if (!eid) return null;
  await ensureAccessControlStore();

  const idVariants: Array<string | number> = [eid];
  if (/^\d+$/.test(eid)) idVariants.push(Number(eid));

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const rows = await db
      .collection(EMPLOYEE_PERMS_COLLECTION)
      .find({ employee_id: { $in: idVariants } })
      .toArray();
    if (!rows.length) return null;
    return rows
      .filter((r) => r.allowed === true || r.allowed === 1 || r.allowed === "1")
      .map((r) => String(r.feature_key || ""))
      .filter((k) => k && k !== "__custom__");
  }

  const placeholders = idVariants.map(() => "?").join(",");
  const [anyRows] = await pool.execute(
    `SELECT COUNT(*) AS c FROM ${EMPLOYEE_PERMS_COLLECTION} WHERE employee_id IN (${placeholders})`,
    idVariants.map(String),
  );
  if (Number((anyRows as any[])[0]?.c ?? 0) === 0) return null;

  const [rows] = await pool.execute(
    `SELECT feature_key FROM ${EMPLOYEE_PERMS_COLLECTION}
     WHERE employee_id IN (${placeholders}) AND allowed = 1 AND feature_key <> '__custom__'`,
    idVariants.map(String),
  );
  return (rows as any[]).map((r) => String(r.feature_key)).filter(Boolean);
}

/**
 * Replace employee custom permission set.
 * Pass `null` / empty with clear=true to delete overrides (fall back to role).
 */
export async function saveEmployeePermissions(
  employeeId: string,
  keys: string[] | null,
  opts?: { clear?: boolean },
) {
  await ensureAccessControlStore();
  const eid = String(employeeId || "").trim();
  if (!eid) throw new Error("employeeId required");

  const clear = opts?.clear === true || keys == null;
  const uniqueKeys = clear
    ? []
    : [...new Set((keys || []).map((k) => String(k).trim()).filter(Boolean))];

  if (getDbDriver() === "mongo") {
    const db = await getMongoDb();
    const idFilter = {
      $or: [
        { employee_id: eid },
        ...( /^\d+$/.test(eid) ? [{ employee_id: Number(eid) }, { employee_id: String(Number(eid)) }] : []),
      ],
    };
    await db.collection(EMPLOYEE_PERMS_COLLECTION).deleteMany(idFilter);
    if (clear || !uniqueKeys.length) {
      // Empty custom set: store a sentinel so we know overrides exist with zero grants?
      // Prefer: clear means delete all → fall back to role. Empty array after edit with no checks:
      // treat as custom empty (user intentionally has no perms).
      if (clear) return;
      // Save a marker row? Simpler: insert nothing and use a `_custom` flag doc
      await db.collection(EMPLOYEE_PERMS_COLLECTION).insertOne({
        id: await nextId(EMPLOYEE_PERMS_COLLECTION),
        employee_id: eid,
        feature_key: "__custom__",
        allowed: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return;
    }
    let id = await nextId(EMPLOYEE_PERMS_COLLECTION);
    await db.collection(EMPLOYEE_PERMS_COLLECTION).insertMany(
      uniqueKeys.map((feature_key) => ({
        id: id++,
        employee_id: eid,
        feature_key,
        allowed: 1,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );
    return;
  }

  await pool.execute(`DELETE FROM ${EMPLOYEE_PERMS_COLLECTION} WHERE employee_id = ?`, [eid]);
  if (clear) return;
  if (!uniqueKeys.length) {
    await pool.execute(
      `INSERT INTO ${EMPLOYEE_PERMS_COLLECTION} (employee_id, feature_key, allowed) VALUES (?, '__custom__', 0)`,
      [eid],
    );
    return;
  }
  for (const key of uniqueKeys) {
    await pool.execute(
      `INSERT INTO ${EMPLOYEE_PERMS_COLLECTION} (employee_id, feature_key, allowed) VALUES (?, ?, 1)`,
      [eid, key],
    );
  }
}

export async function getEmployeeAccessPayload(employeeId: string) {
  const emp = await resolveEmployeeAccessRoleSlug(employeeId);
  const [features, roles, empOverride] = await Promise.all([
    loadGlobalFeatures(),
    loadOrgRoles(),
    loadEmployeePermissionOverrides(emp.employeeId),
  ]);

  let deptName: string | null = null;
  try {
    const [deptRows] = await pool.execute(
      `SELECT d.name AS department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE e.id = ?
       LIMIT 1`,
      [/^\d+$/.test(emp.employeeId) ? Number(emp.employeeId) : emp.employeeId],
    );
    const drow = (deptRows as { department_name?: string }[])[0];
    deptName = drow?.department_name ? String(drow.department_name) : null;
  } catch {
    deptName = null;
  }

  const rolePermSets = await Promise.all(
    emp.roleSlugs.map((slug) => loadPermissionsForRole(slug)),
  );
  const rolePermissions = [...new Set(rolePermSets.flat())];

  // Custom employee set replaces role defaults; otherwise union of all assigned roles.
  const basePermissions =
    empOverride != null
      ? empOverride.filter((k) => k !== "__custom__")
      : rolePermissions;

  const {
    mergeHrAccessPermissions,
    accessFeatureFlagsFrom,
  } = await import("@/lib/access-control/hr-access");
  const { isManagerOrgRole } = await import("@/lib/org-role");
  const accessFlags = accessFeatureFlagsFrom(features);
  const permissions = mergeHrAccessPermissions({
    permissions: basePermissions,
    departmentName: deptName,
    orgRole: emp.legacyRole,
    accessRoleSlugs: emp.roleSlugs,
    firstName: emp.firstName,
    lastName: emp.lastName,
    hrDepartmentDefaultsEnabled: accessFlags.hrDepartmentDefaultsEnabled,
    allEmployeeDashboardEnabled: accessFlags.allEmployeeDashboardEnabled,
  });

  const enabledFeatures: Record<string, boolean> = {};
  for (const f of features) enabledFeatures[f.key] = Boolean(f.on);

  const { buildMenuFromPermissions } = await import("./menu-registry");
  const menu = buildMenuFromPermissions(permissions, enabledFeatures);
  const roleMetaRow =
    roles.find((r) => r.id === emp.roleSlug) ||
    BASE_ROLES.find((r) => r.id === emp.roleSlug);

  const manager = isManagerOrgRole(emp.legacyRole);
  const portalType = accessFlags.allEmployeeDashboardEnabled
    ? "employee-dashboard"
    : roleMetaRow?.portal || "employee-dashboard";

  return {
    employeeId: emp.employeeId,
    name: emp.name,
    legacyRole: emp.legacyRole,
    departmentName: deptName,
    role: {
      slug: emp.roleSlug,
      slugs: emp.roleSlugs,
      display_name: roleMetaRow?.name || emp.roleSlug,
      portal_type: portalType,
      data_scope: roleMetaRow?.scope || "SELF",
    },
    permissions,
    permission_source: empOverride != null ? "employee" : "role",
    role_permissions: rolePermissions,
    features_enabled: features.filter((f) => f.on).map((f) => f.key),
    features,
    menu,
    capabilities: {
      // System Control: Managers only (permission + org role)
      systemControlOpen:
        manager && permissionSetHas(permissions, "system.control.access"),
      systemPermissionsEdit:
        manager && permissionSetHas(permissions, "system.permissions.edit"),
      systemUsersAssign: manager && permissionSetHas(permissions, "system.users.assign"),
      systemOrgChartEdit: manager && permissionSetHas(permissions, "system.org_chart.edit"),
      systemFeaturesEdit:
        manager &&
        (permissionSetHas(permissions, "system.features.edit") ||
          permissionSetHas(permissions, "system.permissions.edit")),
    },
  };
}
