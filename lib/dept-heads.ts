/**
 * Org dept heads / CEOs:
 * Max Miles → HIT + HR + Medical Billing + Finance
 * Mubeen → IT + Marketing + CEst.
 * Joe White → DM
 */

import { orgDeptChipLabel } from "@/app/admin/roles-permissions/system-control-data";
import { isCeoOrgRole } from "@/lib/org-role";
import { pool } from "@/lib/db";

export const DEPT_HEAD_NAME_HINT: Record<string, string> = {
  IT: "mubeen",
  Marketing: "mubeen",
  "CEst.": "mubeen",
  HIT: "max",
  HR: "max",
  "Medical Billing": "max",
  Finance: "max",
  DM: "joe",
};

/** Chips owned by each head hint. */
export const HEAD_OWNED_CHIPS: Record<string, string[]> = {
  max: ["HIT", "HR", "Medical Billing", "Finance"],
  mubeen: ["IT", "CEst."],
  joe: ["DM"],
};

export type OrgCeoOption = {
  id: string;
  name: string;
  hint: "joe" | "max" | "mubeen";
};

/** Live Joe / Max / Mubeen employees for Reporting Manager dropdown. */
export async function listOrgCeoEmployees(): Promise<OrgCeoOption[]> {
  try {
    const [rows] = await pool.execute(
      `SELECT id, first_name, last_name, role
       FROM hrm_employees
       WHERE status IS NULL OR status IN ('enabled', 'active', 'Enabled', 'Active')
       ORDER BY id ASC`,
    );
    const list = rows as {
      id: number;
      first_name?: string | null;
      last_name?: string | null;
      role?: string | null;
    }[];
    const out: OrgCeoOption[] = [];
    for (const hint of ["joe", "max", "mubeen"] as const) {
      const match = list.find((e) =>
        nameLooksLikeDeptHead(e.first_name, e.last_name, hint),
      );
      if (!match) continue;
      const name =
        `${String(match.first_name || "").trim()} ${String(match.last_name || "").trim()}`.trim() ||
        `Employee ${match.id}`;
      out.push({ id: String(match.id), name, hint });
    }
    return out;
  } catch {
    return [];
  }
}

export function nameLooksLikeDeptHead(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  hint: string,
): boolean {
  const hl = hint.toLowerCase();
  const first = String(firstName || "").trim().toLowerCase();
  const last = String(lastName || "").trim().toLowerCase();
  const full = `${first} ${last}`.trim();
  return (
    first === hl ||
    first.startsWith(hl) ||
    full.startsWith(hl) ||
    (hl === "max" && last === "miles") ||
    (hl === "mubeen" && (last.includes("chugtai") || last.includes("chughtai"))) ||
    (hl === "joe" && last === "white")
  );
}

export function detectDeptHeadHint(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  for (const hint of ["max", "mubeen", "joe"] as const) {
    if (nameLooksLikeDeptHead(firstName, lastName, hint)) return hint;
  }
  return null;
}

export function chipsForDeptHeadHint(hint: string | null | undefined): string[] {
  if (!hint) return [];
  return HEAD_OWNED_CHIPS[hint.toLowerCase()] || [];
}

export function chipOwnedByHead(
  departmentName: string | null | undefined,
  headHint: string | null | undefined,
): boolean {
  if (!headHint) return false;
  const chip = orgDeptChipLabel(departmentName);
  if (!chip) return false;
  const owned = chipsForDeptHeadHint(headHint);
  return owned.some((c) => c.toLowerCase() === chip.toLowerCase());
}

export type DeptHeadViewer = {
  employeeId: string;
  fullName: string;
  orgRole: string | null;
  /** max | mubeen | joe when this person is a mapped dept head */
  headHint: string | null;
  ownedChips: string[];
  /** BOD/CEO role OR mapped Joe/Max/Mubeen */
  isDeptHeadCeo: boolean;
};

export async function loadDeptHeadViewer(
  employeeId: string | number | null | undefined,
): Promise<DeptHeadViewer | null> {
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) return null;
  try {
    const [rows] = await pool.execute(
      `SELECT id, first_name, last_name, role FROM hrm_employees WHERE id = ? LIMIT 1`,
      [Number(eid)],
    );
    const row = (
      rows as {
        id: number;
        first_name?: string | null;
        last_name?: string | null;
        role?: string | null;
      }[]
    )[0];
    if (!row) return null;
    const first = row.first_name ? String(row.first_name).trim() : "";
    const last = row.last_name ? String(row.last_name).trim() : "";
    const fullName = `${first} ${last}`.trim() || `Employee ${eid}`;
    const orgRole = row.role ? String(row.role).trim() : null;
    const headHint = detectDeptHeadHint(first, last);
    const ownedChips = chipsForDeptHeadHint(headHint);
    const isDeptHeadCeo = Boolean(headHint) || isCeoOrgRole(orgRole);
    return {
      employeeId: eid,
      fullName,
      orgRole,
      headHint,
      ownedChips,
      isDeptHeadCeo,
    };
  } catch {
    return null;
  }
}

/** Resolve display name for an employee id (approved-by labels). */
export async function resolveEmployeeDisplayName(
  employeeId: string | number | null | undefined,
): Promise<string | null> {
  const eid = String(employeeId || "").trim();
  if (!eid || !/^\d+$/.test(eid)) return null;
  try {
    const [rows] = await pool.execute(
      `SELECT first_name, last_name, pseudonym FROM hrm_employees WHERE id = ? LIMIT 1`,
      [Number(eid)],
    );
    const row = (
      rows as {
        first_name?: string | null;
        last_name?: string | null;
        pseudonym?: string | null;
      }[]
    )[0];
    if (!row) return null;
    const full = `${row.first_name || ""} ${row.last_name || ""}`.trim();
    return full || (row.pseudonym ? String(row.pseudonym).trim() : null) || eid;
  } catch {
    return null;
  }
}
