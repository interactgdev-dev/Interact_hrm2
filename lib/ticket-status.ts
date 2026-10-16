export type TicketStatus =
  | "pending"
  | "in_progress"
  | "resolved"
  | "rejected"
  | "closed";

export const CLOSED_TICKET_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "resolved",
  "rejected",
  "closed",
]);

export function isTicketClosed(status: string): boolean {
  return CLOSED_TICKET_STATUSES.has(status as TicketStatus);
}

/** Employee/admin display label — leave tickets show "Approved" instead of "resolved". */
export function formatTicketStatusLabel(
  status: string,
  ticketType?: string | null
): string {
  if (ticketType === "leave" && status === "resolved") return "Approved";
  if (ticketType === "leave" && status === "rejected") return "Rejected";
  const s = String(status || "").replace(/_/g, " ");
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
