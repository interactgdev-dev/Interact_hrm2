export type TabId = "roles" | "permissions" | "features";

export type RoleDef = {
  id: string;
  name: string;
  description: string;
  portal: string;
  scope: string;
  scopeLabel: string;
  hierarchyLevel: number;
  system?: boolean;
  // Org-chart parent. null = top of the tree (root). Drives the hierarchy view.
  parentId?: string | null;
  // Visual/permission tier used for org-chart colour and default permissions.
  tier?: RoleTier;
  accent?: string;
};

export type RoleTier =
  | "board"
  | "partner"
  | "director"
  | "manager"
  | "lead"
  | "staff"
  | "support"
  | "junior";

export type DemoEmployee = {
  id: string;
  name: string;
  initials: string;
  pseudonym?: string;
  profilePhoto?: string;
  roleId: string;
  /** Explicit System Control assignment; null/undefined = not assigned via Permissions. */
  accessRoleSlug?: string | null;
  /** All System Control roles this person is on (org chart can show them on multiple cards). */
  accessRoleSlugs?: string[];
  departmentId: string;
  departmentName?: string;
  reportsTo: string | null;
  /** Live HRM role string (BOD/CEO, HOD, …) before System Control assign. */
  legacyRole?: string;
};

export type FeatureModule = {
  id: string;
  name: string;
  icon: string;
  permissions: { key: string; label: string; desc: string }[];
};

export type GlobalFeature = {
  key: string;
  name: string;
  desc: string;
  on: boolean;
};

const PERM_HINTS: Record<string, string> = {
  "dashboard.view": "Open the main HRM dashboard.",
  "admin.home.view": "Open the admin home page.",
  "attendance.summary.view": "View attendance summary reports and filters for employees in scope.",
  "attendance.summary.export": "Download attendance summary as Excel or PDF.",
  "attendance.manage.edit": "Correct punch times, add manual entries, or fix exceptions.",
  "attendance.monthly.view": "Open monthly attendance and deduction views.",
  "attendance.monthly.export": "Export monthly deduction summary for payroll handoff.",
  "attendance.breaks.manage": "Configure break rules and review break usage.",
  "attendance.tungsten.view": "Open Tungsten biometric IN/OUT punch log.",
  "attendance.presence.view": "Open desktop presence / idle monitoring.",
  "attendance.employee_report.view": "Open per-employee attendance report.",
  "leave.list.view": "See leave requests for scoped employees (not only self).",
  "leave.approve.manager": "Leave approval — Managers and Team Leads, within their department scope (Leaves page).",
  "leave.approval_status.view": "See pending vs approved status on leave requests.",
  "leave.balances.edit": "Adjust leave balances and entitlements.",
  "leave.calendar.view": "Open company leave calendar.",
  "leave.monthly_summary.view": "Open monthly leave summary reports.",
  "payroll.monthly.view": "View monthly payroll sheets and totals.",
  "payroll.monthly.edit": "Edit payroll lines, allowances, and deductions.",
  "payroll.daily.view": "View daily salary calculator and per-day records.",
  "payroll.daily.edit": "Generate and edit daily salary day records.",
  "payroll.commissions": "Access commission calculation and payout screens.",
  "payroll.advance": "Process salary advance requests.",
  "payroll.loan": "Manage employee loan schedules and deductions.",
  "payroll.financial_requests.view": "Review advance/loan financial request inbox.",
  "department.salary.view":
    "View salaries of people in your own department (at or below your level). Off by default for HR — Managers can enable this in Permissions.",
  "people.employee_list.view": "Browse and search the employee directory (own department by default).",
  "data.scope.all_departments":
    "Company-wide data: see ALL departments on employee list, attendance, and break summaries. Without this, those views stay limited to the employee’s own department.",
  "people.employee.add": "Create new employee records.",
  "people.credentials.manage": "Reset or issue employee login credentials.",
  "people.face_enrollment.manage": "Enroll or update biometric face profiles.",
  "people.files.view": "Access employee document files.",
  "people.appraisals.view": "Review pending appraisal workflows.",
  "people.formats.view": "Open HR formats library.",
  "people.recruitment.view": "Open recruitment module.",
  "shifts.scheduler.view": "Open shift scheduler.",
  "shifts.management.view": "Manage shift templates and assignments.",
  "ops.tickets.view": "Open ticket inbox and reply threads.",
  "ops.events.view": "Manage upcoming company events.",
  "ops.departments.view": "Manage departments.",
  "ops.login_carousel.manage": "Edit login page carousel slides.",
  "ops.company_policy.view": "View or edit company policies.",
  "team.dashboard.view": "Open My Team page — list of assigned team members.",
  "team.attendance.view": "View attendance for assigned team only (includes self).",
  "team.breaks.view": "View team break + prayer break summaries for assigned team only (includes self).",
  "team.leaves.view": "View leave applications submitted by assigned team members (includes self).",
  "team.management.assign": "Assign employees to a team under a lead.",
  "department.attendance.view": "View attendance for the whole department (manager/HOD scope).",
  "department.breaks.view": "View break + prayer break data for the whole department.",
  "department.leaves.view": "View leave applications for the whole department.",
  "department.monthly.view": "View monthly attendance / deductions for the whole department.",
  "portal.my_info.view": "Open personal My Info page.",
  "portal.time.view": "Open employee time / clock page.",
  "portal.tickets.create": "Create support tickets from employee portal.",
  "portal.performance.view": "Open performance page.",
  "system.control.access": "Open System Control in view mode (does not grant edit rights by itself).",
  "system.permissions.edit": "Edit role/user permission checkmarks and save changes.",
  "system.users.assign": "Assign or unassign roles to employees.",
  "system.org_chart.edit": "Create, move, rename, or delete org chart role cards.",
  "system.features.edit": "Toggle organization-wide feature switches.",
};

