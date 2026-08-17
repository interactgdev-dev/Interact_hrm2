/**
 * Minimal SQL → MongoDB adapter so existing pool.execute/query call sites
 * can run against Mongo collections (1 table = 1 collection, row shape preserved).
 *
 * Supports common HRM patterns: SELECT/INSERT/UPDATE/DELETE, simple WHERE,
 * LEFT JOIN (in-memory), ORDER BY / LIMIT / OFFSET, COUNT(*).
 * DDL (CREATE/ALTER/SHOW) is mostly no-op on Mongo.
 */
import type { Db, Document, Filter } from "mongodb";

type SqlParams = any[] | undefined;

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unquoteIdent(name: string): string {
  return name.replace(/^[`"\[]|[`"\]]$/g, "").trim();
}

function splitTopLevel(list: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of top-level keyword (depth 0), or -1. */
function indexOfTopLevelKeyword(sql: string, keyword: string): number {
  const re = new RegExp(`\\b${keyword}\\b`, "ig");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let depth = 0;
    for (let i = 0; i < m.index; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth = Math.max(0, depth - 1);
    }
    if (depth === 0) return m.index;
  }
  return -1;
}

function toDateKey(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function dateKeysCompatible(a: any, b: any): boolean {
  const ka = toDateKey(a);
  const kb = toDateKey(b);
  if (ka && kb) return ka === kb;
  return String(a) === String(b);
}

/**
 * Parse SELECT into clauses using paren-aware keyword search so subquery
 * WHERE/ORDER BY do not steal the main clause.
 */
function parseSelectSql(raw: string): {
  selectSql: string;
  fromChunk: string;
  whereSql: string | null;
  orderSql: string | null;
  limit?: number;
  offsetN: number;
} | null {
  if (!/^SELECT\b/i.test(raw)) return null;
  const fromAt = indexOfTopLevelKeyword(raw, "FROM");
  if (fromAt < 0) return null;
  const selectSql = raw.slice("SELECT".length, fromAt).trim();
  let rest = raw.slice(fromAt + "FROM".length).trim();

  const whereAt = indexOfTopLevelKeyword(rest, "WHERE");
  const orderAt = indexOfTopLevelKeyword(rest, "ORDER");
  const limitAt = indexOfTopLevelKeyword(rest, "LIMIT");
  const offsetAt = indexOfTopLevelKeyword(rest, "OFFSET");

  const cuts = [whereAt, orderAt, limitAt, offsetAt].filter((i) => i >= 0);
  const firstCut = cuts.length ? Math.min(...cuts) : rest.length;
  const fromChunk = rest.slice(0, firstCut).trim();

  let whereSql: string | null = null;
  let orderSql: string | null = null;
  let limit: number | undefined;
  let offsetN = 0;

  if (whereAt >= 0) {
    const endCandidates = [orderAt, limitAt, offsetAt].filter((i) => i > whereAt);
    const end = endCandidates.length ? Math.min(...endCandidates) : rest.length;
    whereSql = rest.slice(whereAt + "WHERE".length, end).trim();
  }
  if (orderAt >= 0) {
    const relRest = rest.slice(orderAt);
    const limRel = indexOfTopLevelKeyword(relRest, "LIMIT");
    const offRel = indexOfTopLevelKeyword(relRest, "OFFSET");
    const endRel = [limRel, offRel].filter((i) => i >= 0);
    const end = endRel.length ? Math.min(...endRel) : relRest.length;
    orderSql = relRest
      .slice(0, end)
      .replace(/^\s*ORDER\s+BY\s+/i, "")
      .trim();
  }
  if (limitAt >= 0) {
    const limChunk = rest.slice(limitAt).match(/^\s*LIMIT\s+(\d+)/i);
    if (limChunk) limit = Number(limChunk[1]);
  }
  if (offsetAt >= 0) {
    const offChunk = rest.slice(offsetAt).match(/^\s*OFFSET\s+(\d+)/i);
    if (offChunk) offsetN = Number(offChunk[1]);
  }

  return { selectSql, fromChunk, whereSql, orderSql, limit, offsetN };
}

/** Pull correlated "latest shift as of date" JOIN out of FROM chunk. */
function extractLatestShiftJoin(fromChunk: string): {
  fromChunk: string;
  shiftAlias: string | null;
  dateField: string | null;
} {
  const re =
    /\bLEFT\s+JOIN\s+shift_assignments\s+(?:AS\s+)?(\w+)\s+ON\s+[\s\S]*?SELECT\s+MAX\s*\(\s*\w+\.assigned_date\s*\)[\s\S]*?assigned_date\s*<=\s*([\w.]+)\s*\)/i;
  const m = fromChunk.match(re);
  if (!m) return { fromChunk, shiftAlias: null, dateField: null };
  return {
    fromChunk: fromChunk.replace(m[0], " ").replace(/\s+/g, " ").trim(),
    shiftAlias: m[1],
    dateField: m[2].includes(".") ? m[2].split(".").pop()! : m[2],
  };
}

function attachLatestShift(
  rows: Document[],
  assignments: Document[],
  dateField: string,
): Document[] {
  const byEmp = new Map<string, Document[]>();
  for (const a of assignments) {
    const k = String(a.employee_id ?? "");
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k)!.push(a);
  }
  for (const list of byEmp.values()) {
    list.sort((a, b) => {
      const da = toDateKey(a.assigned_date) || "";
      const db = toDateKey(b.assigned_date) || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return Number(b.id || 0) - Number(a.id || 0);
    });
  }

  return rows.map((row) => {
    const empId = String(row.employee_id ?? "");
    const rowDate = toDateKey(row[dateField] ?? row.date);
    const list = byEmp.get(empId) || [];
    let best: Document | null = null;
    for (const a of list) {
      const ad = toDateKey(a.assigned_date);
      if (!ad || !rowDate) continue;
      if (ad <= rowDate) {
        if (
          !best ||
          ad > (toDateKey(best.assigned_date) || "") ||
          (ad === (toDateKey(best.assigned_date) || "") &&
            Number(a.id || 0) > Number(best.id || 0))
        ) {
          best = a;
        }
      }
    }
    if (!best) return row;
    return {
      ...row,
      shift_name: best.shift_name ?? row.shift_name,
      shift_start_time: best.start_time ?? null,
      shift_end_time: best.end_time ?? null,
      shift_assigned_date: best.assigned_date ?? null,
      start_time: best.start_time ?? row.start_time,
      end_time: best.end_time ?? row.end_time,
      assigned_date: best.assigned_date ?? row.assigned_date,
    };
  });
}

function coerceParam(v: any): any {
  if (v === undefined) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v.includes("T") || v.includes(" ") ? v.replace(" ", "T") : `${v}T00:00:00`);
    if (!Number.isNaN(d.getTime()) && (v.includes(":") || v.length === 10)) {
      // Keep date-like strings as strings — MySQL dump used strings/Dates mixed.
      // Prefer original string for equality with exported EJSON $date fields after import.
    }
  }
  return v;
}

