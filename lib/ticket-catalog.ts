export type TicketCategory = "IT" | "HR" | "ADMIN" | "OPERATIONS" | "ESS";

export type TicketFormKind =
  | "leave"
  | "advance"
  | "loan"
  | "salary_slip"
  | "generic"
  | "custom"
  | "hrm_issue";

export type TicketTypeOption = {
  value: string;
  label: string;
  form: TicketFormKind;
  universal?: boolean;
};

export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "HR", label: "HR" },
  { value: "IT", label: "IT" },
  { value: "ADMIN", label: "Admin" },
  { value: "OPERATIONS", label: "Operations" },
];

const CATEGORY_TYPES: Record<Exclude<TicketCategory, "ESS">, TicketTypeOption[]> = {
  HR: [
    { value: "leave", label: "Leave", form: "leave" },
    { value: "custom", label: "Custom", form: "custom" },
    { value: "hrm_issue", label: "HRM Issue", form: "hrm_issue" },
    { value: "loan", label: "Loan", form: "loan" },
    { value: "advance_salary", label: "Advance salary", form: "advance" },
    { value: "salary_slip", label: "Salary slip", form: "salary_slip" },
    { value: "attendance_correction", label: "Attendance correction", form: "generic" },
    { value: "shift_change", label: "Shift change request", form: "generic" },
    { value: "id_card", label: "ID card request", form: "generic" },
    { value: "employment_letter", label: "Employment letter", form: "generic" },
    { value: "benefits_inquiry", label: "Benefits inquiry", form: "generic" },
    { value: "hr_general", label: "HR general request", form: "generic" },
  ],
  IT: [
    { value: "system_issue", label: "System issue", form: "generic" },
    { value: "internet_issue", label: "Internet issue", form: "generic" },
    { value: "hardware_request", label: "Hardware request", form: "generic" },
    { value: "software_access", label: "Software / access request", form: "generic" },
    { value: "email_account", label: "Email / account issue", form: "generic" },
  ],
  ADMIN: [
    { value: "stationery", label: "Stationery request", form: "generic" },
    { value: "meeting_room", label: "Meeting room booking", form: "generic" },
    { value: "visitor_pass", label: "Visitor pass", form: "generic" },
    { value: "facility_issue", label: "Facility issue", form: "generic" },
  ],
  OPERATIONS: [
    { value: "transport", label: "Transport request", form: "generic" },
    { value: "maintenance", label: "Maintenance request", form: "generic" },
    { value: "inventory", label: "Inventory request", form: "generic" },
    { value: "safety_report", label: "Safety report", form: "generic" },
  ],
};

export const UNIVERSAL_TICKET_TYPES: TicketTypeOption[] = [
  { value: "leave", label: "Leave", form: "leave", universal: true },
  { value: "general_request", label: "General request", form: "generic", universal: true },
  { value: "custom", label: "Custom", form: "custom", universal: true },
];

/** HR types currently enabled on Generate Ticket (department stays HR). */
export const ENABLED_HR_TICKET_TYPES = ["leave", "custom", "hrm_issue"] as const;

export function getTicketTypesForCategory(category: TicketCategory): TicketTypeOption[] {
  const key = category === "ESS" ? "HR" : category;
  const specific = CATEGORY_TYPES[key as Exclude<TicketCategory, "ESS">] ?? [];
  const universals = UNIVERSAL_TICKET_TYPES.filter(
    (u) => !specific.some((s) => s.value === u.value)
  );
  return [...specific, ...universals];
}

export function findTicketType(
  category: TicketCategory,
  ticketType: string
): TicketTypeOption | undefined {
  const key = category === "ESS" ? "HR" : category;
  return getTicketTypesForCategory(key).find((t) => t.value === ticketType)
    ?? getTicketTypesForCategory("HR").find((t) => t.value === ticketType);
}

export function ticketTypeLabel(category: TicketCategory, ticketType: string): string {
  return findTicketType(category, ticketType)?.label ?? ticketType.replace(/_/g, " ");
}

export function categoryLabel(category: string): string {
  if (category === "ESS") return "HR";
  return TICKET_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