function withPermissionHints(
  modules: {
    id: string;
    name: string;
    icon: string;
    permissions: { key: string; label: string }[];
  }[],
): FeatureModule[] {
  return modules.map((mod) => ({
    ...mod,
    permissions: mod.permissions.map((perm) => ({
      ...perm,
      desc: PERM_HINTS[perm.key] || `Controls access to: ${perm.label.toLowerCase()}.`,
    })),
  }));
}

// Per-tier defaults: org-chart colour, dashboard portal, data scope, and the
// hierarchy level (lower number = higher rank).
const TIER_META: Record<
  RoleTier,
  { level: number; portal: string; scope: string; accent: string }
> = {
  board: { level: 1, portal: "admin-dashboard", scope: "ALL", accent: "#a78bfa" },
  partner: { level: 5, portal: "admin-dashboard", scope: "ALL", accent: "#1a1a1a" },
  director: { level: 10, portal: "admin-dashboard", scope: "DEPARTMENT", accent: "#b91c1c" },
  manager: { level: 20, portal: "admin-dashboard", scope: "DEPARTMENT", accent: "#ea580c" },
  lead: { level: 30, portal: "leader-dashboard", scope: "TEAM", accent: "#2b6cb0" },
  staff: { level: 40, portal: "employee-dashboard", scope: "SELF", accent: "#2b6cb0" },
  support: { level: 45, portal: "employee-dashboard", scope: "SELF", accent: "#38a169" },
  junior: { level: 50, portal: "employee-dashboard", scope: "SELF", accent: "#38a169" },
};

// [id, display name, parentId, tier] — the company's actual org structure.
type RoleSeed = [string, string, string | null, RoleTier];

