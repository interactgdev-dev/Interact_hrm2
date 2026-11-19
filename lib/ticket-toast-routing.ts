import type { TicketCategory } from "./ticket-catalog";
import { parseTicketMessages } from "./ticket-thread";
import type { TicketToastKind, TicketToastPayload } from "./ticket-toast-demo";

export function isEmployeePortal(pathname: string): boolean {
  return pathname.startsWith("/employee-dashboard");
}

export function isToastSuppressedPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

export function getSessionEmployeeIds(): string[] {
  if (typeof window === "undefined") return [];
  const ids = [localStorage.getItem("employeeId"), localStorage.getItem("loginId")]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function normalizeEmployeeId(value: string): string {
  const v = value.trim();
  const n = Number(v);
  if (v !== "" && !Number.isNaN(n) && Number.isFinite(n)) return String(n);
  return v;
}

export function ticketBelongsToSession(ticketEmployeeId?: string): boolean {
  if (!ticketEmployeeId) return false;
  const tid = normalizeEmployeeId(String(ticketEmployeeId));
  return getSessionEmployeeIds().some((id) => {
    const sid = normalizeEmployeeId(id);
    return sid === tid || id.trim() === String(ticketEmployeeId).trim();
  });
}

export function shouldShowTicketCreated(pathname: string): boolean {
  if (isToastSuppressedPath(pathname)) return false;
  return !isEmployeePortal(pathname);
}

export function shouldShowTicketUpdate(pathname: string, ticketEmployeeId?: string): boolean {
  if (isToastSuppressedPath(pathname)) return false;
  if (isEmployeePortal(pathname)) return ticketBelongsToSession(ticketEmployeeId);
  return false;
}

export function ticketToastTarget(pathname: string, ticketId: number): string {
  if (isEmployeePortal(pathname)) {
    return `/employee-dashboard/my-tickets?open=${ticketId}`;
  }
  return "/admin/tickets";
}

function asCategory(value: unknown): TicketCategory {
  const v = String(value ?? "HR").toUpperCase();
  if (v === "ESS" || v === "IT" || v === "HR" || v === "ADMIN" || v === "OPERATIONS") {
    return v as TicketCategory;
  }
  return "HR";
}

export function wsTicketToToastPayload(
  ticket: Record<string, unknown>,
  kind: TicketToastKind
): TicketToastPayload | null {
  if (!ticket?.id || !ticket?.ticket_number) return null;

  const messages = parseTicketMessages({
    messages: ticket.messages,
    description: ticket.description as string | null | undefined,
    employee_name: ticket.employee_name as string | undefined,
    admin_remark: ticket.admin_remark as string | null | undefined,
    requested_at: ticket.requested_at as string | undefined,
    updated_at: ticket.updated_at as string | undefined,
  });
  const lastAdmin = [...messages].reverse().find((m) => m.role === "admin");

  return {
    id: Number(ticket.id),
    ticket_number: String(ticket.ticket_number),
    employee_id: ticket.employee_id ? String(ticket.employee_id) : undefined,
    employee_name: String(ticket.employee_name || "Employee"),
    employee_pseudonym: ticket.employee_pseudonym
      ? String(ticket.employee_pseudonym).trim() || null
      : null,
    category: asCategory(ticket.category),
    ticket_type: String(ticket.ticket_type || ""),
    subject: ticket.subject ? String(ticket.subject) : null,
    kind,
    preview: kind === "updated" ? lastAdmin?.body?.trim().slice(0, 140) || null : null,
  };
}
