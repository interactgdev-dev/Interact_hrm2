"use client";

import TicketsPage from "../../admin/tickets/page";
import { BackToDashboard } from "../components/BackToDashboard";

/** Ticket Inbox — leave + HR tickets; approve scoped to hierarchy. */
export default function EmployeeTicketsPage() {
  return (
    <div>
      <div style={{ padding: "8px 20px 0" }}>
        <BackToDashboard />
      </div>
      <TicketsPage inboxMode="hr" />
    </div>
  );
}