const ROLE_SEEDS: RoleSeed[] = [
  // Top
  ["exec_board", "Executive Board / Managing Partners", null, "board"],

  // ── IT & Technology ──────────────────────────────────────────
  ["mp_it", "Managing Partner — IT & Technology", "exec_board", "partner"],
  ["dir_it", "Director of IT", "mp_it", "director"],
  ["it_manager", "IT Manager", "dir_it", "manager"],
  ["team_lead_it", "Team Lead — IT", "it_manager", "lead"],
  ["team_lead_cest", "Team Lead — CEst.", "it_manager", "lead"],
  ["sysadmin", "System Administrator / Network Engineer", "it_manager", "lead"],
  ["it_support", "IT Support Specialist", "team_lead_it", "staff"],
  ["helpdesk", "Helpdesk Associate", "it_support", "junior"],
  ["telephony", "Telephony & Voice Specialist (Genesys / Avaya)", "it_manager", "staff"],
  ["voice_infra", "Support Voice Infrastructure", "telephony", "support"],

  // ── Finance & Data Analytics ─────────────────────────────────
  ["mp_finance", "Managing Partner — Finance & Data Analytics", "exec_board", "partner"],
  ["dir_privacy", "Director of Privacy", "mp_finance", "director"],
  ["finance_manager", "Finance Manager", "dir_privacy", "manager"],
  ["team_lead_finance", "Team Lead — Finance", "finance_manager", "lead"],
  ["accountant_billing", "Accountant / Billing Specialist", "team_lead_finance", "staff"],
  ["dir_data", "Director of Data Mining & Analytics", "mp_finance", "director"],
  ["bd_sourcing", "BD / Sourcing Manager", "dir_data", "manager"],
  ["team_lead_dm", "Team Lead — DM / Analytics", "bd_sourcing", "lead"],
  ["data_engineer", "Data Engineers / ETL Specialists", "team_lead_dm", "staff"],
  ["data_analyst", "Data Analysts / BI Reporters", "team_lead_dm", "staff"],
  ["junior_data_analyst", "Junior Data Analyst", "data_analyst", "junior"],
  ["provider_insights", "Provider System Performance Insights", "data_analyst", "support"],
  ["provider_forecast", "Provider Reimbursement / P&L Forecasting", "data_analyst", "support"],

  // ── Medical Billing Operations ───────────────────────────────
  ["mp_medical", "Managing Partner — Medical Billing Operations", "exec_board", "partner"],
  // Client Billing & Collections
  ["dir_billing", "Director — Medical Billing Operations", "mp_medical", "director"],
  ["qa_manager", "QA & Assurance Manager (HIPAA / Compliance)", "dir_billing", "manager"],
  ["qa_lead", "QA Lead / Auditor", "qa_manager", "lead"],
  ["qa_analyst", "QA Analyst / Chart Reviewer", "qa_lead", "junior"],
  ["billing_ops_manager", "Medical Billing Operations Manager", "dir_billing", "manager"],
  ["team_lead_billing", "Team Lead — Medical Billing", "billing_ops_manager", "lead"],
  ["senior_coder", "Senior Medical Coder / Biller", "team_lead_billing", "staff"],
  ["junior_coder", "Junior Medical Coder / CDI", "senior_coder", "junior"],
  // Recruit & Onboard / HR & Admin
  ["dir_hr", "Director of Human Resources & Admin", "mp_medical", "director"],
  ["hr_manager", "HR Manager", "dir_hr", "manager"],
  ["team_lead_hr", "Team Lead — HR", "hr_manager", "lead"],
  ["team_lead_hit", "Team Lead — HIT", "hr_manager", "lead"],
  ["recruitment", "Recruitment / Talent Acquisition", "team_lead_hr", "staff"],
  ["hr_coordinator", "HR Coordinators / Payroll", "team_lead_hr", "staff"],
  ["admin_manager", "Administration Manager", "dir_hr", "manager"],
  ["team_lead_admin", "Team Lead — Admin", "admin_manager", "lead"],
  ["admin_officer", "Admin Officers / Facility Executive", "team_lead_admin", "staff"],
];

export const BASE_ROLES: RoleDef[] = ROLE_SEEDS.map(([id, name, parentId, tier], i) => {
  const meta = TIER_META[tier];
  return {
    id,
    name,
    description: `${name} — ${tier} level.`,
    portal: meta.portal,
    scope: meta.scope,
    scopeLabel: scopeLabelFromScope(meta.scope),
    // Keep levels unique-ish per node so card sorting is stable within a tier.
    hierarchyLevel: meta.level * 100 + i,
    system: tier === "board",
    parentId,
    tier,
    accent: meta.accent,
  };
});

export const DEPARTMENTS = [
  { id: "executive", name: "Executive" },
  { id: "engineering", name: "Engineering" },
  { id: "production", name: "Production" },
  { id: "hr", name: "HR" },
  { id: "sales", name: "Sales" },
];

export const INITIAL_EMPLOYEES: DemoEmployee[] = [
  { id: "1001", name: "Mahnoor", initials: "MN", pseudonym: "MN-Exec", roleId: "mp_it", departmentId: "executive", reportsTo: null },
  { id: "1002", name: "Akhtar", initials: "AK", pseudonym: "AK-Finance", roleId: "mp_finance", departmentId: "executive", reportsTo: null },
  { id: "1003", name: "Saqib", initials: "SQ", pseudonym: "SQ-Medical", roleId: "mp_medical", departmentId: "executive", reportsTo: "1001" },
  { id: "1088", name: "Ali Hassan", initials: "AH", pseudonym: "Developer", roleId: "it_manager", departmentId: "engineering", reportsTo: "1001" },
  { id: "1201", name: "Sara Khan", initials: "SK", pseudonym: "SK-Billing", roleId: "team_lead_billing", departmentId: "production", reportsTo: "1003" },
  { id: "1210", name: "Omar Raza", initials: "OR", pseudonym: "OR-Coder", roleId: "junior_coder", departmentId: "production", reportsTo: "1201" },
  { id: "1042", name: "Zara Malik", initials: "ZM", pseudonym: "ZM-HR", roleId: "hr_manager", departmentId: "hr", reportsTo: "1003" },
  { id: "1220", name: "Bilal Hussain", initials: "BH", pseudonym: "BH-Senior", roleId: "senior_coder", departmentId: "production", reportsTo: "1201" },
  { id: "1315", name: "Hina Shah", initials: "HS", pseudonym: "HS-Ops", roleId: "billing_ops_manager", departmentId: "production", reportsTo: "1003" },
];

