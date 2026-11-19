import { pool } from "@/lib/db";

export type OpenSessionBreakKind =
  | "break"
  | "prayer"
  | "refreshment"
  | "meeting";

export type OpenSessionBreakResult = {
  active: boolean;
  kind: OpenSessionBreakKind | null;
};

/**
 * True if employee has any open Break / Prayer / Refreshment / Meeting.
 * Tries numeric + string employee_id (Mongo flex-match quirks).
 */
export async function findOpenSessionBreak(
  employeeId: string,
): Promise<OpenSessionBreakResult> {
  const raw = String(employeeId || "").trim();
  if (!raw) return { active: false, kind: null };

  const idVariants: Array<string | number> = [raw];
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) {
    idVariants.push(asNum);
    idVariants.push(String(asNum));
  }

  const seen = new Set<string>();
  const ids = idVariants.filter((id) => {
    const key = `${typeof id}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const checks: Array<{ sql: string; kind: OpenSessionBreakKind }> = [
    {
      kind: "break",
      sql: `SELECT id FROM breaks
            WHERE employee_id = ?
              AND break_start IS NOT NULL
              AND break_end IS NULL
            ORDER BY break_start DESC LIMIT 1`,
    },
    {
      kind: "prayer",
      sql: `SELECT id FROM prayer_breaks
            WHERE employee_id = ?
              AND prayer_break_start IS NOT NULL
              AND prayer_break_end IS NULL
            ORDER BY prayer_break_start DESC LIMIT 1`,
    },
    {
      kind: "refreshment",
      sql: `SELECT id FROM refreshment_breaks
            WHERE employee_id = ?
              AND refreshment_break_start IS NOT NULL
              AND refreshment_break_end IS NULL
            ORDER BY refreshment_break_start DESC LIMIT 1`,
    },
    {
      kind: "meeting",
      sql: `SELECT id FROM meeting_breaks
            WHERE employee_id = ?
              AND meeting_break_start IS NOT NULL
              AND meeting_break_end IS NULL
            ORDER BY meeting_break_start DESC LIMIT 1`,
    },
  ];

  for (const idParam of ids) {
    for (const check of checks) {
      try {
        const [rows] = await pool.query(check.sql, [idParam]);
        if (Array.isArray(rows) && rows.length > 0) {
          return { active: true, kind: check.kind };
        }
      } catch {
        /* table may be missing on older DBs */
      }
    }
  }

  return { active: false, kind: null };
}
