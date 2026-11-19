import { createRequire } from "node:module";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isGalleryUnlocked } from "@/lib/guard-screenshots";
import {
  GUARD_KEYWORD_TICKET_TYPE,
  pickPrimaryMatches,
} from "@/lib/guard-keyword-watch";
import {
  EMPLOYEE_TICKETS_TABLE,
  ensureEmployeeTicketsTable,
  rowToTicket,
} from "@/lib/employee-tickets-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { cleanOcrText } = require(path.join(
  process.cwd(),
  "image-to-text",
  "lib",
  "cleanText.js"
)) as { cleanOcrText: (raw: string, mode?: string) => string };

function clearEvidence(raw: string) {
  return (cleanOcrText(String(raw || ""), "clean") || String(raw || ""))
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2500);
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    },
  });
}

/** Secret Policy inbox — only after Guard Screenshots gallery unlock. */
export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return noStore(
        { success: false, error: "Gallery locked", locked: true },
        401
      );
    }
    await ensureEmployeeTicketsTable();
    const status = req.nextUrl.searchParams.get("status");
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get("limit") || "200", 10) || 200,
      500
    );

    let sql = `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE}
               WHERE ticket_type IN (?, 'guard_keyword_alert')`;
    const params: (string | number)[] = [GUARD_KEYWORD_TICKET_TYPE];
    if (status === "open") {
      sql += ` AND status IN ('pending', 'in_progress')`;
    } else if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY id DESC LIMIT ${limit}`;

    const [rows] = await pool.query(sql, params);
    const tickets = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const t = rowToTicket(r as Record<string, unknown>);
        const fd =
          t.form_data && typeof t.form_data === "object"
            ? { ...(t.form_data as Record<string, unknown>) }
            : ({} as Record<string, unknown>);
        if (fd.evidence) fd.evidence = clearEvidence(String(fd.evidence));
        const matchedList = Array.isArray(fd.matched)
          ? (fd.matched as unknown[]).map((m) => String(m))
          : [];
        if (matchedList.length > 1) {
          fd.matched = pickPrimaryMatches(
            String(fd.evidence || t.description || ""),
            matchedList,
            1
          );
        }
        if (!fd.summary && t.description) {
          const first = String(t.description)
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.length > 20);
          if (first) fd.summary = first;
        }
        return { ...t, form_data: fd };
      })
      .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    return noStore({ success: true, tickets, count: tickets.length });
  } catch (err) {
    return noStore(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load",
      },
      500
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return noStore(
        { success: false, error: "Gallery locked", locked: true },
        401
      );
    }
    await ensureEmployeeTicketsTable();
    const body = (await req.json().catch(() => ({}))) as {
      id?: number;
      status?: string;
    };
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return noStore({ success: false, error: "id required" }, 400);
    }
    const status = String(body.status || "").trim();
    if (!["pending", "in_progress", "resolved", "closed", "rejected"].includes(status)) {
      return noStore({ success: false, error: "invalid status" }, 400);
    }

    const [check] = await pool.query(
      `SELECT id FROM ${EMPLOYEE_TICKETS_TABLE}
       WHERE id = ? AND ticket_type IN (?, 'guard_keyword_alert') LIMIT 1`,
      [id, GUARD_KEYWORD_TICKET_TYPE]
    );
    if (!Array.isArray(check) || !check.length) {
      return noStore({ success: false, error: "Not found" }, 404);
    }

    await pool.query(
      `UPDATE ${EMPLOYEE_TICKETS_TABLE}
       SET status = ?, updated_at = NOW()
       ${status === "resolved" || status === "closed" ? ", resolved_at = NOW()" : ""}
       WHERE id = ? AND ticket_type IN (?, 'guard_keyword_alert')`,
      [status, id, GUARD_KEYWORD_TICKET_TYPE]
    );

    const [rows] = await pool.query(
      `SELECT * FROM ${EMPLOYEE_TICKETS_TABLE} WHERE id = ? LIMIT 1`,
      [id]
    );
    const ticket = rowToTicket((rows as any[])[0]);
    return noStore({ success: true, ticket });
  } catch (err) {
    return noStore(
      {
        success: false,
        error: err instanceof Error ? err.message : "Update failed",
      },
      500
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return noStore(
        { success: false, error: "Gallery locked", locked: true },
        401
      );
    }
    await ensureEmployeeTicketsTable();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isFinite(id) || id <= 0) {
      return noStore({ success: false, error: "id required" }, 400);
    }
    const [result]: any = await pool.query(
      `DELETE FROM ${EMPLOYEE_TICKETS_TABLE}
       WHERE id = ? AND ticket_type IN (?, 'guard_keyword_alert')`,
      [id, GUARD_KEYWORD_TICKET_TYPE]
    );
    return noStore({
      success: true,
      deleted: Number(result?.affectedRows || 0) > 0,
    });
  } catch (err) {
    return noStore(
      {
        success: false,
        error: err instanceof Error ? err.message : "Delete failed",
      },
      500
    );
  }
}