export const FEATURE_MODULES = withPermissionHints([
  {
    id: "data_scope",
    name: "Data scope",
    icon: "🔎",
    permissions: [
      {
        key: "data.scope.all_departments",
        label: "All departments (company-wide)",
      },
    ],
  },
  {
    id: "dashboard",
    name: "Dashboard & Admin",
    icon: "🏠",
    permissions: [
      { key: "dashboard.view", label: "View main dashboard" },
      { key: "admin.home.view", label: "View admin home" },
    ],
  },
  {
    id: "attendance",
    name: "Attendance",
    icon: "⏱",
    permissions: [
      { key: "attendance.summary.view", label: "View attendance summary" },
      { key: "attendance.summary.export", label: "Export attendance summary" },
      { key: "attendance.manage.edit", label: "Edit attendance records" },
      { key: "attendance.monthly.view", label: "View monthly attendance" },
      { key: "attendance.monthly.export", label: "Export deduction summary" },
      { key: "attendance.breaks.manage", label: "Manage breaks" },
      { key: "attendance.tungsten.view", label: "Tungsten IN/OUT page" },
      { key: "attendance.presence.view", label: "Presence / Idle page" },
      { key: "attendance.employee_report.view", label: "Employee attendance report" },
    ],
  },
  {
    id: "leave",
    name: "Leave / PTO",
    icon: "🌴",
    permissions: [
      { key: "leave.list.view", label: "View all leave requests" },
      { key: "leave.approve.manager", label: "Approve leave" },
      { key: "leave.approval_status.view", label: "View leave approval status" },
      { key: "leave.balances.edit", label: "Edit leave balances" },
      { key: "leave.calendar.view", label: "Leave calendar" },
      { key: "leave.monthly_summary.view", label: "Monthly leave summary" },
    ],
  },
  {
    id: "payroll",
    name: "Payroll & Finance",
    icon: "💰",
    permissions: [
      { key: "payroll.monthly.view", label: "View monthly payroll" },
      { key: "payroll.monthly.edit", label: "Edit monthly payroll" },
      { key: "payroll.daily.view", label: "View daily salary calculator" },
      { key: "payroll.daily.edit", label: "Edit daily salary records" },
      { key: "payroll.commissions", label: "Commissions" },
      { key: "payroll.advance", label: "Advance" },
      { key: "payroll.loan", label: "Loan" },
      { key: "payroll.financial_requests.view", label: "Financial request inbox" },
      {
        key: "department.salary.view",
        label: "View department salaries (Manager toggle)",
      },
    ],
  },
  {
    id: "people",
    name: "People & Onboarding",
    icon: "👤",
    permissions: [
      { key: "people.employee_list.view", label: "Employee list" },
      { key: "people.employee.add", label: "Add employee" },
      { key: "people.credentials.manage", label: "Employee credentials" },
      { key: "people.face_enrollment.manage", label: "Face enrollment" },
      { key: "people.files.view", label: "Employee files" },
      { key: "people.appraisals.view", label: "Pending appraisals" },
      { key: "people.formats.view", label: "Formats library" },
      { key: "people.recruitment.view", label: "Recruitment" },
    ],
  },
  {
    id: "shifts",
    name: "Shifts",
    icon: "📅",
    permissions: [
      { key: "shifts.scheduler.view", label: "Shift scheduler" },
      { key: "shifts.management.view", label: "Shift management" },
    ],
  },
  {
    id: "ops",
    name: "Operations & Org",
    icon: "🏢",
    permissions: [
      { key: "ops.tickets.view", label: "Ticket inbox" },
      { key: "ops.events.view", label: "Events" },
      { key: "ops.departments.view", label: "Departments" },
      { key: "ops.login_carousel.manage", label: "Login carousel" },
      { key: "ops.company_policy.view", label: "Company policy" },
    ],
  },
  {
    id: "team",
    name: "Team",
    icon: "👥",
    permissions: [
      { key: "team.dashboard.view", label: "Team dashboard" },
      { key: "team.attendance.view", label: "View team attendance (incl. self)" },
      { key: "team.breaks.view", label: "View team breaks (break + prayer)" },
      { key: "team.leaves.view", label: "View team leave applications" },
      { key: "team.management.assign", label: "Assign team members" },
    ],
  },
  {
    id: "department",
    name: "Department",
    icon: "🏛",
    permissions: [
      { key: "department.attendance.view", label: "View department attendance" },
      { key: "department.breaks.view", label: "View department breaks (break + prayer)" },
      { key: "department.leaves.view", label: "View department leave applications" },
      { key: "department.monthly.view", label: "View department monthly attendance" },
    ],
  },
  {
    id: "portal",
    name: "Employee portal",
    icon: "📱",
    permissions: [
      { key: "portal.my_info.view", label: "My Info" },
      { key: "portal.time.view", label: "Time / clock page" },
      { key: "portal.tickets.create", label: "Generate ticket" },
      { key: "portal.performance.view", label: "Performance" },
    ],
  },
  {
    id: "system",
    name: "System Control",
    icon: "⚙",
    permissions: [
      { key: "system.control.access", label: "Open System Control" },
      { key: "system.permissions.edit", label: "Edit permission checkmarks" },
      { key: "system.users.assign", label: "Assign roles to employees" },
      { key: "system.org_chart.edit", label: "Edit org chart cards" },
      { key: "system.features.edit", label: "Edit global features toggles" },
    ],
  },
]);