function normalizeDocDates(doc: Document): Document {
  const out: Document = { ...doc };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "$date" in (v as any)) {
      out[k] = new Date((v as any).$date);
    }
  }
  delete out._id;
  return out;
}

type JoinSpec = {
  type: "LEFT" | "INNER";
  table: string;
  alias: string;
  left: string; // alias.field
  right: string; // alias.field
};

type FromSpec = { table: string; alias: string };

function parseFromJoins(fromChunk: string): { from: FromSpec; joins: JoinSpec[] } {
  const joins: JoinSpec[] = [];
  const re =
    /\b((?:LEFT|RIGHT|INNER)\s+)?JOIN\s+([`\w.]+)\s+(?:AS\s+)?([`\w]+)?\s+ON\s+([`\w.]+)\s*=\s*([`\w.]+)/gi;
  let m: RegExpExecArray | null;
  const joinIndexes: number[] = [];
  while ((m = re.exec(fromChunk))) {
    joinIndexes.push(m.index);
    const type = (m[1] || "INNER").trim().toUpperCase().startsWith("LEFT")
      ? "LEFT"
      : "INNER";
    const table = unquoteIdent(m[2].split(".").pop()!);
    const alias = unquoteIdent(m[3] || table);
    joins.push({
      type,
      table,
      alias,
      left: m[4].replace(/`/g, ""),
      right: m[5].replace(/`/g, ""),
    });
  }
  const firstJoinAt = joinIndexes.length ? Math.min(...joinIndexes) : fromChunk.length;
  const base = fromChunk.slice(0, firstJoinAt).trim();
  const baseParts = base.split(/\s+/);
  const table = unquoteIdent(baseParts[0].split(".").pop()!);
  let alias = table;
  if (baseParts[1] && !/^(LEFT|RIGHT|INNER|JOIN)$/i.test(baseParts[1])) {
    alias = unquoteIdent(baseParts[1] === "AS" ? baseParts[2] : baseParts[1]);
  }
  return { from: { table, alias }, joins };
}

