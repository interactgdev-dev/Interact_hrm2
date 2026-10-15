"use client";

import TicketsPage from "../../admin/tickets/page";

/** Ticket Inbox — leave + HR tickets; approve scoped to hierarchy. */
export default function EmployeeTicketsPage() {
  return <TicketsPage inboxMode="hr" />;
}
