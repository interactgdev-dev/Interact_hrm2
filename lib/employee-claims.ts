import { query } from "@/lib/db";
import {
  medicalIpdEntitlementForPackage,
  medicalOpdEntitlement,
  normalizeMedicalPackage,
  type MedicalPackageId,
} from "@/lib/medical-package";

/** opd = pharmacy/medicine; ipd = hospital admit; medical = legacy alias of opd. */
export type ClaimType = "opd" | "ipd" | "medical" | "travel" | "other";
export type ClaimStatus =
  | "pending"
  | "approved"
  | "unpaid"
  | "rejected"
  | "paid"
  | "cancelled";

export type EmployeeClaim = {
  id: number;
  employee_id: number;
  claim_year: string;
  claim_type: ClaimType;
  title: string | null;
  amount: number;
  claim_date: string;
  status: ClaimStatus;
  notes: string | null;
  receipt_path: string | null;
  created_by: string | null;
  created_by_employee_id: number | null;
  approved_by_employee_id: number | null;
  approved_at: string | null;
  payroll_month: string | null;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  pseudonym?: string | null;
  department_name?: string | null;
};

export type ClaimBalance = {
  employee_id: number;
  year: string;
  claim_type: ClaimType;
  medical_package: MedicalPackageId | null;
  entitlement: number;
  entitlement_source: "package" | "override" | "none" | "policy";
  used: number;
  pending: number;
  remaining: number;
  claims_count: number;
};

const COUNTS_AS_USED: ClaimStatus[] = ["approved", "unpaid", "paid"];
const COUNTS_AS_PENDING: ClaimStatus[] = ["pending"];

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function yearOrCurrent(raw?: string | null): string {
  if (raw && /^\d{4}$/.test(raw)) return raw;
  return String(new Date().getFullYear());
}

export function normalizeClaimType(raw: unknown): ClaimType {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "ipd") return "ipd";
  if (v === "travel" || v === "other") return v;
  if (v === "medical") return "medical";
  return "opd";
}

/** Pool key used for entitlement / usage (legacy medical → opd). */
export function claimBalancePool(type: ClaimType): "opd" | "ipd" | "travel" | "other" {
  if (type === "ipd") return "ipd";
  if (type === "travel") return "travel";
  if (type === "other") return "other";
  return "opd";
}

export function normalizeClaimStatus(raw: unknown): ClaimStatus {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (
    v === "pending" ||
    v === "approved" ||
    v === "unpaid" ||
    v === "rejected" ||
    v === "paid" ||
    v === "cancelled"
  ) {
    return v;
  }
  return "approved";
}

/** @deprecated Use medicalOpdEntitlement / medicalIpdEntitlementForPackage. */
export function yearlyEntitlementFromPackage(
  pkg: MedicalPackageId | null | undefined,
): number {
  return medicalIpdEntitlementForPackage(pkg);
}

function usageTypesForPool(pool: "opd" | "ipd" | "travel" | "other"): string[] {
  if (pool === "opd") return ["opd", "medical"];
  return [pool];
}