const ALL_PERMISSION_KEYS = FEATURE_MODULES.flatMap((m) =>
  m.permissions.map((p) => p.key),
);

/** Default granted permissions for a tier. Users fine-tune in Permissions tab. */
function permissionsForTier(tier: RoleTier): string[] {
  switch (tier) {
    case "board":
    case "partner":
      return ALL_PERMISSION_KEYS;
    case "director":
      return [
        "attendance.summary.view",
        "attendance.summary.export",
        "attendance.manage.edit",
        "attendance.monthly.view",
        "attendance.monthly.export",
        "leave.list.view",
        "leave.approve.manager",
        "leave.approval_status.view",
        "department.attendance.view",
        "department.breaks.view",
        "department.leaves.view",
        "department.monthly.view",
        "team.dashboard.view",
        "team.attendance.view",
        "team.breaks.view",
        "team.leaves.view",
        "team.management.assign",
        "payroll.monthly.view",
        "payroll.daily.view",
      ];
    case "manager":
      return [
        "attendance.summary.view",
        "attendance.manage.edit",
        "attendance.monthly.view",
        "leave.list.view",
        "leave.approve.manager",
        "leave.approval_status.view",
        "department.attendance.view",
        "department.breaks.view",
        "department.leaves.view",
        "department.monthly.view",
        "team.dashboard.view",
        "system.control.access",
        "system.permissions.edit",
        "system.users.assign",
        "system.org_chart.edit",
        "system.features.edit",
        // department.salary.view stays OFF by default — Manager enables in Permissions
      ];
    case "lead":
      return [
        "leave.list.view",
        "leave.approve.manager",
        "leave.approval_status.view",
        "department.leaves.view",
        "team.dashboard.view",
        "team.attendance.view",
        "team.breaks.view",
        "team.leaves.view",
      ];
    default:
      return [];
  }
}

export const DEFAULT_PERMISSIONS: Record<string, Set<string>> = Object.fromEntries(
  BASE_ROLES.map((r) => [r.id, new Set(permissionsForTier(r.tier ?? "staff"))]),
);

/** Extra defaults for HR System Control roles (ops + payroll; no dept salary; System Control only on hr_manager). */
const HR_ROLE_OPS = [
  "attendance.summary.view",
  "attendance.breaks.manage",
  "attendance.monthly.view",
  "attendance.manage.edit",
  "department.attendance.view",
  "department.breaks.view",
  "department.leaves.view",
  "department.monthly.view",
  "leave.list.view",
  "leave.approval_status.view",
  "leave.monthly_summary.view",
  "payroll.monthly.view",
  "payroll.daily.view",
  "payroll.daily.edit",
  "payroll.advance",
  "payroll.loan",
  "ops.tickets.view",
];
for (const roleId of ["hr_manager", "hr_coordinator", "team_lead_hr"]) {
  const set = DEFAULT_PERMISSIONS[roleId];
  if (!set) continue;
  for (const k of HR_ROLE_OPS) set.add(k);
  set.delete("department.salary.view");
  if (roleId !== "hr_manager") {
    for (const k of [...set]) {
      if (k.startsWith("system.")) set.delete(k);
    }
  }
}

/**
 * “Reset role to Default” = Officer / employee dashboard only.
 * Sidebar base tabs (Employee Dashboard, My Info, Generate Ticket) need no
 * System Control checkmarks — so the template is an empty permission set.
 * Tier-heavy DEFAULT_PERMISSIONS are NOT used here.
 */
