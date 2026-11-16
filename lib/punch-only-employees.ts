/**
 * Punch-only Admin Staff (no HRM clock-in): Monthly Attendance shows
 * T.Punch In = first punch at/after shift start,
 * T.Punch Out = last Tungsten punch in overnight shift span
 * (from shift start until next day's shift start — same as Khalid pilot).
 *
 * IDs + ZKBio PINs restored from staging setup (fix-employee-codes-6.sql),
 * with Javaid Sunny pin corrected to live ZKBio pin 140010.
 */

export type PunchOnlyEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  pin: string;
  departmentName: string;
};

export const PUNCH_ONLY_EMPLOYEES: PunchOnlyEmployee[] = [
  { id: "83", firstName: "Zahid", lastName: "Ali", pin: "140001", departmentName: "Admin" },
  {
    id: "84",
    firstName: "Muhammad Pervaiz",
    lastName: "Sharif",
    pin: "140004",
    departmentName: "Admin",
  },
  { id: "153", firstName: "Mehdi", lastName: "Hussain", pin: "140005", departmentName: "Admin" },
  { id: "154", firstName: "Waqas", lastName: "Ahmad", pin: "140003", departmentName: "Admin" },
  {
    id: "155",
    firstName: "Muhammad",
    lastName: "Khalid",
    pin: "140014",
    departmentName: "Admin",
  },
  { id: "156", firstName: "Javaid", lastName: "Sunny", pin: "140010", departmentName: "Admin" },
  // Admin Staff punch-only (ZK pin 140015) — punches only, no 1st/2nd half attendance rules
  { id: "160", firstName: "Dawood", lastName: "Masih", pin: "140015", departmentName: "Admin" },
  // Admin Staff punch-only (ZK pin 159)
  { id: "161", firstName: "Irfan", lastName: "Masih", pin: "159", departmentName: "Admin" },
];

export const PUNCH_ONLY_EMPLOYEE_IDS = new Set(PUNCH_ONLY_EMPLOYEES.map((e) => e.id));

/** All Admin punch-only staff: T.Out = last punch in overnight span (Khalid logic). */
export const PUNCH_ONLY_LAST_SPAN_OUT_IDS = new Set(
  PUNCH_ONLY_EMPLOYEES.map((e) => e.id),
);

export function punchOnlyUsesLastSpanOut(employeeId: string): boolean {
  return PUNCH_ONLY_LAST_SPAN_OUT_IDS.has(String(employeeId));
}

/**
 * Midnight-shift exit: T.Out = last punch after midnight (shift end) until morning
 * cap — not next-day late-morning / midday return punches.
 * Only Pervaiz for now; other Admin punch-only keep Khalid noon-span logic.
 */
export const PUNCH_ONLY_MIDNIGHT_EXIT_IDS = new Set(["84"]);

export function punchOnlyUsesMidnightExitLastOut(employeeId: string): boolean {
  return PUNCH_ONLY_MIDNIGHT_EXIT_IDS.has(String(employeeId));
}

/** Morning after overnight — punches at/after this are next-day arrivals, not T.Out. */
export const PUNCH_ONLY_MIDNIGHT_EXIT_MORNING_CAP = "08:00:00";

/** Historical office-boy shift used on staging when these cards worked. */
export const PUNCH_ONLY_DEFAULT_SHIFT = {
  startTime: "13:00:00",
  endTime: "00:00:00",
} as const;

export function punchOnlyById(employeeId: string): PunchOnlyEmployee | undefined {
  return PUNCH_ONLY_EMPLOYEES.find((e) => e.id === String(employeeId));
}

export function punchOnlyPinForId(employeeId: string): string | undefined {
  return punchOnlyById(employeeId)?.pin;
}

export function punchOnlyDisplayName(e: PunchOnlyEmployee): string {
  return `${e.firstName} ${e.lastName}`.trim();
}
