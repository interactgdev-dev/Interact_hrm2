export type ZkIdentity = {
  employeeName: string;
  department: string;
};

export type PinProfile = {
  firstName: string;
  lastName: string;
  department: string;
};

export type HrmCodeProfile = {
  employeeName: string;
  department: string;
};

function trimStr(v: unknown) {
  return String(v ?? "").trim();
}

function nameFromParts(first: string, last: string) {
  return `${first} ${last}`.trim();
}

/** Latest named punch per PIN from a batch (newest event first). */
export function buildPinProfilesFromRows(rows: Record<string, unknown>[]): Map<string, PinProfile> {
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(String(a.event_time || a.imported_at || "")).getTime();
    const tb = new Date(String(b.event_time || b.imported_at || "")).getTime();
    return tb - ta;
  });

  const map = new Map<string, PinProfile>();
  for (const z of sorted) {
    const pin = trimStr(z.pin);
    if (!pin || map.has(pin)) continue;

    const first = trimStr(z.first_name);
    const last = trimStr(z.last_name);
    const dept = trimStr(z.dept_name);
    if (!nameFromParts(first, last) && !dept) continue;

    map.set(pin, { firstName: first, lastName: last, department: dept });
  }
  return map;
}

export function resolveZkIdentity(
  z: Record<string, unknown>,
  batchProfiles: Map<string, PinProfile>,
  dbProfiles: Map<string, PinProfile>,
  hrmByCode: Map<string, HrmCodeProfile>,
): ZkIdentity {
  const pin = trimStr(z.pin);
  let first = trimStr(z.first_name);
  let last = trimStr(z.last_name);
  let dept = trimStr(z.dept_name);

  if (!nameFromParts(first, last) && pin) {
    const profile = batchProfiles.get(pin) || dbProfiles.get(pin);
    if (profile) {
      first = profile.firstName || first;
      last = profile.lastName || last;
      dept = dept || profile.department;
    } else {
      const hrm = hrmByCode.get(pin);
      if (hrm) {
        return {
          employeeName: hrm.employeeName,
          department: hrm.department || "-",
        };
      }
    }
  }

  const employeeName = nameFromParts(first, last) || "—";
  return {
    employeeName,
    department: dept || "-",
  };
}

export function profileMapsFromApi(
  profiles: { pin: string; first_name?: string; last_name?: string; dept_name?: string }[],
): Map<string, PinProfile> {
  const map = new Map<string, PinProfile>();
  for (const p of profiles) {
    const pin = trimStr(p.pin);
    if (!pin) continue;
    map.set(pin, {
      firstName: trimStr(p.first_name),
      lastName: trimStr(p.last_name),
      department: trimStr(p.dept_name),
    });
  }
  return map;
}

export function hrmMapFromEmployees(
  employees: {
    first_name?: string;
    last_name?: string;
    employee_code?: string | null;
    department_name?: string | null;
  }[],
): Map<string, HrmCodeProfile> {
  const map = new Map<string, HrmCodeProfile>();
  for (const e of employees) {
    const code = trimStr(e.employee_code);
    if (!code) continue;
    const employeeName =
      nameFromParts(trimStr(e.first_name), trimStr(e.last_name)) || "—";
    map.set(code, {
      employeeName,
      department: trimStr(e.department_name) || "-",
    });
  }
  return map;
}