export function defaultPermissionKeysForRole(
  _roleId?: string,
  _allRoles?: RoleDef[],
): string[] {
  return [];
}

export const GLOBAL_FEATURES: GlobalFeature[] = [
  {
    key: "hr_department_defaults",
    name: "HR department auto permissions",
    desc: "ON = HR staff automatically get the default HR pack (attendance, leave, payroll, tickets). OFF = only permissions assigned in System Control.",
    on: false,
  },
  {
    key: "all_employee_dashboard",
    name: "All profiles → employee dashboard",
    desc: "ON = every role (CEO, Team Lead, HR Manager, etc.) only sees the default employee dashboard. OFF = each role keeps its own menus from permissions.",
    on: true,
  },
  { key: "biometric", name: "Biometric face clock-in", desc: "Require face verify on clock in/out", on: true },
  { key: "tungsten", name: "Tungsten IN/OUT sync", desc: "Punch reconciliation page", on: true },
  { key: "prayer", name: "Prayer break tracking", desc: "Prayer module on employee time page", on: true },
  {
    key: "two_step_leave",
    name: "Two-step leave approval",
    desc: "1st step then 2nd step required before leave is final",
    on: true,
  },
  {
    key: "team_lead_module",
    name: "Team module",
    desc: "Org flag for team features; assigned team.* permissions still always show in the employee sidebar",
    on: false,
  },
  { key: "tickets", name: "Ticket system", desc: "Employee tickets and admin ticket inbox", on: true },
  { key: "recruitment", name: "Recruitment module", desc: "Recruitment workflows and pages", on: true },
  { key: "presence_agent", name: "Desktop presence agent", desc: "Presence / idle monitoring integration", on: true },
  { key: "login_carousel", name: "Login carousel", desc: "Branded login page slides", on: true },
  { key: "employee_files", name: "Employee files", desc: "HR document library for employees", on: true },
  { key: "appraisals", name: "Appraisals", desc: "Pending appraisal workflows", on: true },
  { key: "financial_requests", name: "Financial requests", desc: "Advance/loan request inbox", on: true },
  { key: "events", name: "Company events", desc: "Upcoming events module", on: true },
  { key: "shift_management", name: "Shift management", desc: "Shift scheduler and management pages", on: true },
];

export const TAB_HINT: Record<TabId, string> = {
  roles: "Drag any card onto another to change its reporting line. Click a card to add a role under it, rename it, set its level, or delete it. All card changes are saved to the database and survive refresh.",
  permissions: "Select a role to configure permissions across every HRM module, assign it to a live employee, then Save — stored in Mongo/MySQL.",
  features: "Globally enable or disable features for the entire organization. Save writes to the database.",
};

/** Managing partners — each owns one org-chart department column. */
export const ORG_DEPT_ROOT_IDS = ["mp_it", "mp_finance", "mp_medical"] as const;

/** "Managing Partner — IT & Technology" → "IT & Technology" */
export function deptSectionLabel(partnerName: string): string {
  const dash = partnerName.indexOf("—");
  if (dash >= 0) return partnerName.slice(dash + 1).trim();
  return partnerName;
}

/** Pre-order traversal of a role subtree (root included), top-down like the org chart. */
export function rolesInSubtree(roles: RoleDef[], rootId: string): RoleDef[] {
  const root = roles.find((r) => r.id === rootId);
  if (!root) return [];
  const out: RoleDef[] = [root];
  const walk = (parentId: string) => {
    const kids = childRoles(roles, parentId).sort(
      (a, b) => a.hierarchyLevel - b.hierarchyLevel,
    );
    for (const k of kids) {
      out.push(k);
      walk(k.id);
    }
  };
  walk(rootId);
  return out;
}

/** Department branch root (`mp_*`) for a role, or null when above the three columns. */
export function deptRootForRole(roles: RoleDef[], roleId: string): string | null {
  let cur = roles.find((r) => r.id === roleId);
  while (cur) {
    if ((ORG_DEPT_ROOT_IDS as readonly string[]).includes(cur.id)) return cur.id;
    if (cur.parentId == null) return null;
    cur = roles.find((r) => r.id === cur!.parentId);
  }
  return null;
}

export type RoleSectionGroup = {
  id: string;
  title: string;
  roles: RoleDef[];
  variant: "executive" | "department";
};

