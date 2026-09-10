import { pool } from "@/lib/db";
import { broadcastWsEvent } from "@/lib/ws-broadcast";
import type { TicketCategory } from "@/lib/ticket-catalog";
import { parseTicketMessages, type TicketThreadMessage } from "@/lib/ticket-thread";
import type { TicketStatus } from "@/lib/ticket-status";

export const EMPLOYEE_TICKETS_TABLE = "employee_tickets";

export type { TicketStatus };

export type EmployeeTicketRow = {
  id: number;
  ticket_number: string;
  employee_id: string;
  employee_name: string;
  category: TicketCategory;
  ticket_type: string;
  is_custom: number;
  subject: string | null;
  description: string | null;
  form_data: Record<string, unknown> | null;
  priority: string;
  status: TicketStatus;
  admin_remark: string | null;
  messages?: TicketThreadMessage[];
  resolved_at: string | null;
  requested_at: string;
  updated_at: string;
};

export async function ensureEmployeeTicketsTable() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ${EMPLOYEE_TICKETS_TABLE} (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        ticket_number VARCHAR(32) NOT NULL,
        employee_id VARCHAR(64) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        category ENUM('ESS', 'IT', 'HR', 'ADMIN', 'OPERATIONS') NOT NULL,
        ticket_type VARCHAR(64) NOT NULL,
        is_custom TINYINT(1) NOT NULL DEFAULT 0,
        subject VARCHAR(255) NULL,
        description TEXT NULL,
        form_data JSON NULL,
        priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
        status ENUM('pending', 'in_progress', 'resolved', 'rejected', 'closed') NOT NULL DEFAULT 'pending',
        admin_remark TEXT NULL,
        messages JSON NULL,
        resolved_at TIMESTAMP NULL DEFAULT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ticket_number (ticket_number),
        KEY idx_et_status (status),
        KEY idx_et_category (category),
        KEY idx_et_employee (employee_id),
        KEY idx_et_requested (requested_at),
        KEY idx_et_category_status (category, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    try {
      await conn.execute(
        `ALTER TABLE ${EMPLOYEE_TICKETS_TABLE} ADD COLUMN messages JSON NULL AFTER admin_remark`
      );
    } catch {
      /* column already exists */
    }
  } finally {
    conn.release();
  }
}

export function buildTicketNumber(id: number) {
  const year = new Date().getFullYear();
  return `TKT-${year}-${String(id).padStart(5, "0")}`;
}

/** Newest first by requested_at (fallback updated_at / id). */
export function sortTicketsNewestFirst<T extends {
  id?: number | string;
  requested_at?: unknown;
  updated_at?: unknown;
}>(tickets: T[]): T[] {
  const ms = (t: T) => {
    for (const raw of [t.requested_at, t.updated_at]) {
      if (raw == null || raw === "") continue;
      const n = new Date(String(raw)).getTime();
      if (Number.isFinite(n)) return n;
    }
    return Number(t.id) || 0;
  };
  return [...tickets].sort((a, b) => {
    const diff = ms(b) - ms(a);
    if (diff !== 0) return diff;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

export function rowToTicket(row: Record<string, unknown>): EmployeeTicketRow {
  const base = {
    ...(row as unknown as EmployeeTicketRow),
    form_data: parseFormData(row.form_data),
  };
  const messages = parseTicketMessages({
    messages: row.messages,
    description: base.description,
    employee_name: base.employee_name,
    admin_remark: base.admin_remark,
    requested_at: base.requested_at,
    updated_at: base.updated_at,
  });
  return { ...base, messages };
}

export function parseFormData(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function broadcastTicketUpdate(ticket?: Partial<EmployeeTicketRow>) {
  broadcastWsEvent({
    type: "ticket_update",
    ticket: ticket ?? null,
  });
}