function fieldRef(expr: string): { alias?: string; field: string } {
  const clean = expr.replace(/`/g, "").trim();
  const cast = clean.match(/^CAST\s*\(\s*([\w.]+)\s+AS\s+\w+\s*\)$/i);
  const body = cast ? cast[1] : clean;
  if (body.includes(".")) {
    const [alias, field] = body.split(".");
    return { alias, field };
  }
  return { field: body };
}

function buildFilterFromWhere(
  whereSql: string | null,
  params: any[],
  paramOffset: { i: number },
  aliasMap: Record<string, string>,
): Filter<Document> {
  if (!whereSql) return {};

  const take = () => coerceParam(params[paramOffset.i++]);

  // Split OR at top level
  const orParts = splitTopLevel(whereSql, "|".length ? "\0" : "\0");
  // Manual OR split respecting parens
  const splitOr = (s: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    const tokens = s.split(/(\bOR\b)/i);
    for (const t of tokens) {
      if (/^\s*OR\s*$/i.test(t) && depth === 0) {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
      for (const ch of t) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
      }
      cur += t;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };

  const splitAnd = (s: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    const tokens = s.split(/(\bAND\b)/i);
    for (const t of tokens) {
      if (/^\s*AND\s*$/i.test(t) && depth === 0) {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
      for (const ch of t) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
      }
      cur += t;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };

  const parseAtom = (raw: string): Filter<Document> => {
    let s = raw.trim();
    let m: RegExpMatchArray | null;
    if (s.startsWith("(") && s.endsWith(")")) {
      const inner = s.slice(1, -1).trim();
      // If balanced paren group of ORs/ANDs, recurse
      return buildFilterFromWhere(inner, params, paramOffset, aliasMap);
    }

    // IN (?, ?)
    m = s.match(/^([\w.`]+)\s+IN\s*\(([^)]*)\)\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      const qCount = (m[2].match(/\?/g) || []).length;
      const vals: any[] = [];
      if (qCount) {
        for (let i = 0; i < qCount; i++) vals.push(take());
      } else {
        for (const part of m[2].split(",")) {
          const p = part.trim();
          if (!p) continue;
          vals.push(/^\d+$/.test(p) ? Number(p) : p.replace(/^'|'$/g, ""));
        }
      }
      return { [ref.field]: { $in: vals } };
    }

    m = s.match(/^([\w.`]+)\s+IS\s+NULL\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      return {
        $or: [
          { [ref.field]: null },
          { [ref.field]: { $exists: false } },
          { [ref.field]: "" },
        ],
      };
    }
    m = s.match(/^([\w.`]+)\s+IS\s+NOT\s+NULL\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      return {
        [ref.field]: { $ne: null, $exists: true },
      };
    }

    m = s.match(/^([\w.`]+)\s+LIKE\s+\?\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      const pattern = String(take());
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
      return { [ref.field]: { $regex: `^${escaped}$`, $options: "i" } };
    }

    // DATE(col) BETWEEN ? AND ?  /  col BETWEEN ? AND ?
    m = s.match(
      /^(?:DATE\s*\(\s*([\w.`]+)\s*\)|([\w.`]+))\s+BETWEEN\s+\?\s+AND\s+\?\s*$/i,
    );
    if (m) {
      const ref = fieldRef(m[1] || m[2]);
      const from = take();
      const to = take();
      return { [ref.field]: { $gte: from, $lte: to } };
    }

    // col = other.col (correlated — ignore for base filter)
    m = s.match(/^([\w.`]+)\s*(=|!=|<>|>=|<=|>|<)\s*([\w.`]+)\s*$/i);
    if (m && m[3] !== "?" && !/^[-'\d]/.test(m[3])) {
      return {};
    }

    m = s.match(/^([\w.`]+)\s*(=|!=|<>|>=|<=|>|<)\s*\?\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      const op = m[2];
      const val = take();
      // Flexible id match: number or string
      const flex = (v: any) => {
        if (typeof v === "string" && /^\d+$/.test(v)) return [v, Number(v)];
        if (typeof v === "number") return [v, String(v)];
        return [v];
      };
      if (op === "=") {
        const vals = flex(val);
        return vals.length > 1
          ? { [ref.field]: { $in: vals } }
          : { [ref.field]: vals[0] };
      }
      if (op === "!=" || op === "<>") return { [ref.field]: { $ne: val } };
      if (op === ">") return { [ref.field]: { $gt: val } };
      if (op === ">=") return { [ref.field]: { $gte: val } };
      if (op === "<") return { [ref.field]: { $lt: val } };
      if (op === "<=") return { [ref.field]: { $lte: val } };
    }

    // col = 'literal' or col = 123
    m = s.match(/^([\w.`]+)\s*=\s*'([^']*)'\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      return { [ref.field]: m[2] };
    }
    m = s.match(/^([\w.`]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (m) {
      const ref = fieldRef(m[1]);
      return { [ref.field]: Number(m[2]) };
    }

    // Fallback: unsupported atom — match nothing rather than everything
    console.warn("[mongo-sql] unsupported WHERE atom:", s);
    return { __unsupported_where: true };
  };

  const orGroups = splitOr(whereSql);
  if (orGroups.length > 1) {
    return { $or: orGroups.map((g) => {
      const ands = splitAnd(g);
      if (ands.length === 1) return parseAtom(ands[0]);
      return { $and: ands.map(parseAtom) };
    }) };
  }
  const ands = splitAnd(whereSql);
  if (ands.length === 1) return parseAtom(ands[0]);
  return { $and: ands.map(parseAtom) };
}

