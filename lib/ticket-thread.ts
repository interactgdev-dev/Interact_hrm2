export type TicketThreadMessage = {
  id: string;
  role: "employee" | "admin";
  author: string;
  body: string;
  created_at: string;
};

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidMessage(value: unknown): value is TicketThreadMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as TicketThreadMessage;
  return (
    typeof m.id === "string" &&
    (m.role === "employee" || m.role === "admin") &&
    typeof m.author === "string" &&
    typeof m.body === "string" &&
    typeof m.created_at === "string"
  );
}

function parseMessagesColumn(raw: unknown): TicketThreadMessage[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidMessage).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

export function parseTicketMessages(row: {
  messages?: unknown;
  description?: string | null;
  employee_name?: string;
  admin_remark?: string | null;
  requested_at?: string;
  updated_at?: string;
}): TicketThreadMessage[] {
  const stored = parseMessagesColumn(row.messages);
  if (stored.length > 0) return stored;

  const legacy: TicketThreadMessage[] = [];
  const desc = row.description?.trim();
  if (desc) {
    legacy.push({
      id: "legacy-employee",
      role: "employee",
      author: row.employee_name || "Employee",
      body: desc,
      created_at: row.requested_at || new Date().toISOString(),
    });
  }
  const remark = row.admin_remark?.trim();
  if (remark) {
    legacy.push({
      id: "legacy-admin",
      role: "admin",
      author: "Admin",
      body: remark,
      created_at: row.updated_at || row.requested_at || new Date().toISOString(),
    });
  }
  return legacy;
}

export function seedEmployeeMessage(
  employeeName: string,
  description: string | null,
  requestedAt?: string
): TicketThreadMessage[] {
  const body = description?.trim();
  if (!body) return [];
  return [
    {
      id: genId(),
      role: "employee",
      author: employeeName || "Employee",
      body,
      created_at: requestedAt || new Date().toISOString(),
    },
  ];
}

export function appendAdminMessage(
  messages: TicketThreadMessage[],
  author: string,
  body: string
): TicketThreadMessage[] {
  const trimmed = body.trim();
  if (!trimmed) return messages;
  return [
    ...messages,
    {
      id: genId(),
      role: "admin",
      author: author || "Admin",
      body: trimmed,
      created_at: new Date().toISOString(),
    },
  ];
}

export function appendEmployeeMessage(
  messages: TicketThreadMessage[],
  author: string,
  body: string
): TicketThreadMessage[] {
  const trimmed = body.trim();
  if (!trimmed) return messages;
  return [
    ...messages,
    {
      id: genId(),
      role: "employee",
      author: author || "Employee",
      body: trimmed,
      created_at: new Date().toISOString(),
    },
  ];
}

export function latestAdminRemark(messages: TicketThreadMessage[]): string | null {
  const admins = messages.filter((m) => m.role === "admin");
  return admins.length ? admins[admins.length - 1].body : null;
}

export function getLastAdminMessage(
  messages: TicketThreadMessage[]
): TicketThreadMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "admin") return messages[i];
  }
  return null;
}

export function ticketSeenStorageKey(employeeId: string) {
  return `hrm_ticket_seen_${employeeId}`;
}

export function loadTicketSeenMap(employeeId: string): Record<number, string> {
  if (typeof window === "undefined" || !employeeId) return {};
  try {
    const raw = localStorage.getItem(ticketSeenStorageKey(employeeId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<number, string> = {};
    Object.entries(parsed).forEach(([k, v]) => {
      out[Number(k)] = v;
    });
    return out;
  } catch {
    return {};
  }
}

export function saveTicketSeen(employeeId: string, ticketId: number, messageId: string) {
  if (typeof window === "undefined" || !employeeId) return;
  const map = loadTicketSeenMap(employeeId);
  map[ticketId] = messageId;
  const serial: Record<string, string> = {};
  Object.entries(map).forEach(([k, v]) => {
    serial[k] = v;
  });
  localStorage.setItem(ticketSeenStorageKey(employeeId), JSON.stringify(serial));
}

export function hasUnreadAdminReply(
  ticketId: number,
  messages: TicketThreadMessage[] | undefined,
  seenMap: Record<number, string>
): boolean {
  const lastAdmin = getLastAdminMessage(messages ?? []);
  if (!lastAdmin) return false;
  return seenMap[ticketId] !== lastAdmin.id;
}
