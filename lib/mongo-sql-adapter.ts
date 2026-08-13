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
        $or: [{ [ref.field]: null }, { [ref.field]: { $exists: false } }],
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

function getByPath(row: Document, expr: string): any {
  const clean = expr.replace(/`/g, "").trim();
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
      else if (/\?/.test(rhs)) {
        // expressions like LEAST(999.99, ROUND(...)) — store next params loosely
        while (/\?/.test(rhs) && pi < p.length) {
          // skip complex expr: use last param as best effort if single field assign failed
          pi++;
        }
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
    const res = await db.collection(table).updateMany(filter, { $set });
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

  // SELECT
  const selectMatch = raw.match(
    /^SELECT\s+(.+?)\s+FROM\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*$/i,
  );
  if (selectMatch) {
    const selectSql = selectMatch[1];
    const fromChunk = selectMatch[2];
    const whereSql = selectMatch[3] || null;
    const orderSql = selectMatch[4] || null;
    const limit = selectMatch[5] ? Number(selectMatch[5]) : undefined;
    const offsetN = selectMatch[6] ? Number(selectMatch[6]) : 0;

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

    // Base filter: only conditions on primary alias / unqualified fields
    const filter = buildFilterFromWhere(whereSql, p, offset, {
      [from.alias]: from.table,
    });
    if ((filter as any).__unsupported_where) {
      // For JOIN queries, fetch all base and filter in memory later
    }

    let baseFilter: Filter<Document> = filter;
    // If WHERE references other aliases, strip to {} and filter after join
    const whereUsesOtherAlias =
      whereSql &&
      joins.some((j) => new RegExp(`\\b${j.alias}\\.`, "i").test(whereSql));

    if (whereUsesOtherAlias || (filter as any).__unsupported_where) {
      baseFilter = {};
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

    let cursor = db.collection(from.table).find(baseFilter);
    if (Object.keys(sort).length && !joins.length) cursor = cursor.sort(sort);
    if (!joins.length && offsetN) cursor = cursor.skip(offsetN);
    if (!joins.length && limit != null) cursor = cursor.limit(limit);

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
            // Prefer alias-prefixed for conflicts only when left already has key
            if (merged[k] === undefined) merged[k] = v;
            else merged[`${join.alias}_${k}`] = v;
            // Also set common join projection names
            if (join.table === "departments" && k === "name") {
              merged.department_name = v;
            }
          }
          joined.push(merged);
        }
      }
      rows = joined;
    }

    // Post-filter when WHERE used joined aliases or unsupported pieces
    if (whereSql && (whereUsesOtherAlias || (filter as any).__unsupported_where || joins.length)) {
      // Re-parse params from start for in-memory evaluate of simple equality only
      // Prefer applying original filter fields that exist on merged rows
      try {
        const off = { i: 0 };
        const f = buildFilterFromWhere(whereSql.replace(/\b\w+\./g, ""), p, off, {});
        if (!(f as any).__unsupported_where && Object.keys(f).length) {
          rows = rows.filter((row) => matchFilter(row, f));
        }
      } catch {
        /* keep rows */
      }
    }

    if (joins.length && Object.keys(sort).length) {
      const [[field, dir]] = Object.entries(sort);
      rows.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return -1 * (dir as number);
        if (av > bv) return 1 * (dir as number);
        return 0;
      });
    }
    if (joins.length && offsetN) rows = rows.slice(offsetN);
    if (joins.length && limit != null) rows = rows.slice(0, limit);

    // Project columns
    if (!select.star) {
      rows = rows.map((row) => {
        const out: Document = {};
        for (const col of select.cols) {
          if (/^\*$/.test(col.expr) || /\.\*$/.test(col.expr)) {
            Object.assign(out, row);
            continue;
          }
          out[col.as] = getByPath(row, col.expr);
          // department_name already set during join
          if (col.as === "department_name" && out[col.as] == null) {
            out[col.as] = row.department_name ?? null;
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
      if ("$gt" in obj && !(rv > obj.$gt)) return false;
      if ("$gte" in obj && !(rv >= obj.$gte)) return false;
      if ("$lt" in obj && !(rv < obj.$lt)) return false;
      if ("$lte" in obj && !(rv <= obj.$lte)) return false;
      if ("$regex" in obj) {
        const re = new RegExp(obj.$regex, obj.$options || "");
        if (!re.test(String(rv ?? ""))) return false;
      }
      continue;
    }
    if (String(rv) !== String(v)) return false;
  }
  return true;
}
