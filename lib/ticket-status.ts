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

/** Employee/admin display label — leave tickets show "approved" instead of "resolved". */
export function formatTicketStatusLabel(
  status: string,
  ticketType?: string | null
): string {
  if (ticketType === "leave" && status === "resolved") return "approved";
  return String(status || "").replace(/_/g, " ");
}
