export type HierarchyPerson = {
  id: string;
  name: string;
  initials: string;
  role: string;
  jobTitle: string | null;
  departmentName: string | null;
  pseudonym: string | null;
  photo: string | null;
  status: string | null;
};

export type EmployeeHierarchy = {
  employeeId: string;
  role: string;
  departmentName: string | null;
  jobTitle: string | null;
  reportsTo: HierarchyPerson | null;
  teamMembers: HierarchyPerson[];
  isTeamLead: boolean;
};

const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; data: EmployeeHierarchy | null }>();
const inflight = new Map<string, Promise<EmployeeHierarchy | null>>();

export function clearEmployeeHierarchyCache(employeeId?: string) {
  if (employeeId) {
    cache.delete(String(employeeId).trim());
    inflight.delete(String(employeeId).trim());
    return;
  }
  cache.clear();
  inflight.clear();
}

/** Sync peek for instant paint on My Team / dashboard when cache is warm. */
export function peekEmployeeHierarchyCache(
  employeeId: string,
): EmployeeHierarchy | null | undefined {
  const id = String(employeeId || "").trim();
  if (!id) return undefined;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  return undefined;
}

export async function fetchEmployeeHierarchy(
  employeeId: string,
): Promise<EmployeeHierarchy | null> {
  const id = String(employeeId || "").trim();
  if (!id) return null;

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  const pending = inflight.get(id);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(
        `/api/employee-hierarchy?employeeId=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      const result = data.success ? (data as EmployeeHierarchy) : null;
      cache.set(id, { at: Date.now(), data: result });
      return result;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, request);
  return request;
}