/** Group roles into executive + three org-chart department sections. */
export function groupRolesByOrgSection(roles: RoleDef[]): RoleSectionGroup[] {
  const sections: RoleSectionGroup[] = [];

  const topRoles = roles
    .filter((r) => {
      if ((ORG_DEPT_ROOT_IDS as readonly string[]).includes(r.id)) return false;
      return deptRootForRole(roles, r.id) === null;
    })
    .sort((a, b) => a.hierarchyLevel - b.hierarchyLevel);

  if (topRoles.length > 0) {
    sections.push({
      id: "executive",
      title: "Executive Board",
      roles: topRoles,
      variant: "executive",
    });
  }

  for (const rootId of ORG_DEPT_ROOT_IDS) {
    const root = roles.find((r) => r.id === rootId);
    if (!root) continue;
    const subtree = rolesInSubtree(roles, rootId);
    if (subtree.length === 0) continue;
    sections.push({
      id: rootId,
      title: deptSectionLabel(root.name),
      roles: subtree,
      variant: "department",
    });
  }

  const assigned = new Set(sections.flatMap((s) => s.roles.map((r) => r.id)));
  const orphans = roles.filter((r) => !assigned.has(r.id));
  if (orphans.length > 0) {
    sections.push({
      id: "other",
      title: "Other roles",
      roles: orphans.sort((a, b) => a.hierarchyLevel - b.hierarchyLevel),
      variant: "executive",
    });
  }

  return sections;
}

export function clonePermissionMap() {
  const out: Record<string, Set<string>> = {};
  for (const [roleId, set] of Object.entries(DEFAULT_PERMISSIONS)) {
    out[roleId] = new Set(set);
  }
  return out;
}

export function scopeLabelFromScope(scope: string) {
  const map: Record<string, string> = {
    ALL: "ALL company",
    DEPARTMENT: "DEPARTMENT",
    TEAM: "TEAM",
    SELF: "SELF",
  };
  return map[scope] || scope;
}

export function slugifyRoleName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function roleMeta(roleId: string, allRoles: RoleDef[]) {
  return (
    allRoles.find((r) => r.id === roleId) ||
    allRoles.find((r) => r.id === "exec_board") ||
    BASE_ROLES[0]
  );
}

export function isSystemRole(roleId: string) {
  const base = BASE_ROLES.find((r) => r.id === roleId);
  return Boolean(base?.system);
}

export function isCustomRole(roleId: string, customRoles?: RoleDef[]) {
  if (customRoles && customRoles.length) {
    return customRoles.some((r) => r.id === roleId);
  }
  return !BASE_ROLES.some((r) => r.id === roleId);
}

export function isRoleLocked(roleId: string) {
  return roleId === "exec_board";
}

/** Direct children of a role in the org tree. */
export function childRoles(roles: RoleDef[], parentId: string | null) {
  return roles.filter((r) => (r.parentId ?? null) === parentId);
}

/**
 * True if `maybeDescendantId` sits anywhere below `rootId` in the tree. Used to
 * stop an illegal drag-drop that would create a cycle (dropping a role onto one
 * of its own descendants).
 */
export function isDescendantOf(
  roles: RoleDef[],
  rootId: string,
  maybeDescendantId: string,
): boolean {
  const stack = [...childRoles(roles, rootId)];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === maybeDescendantId) return true;
    stack.push(...childRoles(roles, node.id));
  }
  return false;
}

export function empNameById(employees: DemoEmployee[], id: string | null) {
  if (!id) return null;
  return employees.find((e) => e.id === id)?.name || null;
}

export function deptNameById(deptId: string) {
  return DEPARTMENTS.find((d) => d.id === deptId)?.name || deptId;
}

/** Top CEO cards on Org Chart → All (match live employee names). */
export const ORG_CEO_NAME_HINTS = ["Joe", "Max", "Mubeen"] as const;

/**
 * Department manager map (display keys).
 * Marketing is folded under IT (not a separate manager chip bucket).
 * Mubeen → IT + Marketing + CEst. | Max → HIT + HR + Medical Billing + Finance | Joe → DM
 */
export const ORG_DEPT_MANAGER_NAME: Record<string, string> = {
  IT: "Mubeen",
  "CEst.": "Mubeen",
  HIT: "Max",
  HR: "Max",
  "Medical Billing": "Max",
  Finance: "Max",
  DM: "Joe",
};