function parseSelectList(selectSql: string): { star: boolean; cols: { expr: string; as: string }[] } {
  if (/^\s*\*\s*$/.test(selectSql) || /^\s*[\w`]+\.\*\s*$/.test(selectSql)) {
    return { star: true, cols: [] };
  }
  const parts = splitTopLevel(selectSql, ",");
  const cols = parts.map((p) => {
    const asMatch = p.match(/^(.+?)\s+AS\s+([`\w]+)\s*$/i);
    if (asMatch) {
      return { expr: asMatch[1].trim(), as: unquoteIdent(asMatch[2]) };
    }
    const space = p.match(/^([\w.`]+)\s+([`\w]+)\s*$/);
    if (space && !space[1].includes("(")) {
      return { expr: space[1], as: unquoteIdent(space[2]) };
    }
    const ref = fieldRef(p);
    return { expr: p.trim(), as: ref.field };
  });
  return { star: false, cols };
}

function hoursBetween(clockIn: any, clockOut: any): number {
  const a = clockIn instanceof Date ? clockIn.getTime() : new Date(String(clockIn).replace(" ", "T")).getTime();
  const b = clockOut instanceof Date ? clockOut.getTime() : new Date(String(clockOut).replace(" ", "T")).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.min(999.99, Math.round(((b - a) / 3600000) * 100) / 100);
}

function formatDateTimeSql(v: any): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 19);
}

function getByPath(row: Document, expr: string): any {
  const clean = expr.replace(/`/g, "").trim();
  const df = clean.match(/^DATE_FORMAT\s*\(\s*([\w.`]+)\s*,/i);
  if (df) {
    return formatDateTimeSql(getByPath(row, df[1]));
  }
  if (clean.includes(".")) {
    const [alias, field] = clean.split(".");
    if (row[alias] && typeof row[alias] === "object") return (row[alias] as any)[field];
    return row[field];
  }
  return row[clean];
}