async function ensureClaimsTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS employee_claims (
      id int(11) NOT NULL AUTO_INCREMENT,
      employee_id int(11) NOT NULL,
      claim_year varchar(4) NOT NULL,
      claim_type varchar(40) NOT NULL DEFAULT 'medical',
      title varchar(255) DEFAULT NULL,
      amount decimal(12,2) NOT NULL,
      claim_date date NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'approved',
      notes varchar(500) DEFAULT NULL,
      receipt_path varchar(512) DEFAULT NULL,
      created_by varchar(100) DEFAULT NULL,
      created_by_employee_id int(11) DEFAULT NULL,
      approved_by_employee_id int(11) DEFAULT NULL,
      approved_at datetime DEFAULT NULL,
      payroll_month varchar(7) DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT current_timestamp(),
      updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      KEY idx_claims_employee_year (employee_id, claim_year),
      KEY idx_claims_status (status),
      KEY idx_claims_date (claim_date),
      KEY idx_claims_type (claim_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS employee_claim_entitlements (
      id int(11) NOT NULL AUTO_INCREMENT,
      employee_id int(11) NOT NULL,
      claim_year varchar(4) NOT NULL,
      claim_type varchar(40) NOT NULL DEFAULT 'medical',
      entitlement_amount decimal(12,2) NOT NULL,
      notes varchar(255) DEFAULT NULL,
      updated_by varchar(100) DEFAULT NULL,
      created_at timestamp NOT NULL DEFAULT current_timestamp(),
      updated_at timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      UNIQUE KEY uq_entitlement_emp_year_type (employee_id, claim_year, claim_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

export async function getEmployeeMedicalPackage(
  employeeId: number,
): Promise<MedicalPackageId | null> {
  try {
    const [rows]: any = await query(
      `SELECT medical_package FROM employee_salaries
       WHERE employee_id = ?
       ORDER BY id DESC LIMIT 1`,
      [employeeId],
    );
    const list = Array.isArray(rows) ? rows : [];
    return normalizeMedicalPackage(list[0]?.medical_package);
  } catch (err) {
    // Column may be missing if migration 049 not applied yet — OPD still works.
    console.warn("[claims] medical_package lookup failed:", err);
    return null;
  }
}

async function getEntitlementOverride(
  employeeId: number,
  year: string,
  claimType: ClaimType,
): Promise<number | null> {
  const [rows]: any = await query(
    `SELECT entitlement_amount FROM employee_claim_entitlements
     WHERE employee_id = ? AND claim_year = ? AND claim_type = ?
     LIMIT 1`,
    [employeeId, year, claimType],
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  return money(list[0].entitlement_amount);
}

export async function resolveClaimBalance(input: {
  employeeId: number;
  year?: string;
  claimType?: ClaimType;
}): Promise<ClaimBalance> {
  await ensureClaimsTables();
  const year = yearOrCurrent(input.year);
  const claimType = normalizeClaimType(input.claimType || "opd");
  const pool = claimBalancePool(claimType);
  const employeeId = Number(input.employeeId);

  const override = await getEntitlementOverride(
    employeeId,
    year,
    pool === "opd" ? "opd" : claimType,
  );
  const pkg = await getEmployeeMedicalPackage(employeeId);

  let entitlement = 0;
  let entitlement_source: ClaimBalance["entitlement_source"] = "none";
  if (override != null) {
    entitlement = override;
    entitlement_source = "override";
  } else if (pool === "opd") {
    // All employees get fixed OPD pool (150k), independent of package.
    entitlement = medicalOpdEntitlement();
    entitlement_source = "policy";
  } else if (pool === "ipd") {
    entitlement = medicalIpdEntitlementForPackage(pkg);
    entitlement_source = pkg ? "package" : "none";
  }

  const types = usageTypesForPool(pool);
  const placeholders = types.map(() => "?").join(",");
  const [rows]: any = await query(
    `SELECT status, amount FROM employee_claims
     WHERE employee_id = ? AND claim_year = ? AND claim_type IN (${placeholders})
       AND status NOT IN ('cancelled','rejected')`,
    [employeeId, year, ...types],
  );
  const list = Array.isArray(rows) ? rows : [];
  let used = 0;
  let pending = 0;
  for (const r of list) {
    const st = normalizeClaimStatus(r.status);
    const amt = money(r.amount);
    if (COUNTS_AS_USED.includes(st)) used += amt;
    else if (COUNTS_AS_PENDING.includes(st)) pending += amt;
  }

  const remaining = Math.max(0, Math.round((entitlement - used) * 100) / 100);

  return {
    employee_id: employeeId,
    year,
    claim_type: pool === "opd" ? "opd" : claimType,
    medical_package: pkg,
    entitlement,
    entitlement_source,
    used: Math.round(used * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    remaining,
    claims_count: list.length,
  };
}

/** OPD + IPD balances for an employee (package-aware). */
export async function resolveMedicalClaimBalances(input: {
  employeeId: number;
  year?: string;
}): Promise<{
  year: string;
  medical_package: MedicalPackageId | null;
  opd: ClaimBalance;
  ipd: ClaimBalance;
}> {
  const year = yearOrCurrent(input.year);
  const [opd, ipd] = await Promise.all([
    resolveClaimBalance({
      employeeId: input.employeeId,
      year,
      claimType: "opd",
    }),
    resolveClaimBalance({
      employeeId: input.employeeId,
      year,
      claimType: "ipd",
    }),
  ]);
  return {
    year,
    medical_package: opd.medical_package ?? ipd.medical_package,
    opd,
    ipd,
  };
}

function mapClaimRow(r: any): EmployeeClaim {
  const nameFromJoin = String(r.employee_name || r.emp_full_name || "")
    .replace(/\s+/g, " ")
    .trim();
  const pseudo = r.emp_pseudonym ?? r.pseudonym ?? null;
  const dept = r.emp_department_name ?? r.department_name ?? null;
  return {
    id: Number(r.id),
    employee_id: Number(r.employee_id),
    claim_year: String(r.claim_year || ""),
    claim_type: normalizeClaimType(r.claim_type),
    title: r.title ?? null,
    amount: money(r.amount),
    claim_date: String(r.claim_date || "").slice(0, 10),
    status: normalizeClaimStatus(r.status),
    notes: r.notes ?? null,
    receipt_path: r.receipt_path ?? null,
    created_by: r.created_by ?? null,
    created_by_employee_id:
      r.created_by_employee_id != null ? Number(r.created_by_employee_id) : null,
    approved_by_employee_id:
      r.approved_by_employee_id != null
        ? Number(r.approved_by_employee_id)
        : null,
    approved_at: r.approved_at ? String(r.approved_at) : null,
    payroll_month: r.payroll_month ?? null,
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
    employee_name: nameFromJoin || undefined,
    pseudonym: pseudo != null && String(pseudo).trim() ? String(pseudo).trim() : null,
    department_name:
      dept != null && String(dept).trim() ? String(dept).trim() : null,
  };
}

async function loadEmployeeMetaByIds(
  ids: number[],
): Promise<
  Record<
    string,
    { employee_name: string; pseudonym: string | null; department_name: string | null }
  >
> {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return {};
  const placeholders = uniq.map(() => "?").join(",");
  try {
    // Same shape as /api/employee-list (pseudonym column = pseudo name; no middle_name).
    const result: any = await query(
      `SELECT e.id,
          TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) AS employee_name,
          e.pseudonym AS emp_pseudonym,
          d.name AS emp_department_name
       FROM hrm_employees e
       LEFT JOIN employee_jobs j ON e.id = j.employee_id
       LEFT JOIN departments d ON j.department_id = d.id
       WHERE e.id IN (${placeholders})`,
      uniq,
    );
    const rows: any[] = Array.isArray(result?.[0])
      ? result[0]
      : Array.isArray(result)
        ? result
        : [];
    const out: Record<
      string,
      { employee_name: string; pseudonym: string | null; department_name: string | null }
    > = {};
    for (const r of rows) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      out[id] = {
        employee_name: String(r.employee_name || "")
          .replace(/\s+/g, " ")
          .trim(),
        pseudonym:
          r.emp_pseudonym != null && String(r.emp_pseudonym).trim()
            ? String(r.emp_pseudonym).trim()
            : null,
        department_name:
          r.emp_department_name != null && String(r.emp_department_name).trim()
            ? String(r.emp_department_name).trim()
            : null,
      };
    }
    return out;
  } catch (err) {
    console.warn("[claims] employee meta lookup failed:", err);
    return {};
  }
}

function applyEmployeeMeta(
  claim: EmployeeClaim,
  meta: Record<
    string,
    { employee_name: string; pseudonym: string | null; department_name: string | null }
  >,
): EmployeeClaim {
  const m = meta[String(claim.employee_id)];
  if (!m) return claim;
  return {
    ...claim,
    employee_name: m.employee_name || claim.employee_name,
    pseudonym: m.pseudonym ?? claim.pseudonym,
    department_name: m.department_name ?? claim.department_name,
  };
}

export async function listClaims(input?: {
  year?: string;
  employeeId?: number | null;
  status?: string | null;
  claimType?: string | null;
}): Promise<EmployeeClaim[]> {
  await ensureClaimsTables();
  const year = yearOrCurrent(input?.year);
  const params: any[] = [year];
  // Explicit claim columns + aliased employee fields (avoid c.* / middle_name issues).
  let sql = `
    SELECT
      c.id, c.employee_id, c.claim_year, c.claim_type, c.title, c.amount,
      c.claim_date, c.status, c.notes, c.receipt_path, c.created_by,
      c.created_by_employee_id, c.approved_by_employee_id, c.approved_at,
      c.payroll_month, c.created_at, c.updated_at,
      TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) AS emp_full_name,
      e.pseudonym AS emp_pseudonym,
      d.name AS emp_department_name
    FROM employee_claims c
    LEFT JOIN hrm_employees e ON e.id = c.employee_id
    LEFT JOIN employee_jobs j ON e.id = j.employee_id
    LEFT JOIN departments d ON j.department_id = d.id
    WHERE c.claim_year = ?
  `;
  if (input?.employeeId != null && Number.isFinite(input.employeeId)) {
    sql += ` AND c.employee_id = ?`;
    params.push(Number(input.employeeId));
  }
  if (input?.status) {
    sql += ` AND c.status = ?`;
    params.push(normalizeClaimStatus(input.status));
  }
  if (input?.claimType) {
    sql += ` AND c.claim_type = ?`;
    params.push(normalizeClaimType(input.claimType));
  }
  sql += ` ORDER BY c.claim_date DESC, c.id DESC`;

  const result: any = await query(sql, params);
  const rows: any[] = Array.isArray(result?.[0])
    ? result[0]
    : Array.isArray(result)
      ? result
      : [];
  let claims = rows.map(mapClaimRow);

  const missing = claims.filter(
    (c) => !c.employee_name || !c.department_name || c.pseudonym == null,
  );
  if (missing.length) {
    const meta = await loadEmployeeMetaByIds(missing.map((c) => c.employee_id));
    claims = claims.map((c) => applyEmployeeMeta(c, meta));
  }
  return claims;
}

export async function createClaim(input: {
  employeeId: number;
  amount: number;
  claimDate?: string;
  claimType?: ClaimType;
  title?: string | null;
  notes?: string | null;
  status?: ClaimStatus;
  createdBy?: string | null;
  createdByEmployeeId?: number | null;
  allowOverBalance?: boolean;
}): Promise<{ claim: EmployeeClaim; balance: ClaimBalance }> {
  await ensureClaimsTables();
  const employeeId = Number(input.employeeId);
  const amount = money(input.amount);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Error("employee_id required");
  }
  if (!(amount > 0)) throw new Error("amount must be greater than 0");

  const claimDate = (input.claimDate || new Date().toISOString().slice(0, 10)).slice(
    0,
    10,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(claimDate)) {
    throw new Error("claim_date must be YYYY-MM-DD");
  }
  const claimYear = claimDate.slice(0, 4);
  const claimType = normalizeClaimType(input.claimType || "opd");
  const status = normalizeClaimStatus(input.status || "approved");

  const balance = await resolveClaimBalance({
    employeeId,
    year: claimYear,
    claimType,
  });

  if (
    !input.allowOverBalance &&
    COUNTS_AS_USED.includes(status) &&
    amount > balance.remaining + 0.001
  ) {
    throw new Error(
      `Amount exceeds remaining balance (${balance.remaining.toLocaleString()}).`,
    );
  }

  const approvedAt =
    status === "approved" || status === "paid" || status === "unpaid"
      ? new Date().toISOString().slice(0, 19).replace("T", " ")
      : null;
  const payrollMonth = claimDate.slice(0, 7);

  const [result]: any = await query(
    `INSERT INTO employee_claims
      (employee_id, claim_year, claim_type, title, amount, claim_date, status, notes,
       created_by, created_by_employee_id, approved_by_employee_id, approved_at, payroll_month)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId,
      claimYear,
      claimType,
      input.title?.trim() || null,
      amount,
      claimDate,
      status,
      input.notes?.trim() || null,
      input.createdBy?.trim() || null,
      input.createdByEmployeeId ?? null,
      approvedAt && input.createdByEmployeeId ? input.createdByEmployeeId : null,
      approvedAt,
      payrollMonth,
    ],
  );

  const insertId = Number(result?.insertId || 0);
  const rows = await listClaims({ year: claimYear, employeeId });
  const claim = rows.find((c) => c.id === insertId) || rows[0];
  if (!claim) throw new Error("Claim created but could not reload");

  const nextBalance = await resolveClaimBalance({
    employeeId,
    year: claimYear,
    claimType,
  });

  try {
    await syncEmployeeClaimsToPayrollAdjustment(employeeId, payrollMonth);
  } catch (err) {
    console.warn("[claims] payroll sync after create failed:", err);
  }

  return { claim, balance: nextBalance };
}

export async function getClaimById(id: number): Promise<EmployeeClaim | null> {
  await ensureClaimsTables();
  const result: any = await query(
    `SELECT
      c.id, c.employee_id, c.claim_year, c.claim_type, c.title, c.amount,
      c.claim_date, c.status, c.notes, c.receipt_path, c.created_by,
      c.created_by_employee_id, c.approved_by_employee_id, c.approved_at,
      c.payroll_month, c.created_at, c.updated_at,
      TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) AS emp_full_name,
      e.pseudonym AS emp_pseudonym,
      d.name AS emp_department_name
     FROM employee_claims c
     LEFT JOIN hrm_employees e ON e.id = c.employee_id
     LEFT JOIN employee_jobs j ON e.id = j.employee_id
     LEFT JOIN departments d ON j.department_id = d.id
     WHERE c.id = ? LIMIT 1`,
    [Number(id)],
  );
  const list: any[] = Array.isArray(result?.[0])
    ? result[0]
    : Array.isArray(result)
      ? result
      : [];
  if (!list.length) return null;
  let claim = mapClaimRow(list[0]);
  if (!claim.employee_name || !claim.department_name || claim.pseudonym == null) {
    const meta = await loadEmployeeMetaByIds([claim.employee_id]);
    claim = applyEmployeeMeta(claim, meta);
  }
  return claim;
}

export async function updateClaimStatus(input: {
  id: number;
  status: ClaimStatus;
  notes?: string | null;
  approvedByEmployeeId?: number | null;
}): Promise<EmployeeClaim> {
  await ensureClaimsTables();
  const id = Number(input.id);
  const status = normalizeClaimStatus(input.status);
  const approvedAt =
    status === "approved" || status === "paid" || status === "unpaid"
      ? new Date().toISOString().slice(0, 19).replace("T", " ")
      : null;

  await query(
    `UPDATE employee_claims
     SET status = ?,
         notes = COALESCE(?, notes),
         approved_by_employee_id = COALESCE(?, approved_by_employee_id),
         approved_at = COALESCE(?, approved_at),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      status,
      input.notes?.trim() || null,
      input.approvedByEmployeeId ?? null,
      approvedAt,
      id,
    ],
  );

  const claim = await getClaimById(id);
  if (!claim) throw new Error("Claim not found");

  const month =
    claim.payroll_month ||
    (claim.claim_date ? claim.claim_date.slice(0, 7) : "");
  if (month) {
    try {
      await syncEmployeeClaimsToPayrollAdjustment(claim.employee_id, month);
    } catch (err) {
      console.warn("[claims] payroll sync after status update failed:", err);
    }
  }

  return claim;
}

/** Bulk status update (e.g. finance Mark as Paid for several approved claims). */
export async function bulkUpdateClaimStatus(input: {
  ids: number[];
  status: ClaimStatus;
  notes?: string | null;
  approvedByEmployeeId?: number | null;
}): Promise<{ updated: EmployeeClaim[]; failed: { id: number; error: string }[] }> {
  const ids = Array.from(
    new Set(
      (input.ids || [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );
  const updated: EmployeeClaim[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const id of ids) {
    try {
      const claim = await updateClaimStatus({
        id,
        status: input.status,
        notes: input.notes,
        approvedByEmployeeId: input.approvedByEmployeeId,
      });
      updated.push(claim);
    } catch (err) {
      failed.push({
        id,
        error: err instanceof Error ? err.message : "Update failed",
      });
    }
  }
  return { updated, failed };
}

function toYearMonth(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return "";
}

/** Approved/paid claim totals keyed by employee_id for a payroll month (YYYY-MM). */
export async function sumApprovedClaimsByPayrollMonth(
  month: string,
): Promise<Record<string, number>> {
  await ensureClaimsTables();
  const m = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return {};

  // Reuse listClaims (same path as Claims page) for driver-safe row shaping.
  const year = m.slice(0, 4);
  const claims = await listClaims({ year });
  const out: Record<string, number> = {};
  for (const c of claims) {
    if (c.status !== "approved" && c.status !== "unpaid" && c.status !== "paid")
      continue;
    const pm =
      toYearMonth(c.payroll_month) || toYearMonth(c.claim_date);
    if (pm !== m) continue;
    const id = String(c.employee_id ?? "").trim();
    if (!id) continue;
    out[id] = Math.round(((out[id] || 0) + money(c.amount)) * 100) / 100;
  }
  return out;
}

/**
 * Push ledger total into monthly_payroll_adjustments.medical_claims so Monthly
 * Payroll Claims column + final-salary compute pick it up for that employee/month.
 */
export async function syncEmployeeClaimsToPayrollAdjustment(
  employeeId: number,
  month: string,
): Promise<number> {
  const eid = Number(employeeId);
  const m = String(month || "").trim();
  if (!Number.isFinite(eid) || eid <= 0 || !/^\d{4}-\d{2}$/.test(m)) return 0;

  const sums = await sumApprovedClaimsByPayrollMonth(m);
  const total = sums[String(eid)] ?? 0;

  try {
    const existingResult: any = await query(
      `SELECT ctd, fuel_allowance, unpaid_days FROM monthly_payroll_adjustments
       WHERE CAST(employee_id AS CHAR) = ? AND month = ? LIMIT 1`,
      [String(eid), m],
    );
    const existingRows: any[] = Array.isArray(existingResult?.[0])
      ? existingResult[0]
      : Array.isArray(existingResult)
        ? existingResult
        : [];
    const existing = existingRows[0] || null;
    await query(
      `INSERT INTO monthly_payroll_adjustments
         (employee_id, month, ctd, fuel_allowance, unpaid_days, medical_claims)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE medical_claims = VALUES(medical_claims)`,
      [
        String(eid),
        m,
        existing?.ctd ?? null,
        existing?.fuel_allowance ?? null,
        existing?.unpaid_days ?? null,
        total,
      ],
    );
  } catch (err) {
    console.warn("[claims] payroll adjustment sync failed:", err);
  }
  return total;
}

export async function companyClaimsSummary(year?: string): Promise<{
  year: string;
  total_claims: number;
  total_approved_amount: number;
  total_pending_amount: number;
  employees_with_claims: number;
}> {
  await ensureClaimsTables();
  const y = yearOrCurrent(year);
  const [rows]: any = await query(
    `SELECT
       COUNT(*) AS total_claims,
       COUNT(DISTINCT employee_id) AS employees_with_claims,
       COALESCE(SUM(CASE WHEN status IN ('approved','unpaid','paid') THEN amount ELSE 0 END),0) AS total_approved_amount,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END),0) AS total_pending_amount
     FROM employee_claims
     WHERE claim_year = ? AND status <> 'cancelled'`,
    [y],
  );
  const r = Array.isArray(rows) ? rows[0] : null;
  return {
    year: y,
    total_claims: Number(r?.total_claims || 0),
    total_approved_amount: money(r?.total_approved_amount),
    total_pending_amount: money(r?.total_pending_amount),
    employees_with_claims: Number(r?.employees_with_claims || 0),
  };
}