function normDeptToken(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

/** Canonical chip label for an HRM department name.
 *  Marketing (standalone) → IT; Digital Marketing / DM / Analytics → DM.
 */
export function orgDeptChipLabel(departmentName: string | undefined | null): string | null {
  const t = normDeptToken(departmentName || "");
  if (!t) return null;
  // DM must win before generic "marketing" → IT (Digital Marketing contains "marketing")
  if (
    t === "dm" ||
    t === "digital marketing" ||
    t.startsWith("dm ") ||
    t.includes("digital marketing") ||
    (t.includes("analytics") && !t.includes("data mining")) ||
    t === "dm / analytics" ||
    t.includes("dm /")
  ) {
    return "DM";
  }
  // Marketing (standalone / IT Marketing) → IT. Digital Marketing already returned DM above.
  if (
    t === "marketing" ||
    t === "it marketing" ||
    t.startsWith("marketing ") ||
    (t.includes("marketing") && t.includes("it") && !t.includes("digital"))
  ) {
    return "IT";
  }
  if (t === "it" || t === "tech" || t.includes("technology") || t.startsWith("it ")) {
    return "IT";
  }
  // CEst. / CEST / C Est — any token containing cest
  if (t === "cest" || t === "c est" || t.includes("cest")) return "CEst.";
  if (t === "hit") return "HIT";
  if (t === "hr" || t === "human resources") return "HR";
  if (
    t === "medical billing" ||
    t.includes("medical billing") ||
    t === "billing" ||
    (t.includes("billing") && t.includes("medical"))
  ) {
    return "Medical Billing";
  }
  if (t === "finance" || t === "accounts") return "Finance";
  return String(departmentName || "").trim() || null;
}

/** Whether an employee belongs in a selected org-dept chip view. */
export function employeeMatchesOrgDept(
  emp: DemoEmployee,
  chipLabel: string,
): boolean {
  const empChip = orgDeptChipLabel(emp.departmentName || emp.departmentId);
  if (!empChip) return false;
  if (chipLabel === "IT") {
    const raw = normDeptToken(emp.departmentName || "");
    // Marketing folds into IT; Digital Marketing is DM (handled by orgDeptChipLabel)
    if (empChip === "IT") return true;
    if (raw === "marketing") return true;
    return false;
  }
  return empChip.toLowerCase() === chipLabel.toLowerCase();
}

/** Unique department chips for Org Chart (All + depts). Marketing folded into IT. */
export function listOrgDeptChips(employees: DemoEmployee[]): string[] {
  const seen = new Map<string, string>();
  for (const e of employees) {
    const label = orgDeptChipLabel(e.departmentName || e.departmentId);
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  }
  // Prefer known order, then the rest A–Z
  const preferred = ["IT", "CEst.", "HIT", "HR", "Medical Billing", "Finance", "DM"];
  const rest = [...seen.values()]
    .filter((l) => !preferred.some((p) => p.toLowerCase() === l.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const ordered = [
    ...preferred.filter((p) => seen.has(p.toLowerCase())),
    ...rest,
  ];
  return ordered;
}

export function employeesInOrgDept(
  employees: DemoEmployee[],
  chipLabel: string,
): DemoEmployee[] {
  return employees
    .filter((e) => employeeMatchesOrgDept(e, chipLabel))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function nameLooksLike(empName: string, hint: string): boolean {
  const n = empName.trim().toLowerCase();
  const h = hint.trim().toLowerCase();
  if (!n || !h) return false;
  return n === h || n.startsWith(h + " ") || n.includes(" " + h) || n.includes(h);
}

/** Resolve department manager from live employees by configured name hint. */
export function findOrgDeptManager(
  employees: DemoEmployee[],
  chipLabel: string,
): DemoEmployee | null {
  const hint =
    ORG_DEPT_MANAGER_NAME[chipLabel] ||
    ORG_DEPT_MANAGER_NAME[
      Object.keys(ORG_DEPT_MANAGER_NAME).find(
        (k) => k.toLowerCase() === chipLabel.toLowerCase(),
      ) || ""
    ];
  if (!hint) return null;
  const inDept = employeesInOrgDept(employees, chipLabel);
  const fromDept = inDept.find((e) => nameLooksLike(e.name, hint));
  if (fromDept) return fromDept;
  return employees.find((e) => nameLooksLike(e.name, hint)) ?? null;
}

/** Top CEO cards for All view (ordered). Missing names → placeholder stubs. */
export function resolveOrgCeoCards(employees: DemoEmployee[]): DemoEmployee[] {
  return ORG_CEO_NAME_HINTS.map((hint, i) => {
    const found = employees.find((e) => nameLooksLike(e.name, hint));
    if (found) return found;
    return {
      id: `ceo-placeholder-${i}`,
      name: hint,
      initials: hint.slice(0, 2).toUpperCase(),
      roleId: "",
      departmentId: "executive",
      departmentName: "Executive",
      reportsTo: null,
    };
  });
}