async function nextNumericId(db: Db, collection: string): Promise<number> {
  const col = db.collection(collection);
  const last = await col.find({ id: { $type: ["int", "long", "double", "decimal"] } })
    .sort({ id: -1 })
    .limit(1)
    .toArray();
  const max = last[0]?.id;
  return typeof max === "number" ? max + 1 : 1;
}

function resultHeader(affectedRows: number, insertId: number | null = null) {
  return {
    affectedRows,
    insertId: insertId ?? 0,
    changedRows: affectedRows,
    warningStatus: 0,
  };
}

export async function mongoExecute(
  db: Db,
  sql: string,
  params: SqlParams = [],
): Promise<[any, any]> {
  const raw = stripComments(sql);
  const p = Array.isArray(params) ? [...params] : [];

  if (/^SELECT\s+GET_LOCK\s*\(/i.test(raw)) {
    return [[{ got_lock: 1 }], []];
  }
  if (/^SELECT\s+RELEASE_LOCK\s*\(/i.test(raw)) {
    return [[{}], []];
  }

  // DDL / introspection — no-op friendly for Mongo
  if (/^(CREATE|ALTER|DROP|TRUNCATE|SHOW|DESCRIBE|DESC|USE)\b/i.test(raw)) {
    if (/^SHOW\s+COLUMNS/i.test(raw)) return [[], []];
    if (/INFORMATION_SCHEMA/i.test(raw)) return [[], []];
    return [resultHeader(0), undefined];
  }

  // INSERT
  const insertMatch = raw.match(
    /^INSERT\s+INTO\s+([`\w.]+)\s*(?:\(([^)]*)\))?\s*VALUES\s*\(([^)]*)\)\s*$/i,
  );
  if (insertMatch) {
    const table = unquoteIdent(insertMatch[1].split(".").pop()!);
    const cols = insertMatch[2]
      ? splitTopLevel(insertMatch[2], ",").map((c) => unquoteIdent(c))
      : null;
    const placeholders = splitTopLevel(insertMatch[3], ",");
    const doc: Document = {};
    let pi = 0;
    if (cols) {
      for (let i = 0; i < cols.length; i++) {
        const ph = placeholders[i]?.trim();
        if (ph === "?") doc[cols[i]] = coerceParam(p[pi++]);
        else if (ph && /^null$/i.test(ph)) doc[cols[i]] = null;
        else if (ph && /^'.*'$/.test(ph)) doc[cols[i]] = ph.slice(1, -1);
        else if (ph && /^-?\d/.test(ph)) doc[cols[i]] = Number(ph);
        else doc[cols[i]] = coerceParam(p[pi++]);
      }
    }
    if (doc.id == null || doc.id === "") {
      doc.id = await nextNumericId(db, table);
    }
    await db.collection(table).insertOne(doc);
    return [resultHeader(1, Number(doc.id) || 0), undefined];
  }

  // UPDATE
  const updateMatch = raw.match(
    /^UPDATE\s+([`\w.]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i,
  );
  if (updateMatch) {
    const table = unquoteIdent(updateMatch[1].split(".").pop()!);
    const setSql = updateMatch[2];
    const whereSql = updateMatch[3] || null;
    const setParts = splitTopLevel(setSql, ",");
    const $set: Document = {};
    let hoursFromClockOut: any = undefined;
    let pi = 0;
    for (const part of setParts) {
      const m = part.match(/^([`\w]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const field = unquoteIdent(m[1]);
      const rhs = m[2].trim();
      if (rhs === "?") $set[field] = coerceParam(p[pi++]);
      else if (/^null$/i.test(rhs)) $set[field] = null;
      else if (/^'.*'$/.test(rhs)) $set[field] = rhs.slice(1, -1);
      else if (/^-?\d+(\.\d+)?$/.test(rhs)) $set[field] = Number(rhs);
      else if (/TIMESTAMPDIFF\s*\(\s*MINUTE\s*,\s*clock_in\s*,\s*\?\s*\)/i.test(rhs)) {
        hoursFromClockOut = coerceParam(p[pi++]);
      } else if (/^COALESCE\s*\(\s*[\w.`]+\s*,\s*\?\s*\)\s*$/i.test(rhs)) {
        const fallback = coerceParam(p[pi++]);
        if (fallback != null && fallback !== "") $set[field] = fallback;
      } else if (/\?/.test(rhs)) {
        const n = (rhs.match(/\?/g) || []).length;
        for (let i = 0; i < n; i++) pi++;
        console.warn("[mongo-sql] skipped complex SET expr:", part);
      } else {
        $set[field] = rhs;
      }
    }
    const offset = { i: pi };
    const filter = buildFilterFromWhere(whereSql, p, offset, {});
    if ((filter as any).__unsupported_where) {
      throw new Error(`Mongo adapter unsupported UPDATE WHERE: ${whereSql}`);
    }
    const col = db.collection(table);
    if (hoursFromClockOut !== undefined) {
      const docs = await col.find(filter).toArray();
      let modified = 0;
      for (const doc of docs) {
        const next: Document = {
          ...$set,
          total_hours: hoursBetween(doc.clock_in, $set.clock_out ?? hoursFromClockOut),
        };
        const res = await col.updateOne({ _id: doc._id }, { $set: next });
        modified += res.modifiedCount;
      }
      return [resultHeader(modified || docs.length), undefined];
    }
    const res = await col.updateMany(filter, { $set });
    return [resultHeader(res.modifiedCount || res.matchedCount), undefined];
  }

  // DELETE
  const deleteMatch = raw.match(
    /^DELETE\s+FROM\s+([`\w.]+)(?:\s+WHERE\s+(.+))?$/i,
  );
  if (deleteMatch) {
    const table = unquoteIdent(deleteMatch[1].split(".").pop()!);
    const whereSql = deleteMatch[2] || null;
    const offset = { i: 0 };
    const filter = whereSql
      ? buildFilterFromWhere(whereSql, p, offset, {})
      : {};
    if ((filter as any).__unsupported_where) {
      throw new Error(`Mongo adapter unsupported DELETE WHERE: ${whereSql}`);
    }
    const res = await db.collection(table).deleteMany(filter);
    return [resultHeader(res.deletedCount || 0), undefined];
  }

  // SELECT (paren-aware — subquery WHERE must not win)
  const parsedSelect = parseSelectSql(raw);
  if (parsedSelect) {
    let { selectSql, fromChunk, whereSql, orderSql, limit, offsetN } =
      parsedSelect;

    const shiftExtract = extractLatestShiftJoin(fromChunk);
    fromChunk = shiftExtract.fromChunk;
    const shiftDateField = shiftExtract.dateField;

    // COUNT(*)
    if (/^\s*COUNT\s*\(\s*\*\s*\)\s*(?:AS\s+[`\w]+)?\s*$/i.test(selectSql) && !/\bJOIN\b/i.test(fromChunk)) {
      const { from } = parseFromJoins(fromChunk);
      const offset = { i: 0 };
      const filter = buildFilterFromWhere(whereSql, p, offset, {});
      const n = await db.collection(from.table).countDocuments(filter);
      const alias =
        selectSql.match(/AS\s+([`\w]+)/i)?.[1]?.replace(/`/g, "") || "n";
      return [[{ [alias]: n, n, count: n }], []];
    }

    const { from, joins } = parseFromJoins(fromChunk);
    const select = parseSelectList(selectSql);
    const offset = { i: 0 };

    const filter = buildFilterFromWhere(whereSql, p, offset, {
      [from.alias]: from.table,
    });

    let baseFilter: Filter<Document> = filter;
    const whereUsesOtherAlias =
      whereSql &&
      joins.some((j) => new RegExp(`\\b${j.alias}\\.`, "i").test(whereSql));

    // Date BETWEEN / mixed Date|string storage: filter in memory after load
    const hasDateRange =
      whereSql &&
      /\bBETWEEN\b/i.test(whereSql) &&
      /\bdate\b/i.test(whereSql);

    if (
      whereUsesOtherAlias ||
      (filter as any).__unsupported_where ||
      hasDateRange ||
      shiftDateField
    ) {
      // Keep simple equality on primary table fields when possible
      const safe: Filter<Document> = {};
      const walk = (f: Filter<Document>) => {
        if (!f || typeof f !== "object") return;
        if ((f as any).$and) {
          for (const part of (f as any).$and) walk(part);
          return;
        }
        if ((f as any).$or || (f as any).__unsupported_where) return;
        for (const [k, v] of Object.entries(f)) {
          if (k.startsWith("$")) continue;
          if (k === "date" || k === "__unsupported_where") continue;
          if (v && typeof v === "object" && ("$gte" in (v as any) || "$lte" in (v as any))) {
            continue;
          }
          (safe as any)[k] = v;
        }
      };
      walk(filter);
      baseFilter = Object.keys(safe).length ? safe : {};
    }

    const sort: Record<string, 1 | -1> = {};
    if (orderSql) {
      for (const part of splitTopLevel(orderSql, ",")) {
        const m = part.trim().match(/^([\w.`]+)(?:\s+(ASC|DESC))?$/i);
        if (!m) continue;
        const ref = fieldRef(m[1]);
        sort[ref.field] = /DESC/i.test(m[2] || "") ? -1 : 1;
      }
    }

    const needsJoinWork = joins.length > 0 || !!shiftDateField;
    let cursor = db.collection(from.table).find(baseFilter);
    if (Object.keys(sort).length && !needsJoinWork) cursor = cursor.sort(sort);
    if (!needsJoinWork && offsetN) cursor = cursor.skip(offsetN);
    if (!needsJoinWork && limit != null) cursor = cursor.limit(limit);

    let rows = (await cursor.toArray()).map(normalizeDocDates);

    // In-memory joins
    for (const join of joins) {
      const rightRows = (await db.collection(join.table).find({}).toArray()).map(
        normalizeDocDates,
      );
      const rightKey = fieldRef(join.right).field;
      const leftKey = fieldRef(join.left).field;
      const index = new Map<string, Document[]>();
      for (const r of rightRows) {
        const k = String(r[rightKey] ?? "");
        if (!index.has(k)) index.set(k, []);
        index.get(k)!.push(r);
      }
      const joined: Document[] = [];
      for (const left of rows) {
        const lk = String(left[leftKey] ?? "");
        const matches = index.get(lk) || [];
        if (!matches.length) {
          if (join.type === "LEFT") {
            joined.push({ ...left });
          }
          continue;
        }
        for (const right of matches) {
          const merged: Document = { ...left };
          for (const [k, v] of Object.entries(right)) {
            if (k === "_id") continue;
            if (merged[k] === undefined) merged[k] = v;
            else merged[`${join.alias}_${k}`] = v;
            if (join.table === "departments" && k === "name") {
              merged.department_name = v;
            }
            if (join.table === "hrm_employees") {
              if (k === "first_name" || k === "last_name" || k === "pseudonym" || k === "gender") {
                merged[k] = v;
              }
            }
          }
          joined.push(merged);
        }
      }
      rows = joined;
    }

    if (shiftDateField) {
      const assignments = (
        await db.collection("shift_assignments").find({}).toArray()
      ).map(normalizeDocDates);
      rows = attachLatestShift(rows, assignments, shiftDateField);
    }

    // Post-filter with alias-stripped WHERE (params from start)
    if (whereSql) {
      try {
        const off = { i: 0 };
        const stripped = whereSql
          .replace(/\bDATE\s*\(\s*([\w.]+)\s*\)/gi, "$1")
          .replace(/\b\w+\./g, "");
        const f = buildFilterFromWhere(stripped, p, off, {});
        if (!(f as any).__unsupported_where && Object.keys(f).length) {
          rows = rows.filter((row) => matchFilter(row, f));
        }
      } catch {
        /* keep rows */
      }
    }

    if (needsJoinWork && Object.keys(sort).length) {
      const entries = Object.entries(sort);
      rows.sort((a, b) => {
        for (const [field, dir] of entries) {
          const av = a[field];
          const bv = b[field];
          if (av == null && bv == null) continue;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av < bv) return -1 * (dir as number);
          if (av > bv) return 1 * (dir as number);
        }
        return 0;
      });
    }
    if (needsJoinWork && offsetN) rows = rows.slice(offsetN);
    if (needsJoinWork && limit != null) rows = rows.slice(0, limit);

    // Project columns
    if (!select.star) {
      rows = rows.map((row) => {
        const out: Document = {};
        for (const col of select.cols) {
          if (/^\*$/.test(col.expr) || /\.\*$/.test(col.expr)) {
            Object.assign(out, row);
            continue;
          }
          if (/COALESCE|CONCAT|NULLIF|TRIM/i.test(col.expr)) {
            if (col.as === "employee_name") {
              const built = [row.first_name, row.last_name]
                .filter((x) => x != null && String(x).trim() !== "")
                .join(" ")
                .trim();
              out[col.as] =
                built || row.employee_name || null;
            } else {
              out[col.as] = getByPath(row, col.expr) ?? row[col.as] ?? null;
            }
            continue;
          }
          out[col.as] = getByPath(row, col.expr);
          if (col.as === "department_name" && out[col.as] == null) {
            out[col.as] = row.department_name ?? null;
          }
          if (col.as === "shift_start_time" && out[col.as] == null) {
            out[col.as] = row.shift_start_time ?? row.start_time ?? null;
          }
          if (col.as === "shift_end_time" && out[col.as] == null) {
            out[col.as] = row.shift_end_time ?? row.end_time ?? null;
          }
          if (col.as === "shift_assigned_date" && out[col.as] == null) {
            out[col.as] = row.shift_assigned_date ?? row.assigned_date ?? null;
          }
          if (col.as === "shift_name" && out[col.as] == null) {
            out[col.as] = row.shift_name ?? null;
          }
        }
        return out;
      });
    }

    return [rows, []];
  }

  throw new Error(
    `Mongo SQL adapter cannot handle this query yet. Use DB_DRIVER=mysql or simplify SQL:\n${raw.slice(0, 300)}`,
  );
}

function matchFilter(row: Document, filter: Filter<Document>): boolean {
  if ((filter as any).$and) {
    return ((filter as any).$and as Filter<Document>[]).every((f) =>
      matchFilter(row, f),
    );
  }
  if ((filter as any).$or) {
    return ((filter as any).$or as Filter<Document>[]).some((f) =>
      matchFilter(row, f),
    );
  }
  for (const [k, v] of Object.entries(filter)) {
    if (k.startsWith("$")) continue;
    const rv = row[k];
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const obj = v as any;
      if ("$in" in obj) {
        if (!obj.$in.map(String).includes(String(rv))) return false;
        continue;
      }
      if ("$ne" in obj && String(rv) === String(obj.$ne) && obj.$exists !== true) return false;
      const cmp = (op: string, bound: any) => {
        const rk = toDateKey(rv);
        const bk = toDateKey(bound);
        if (rk && bk) {
          if (op === "gt") return rk > bk;
          if (op === "gte") return rk >= bk;
          if (op === "lt") return rk < bk;
          if (op === "lte") return rk <= bk;
        }
        if (op === "gt") return rv > bound;
        if (op === "gte") return rv >= bound;
        if (op === "lt") return rv < bound;
        if (op === "lte") return rv <= bound;
        return true;
      };
      if ("$gt" in obj && !cmp("gt", obj.$gt)) return false;
      if ("$gte" in obj && !cmp("gte", obj.$gte)) return false;
      if ("$lt" in obj && !cmp("lt", obj.$lt)) return false;
      if ("$lte" in obj && !cmp("lte", obj.$lte)) return false;
      if ("$regex" in obj) {
        const re = new RegExp(obj.$regex, obj.$options || "");
        if (!re.test(String(rv ?? ""))) return false;
      }
      continue;
    }
    if (toDateKey(rv) && toDateKey(v)) {
      if (!dateKeysCompatible(rv, v)) return false;
      continue;
    }
    if (String(rv) !== String(v)) return false;
  }
  return true;
}
