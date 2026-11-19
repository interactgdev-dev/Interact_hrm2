/**
 * Normalize employee id string forms so "097" and "97" resolve the same maps.
 * Used for attendance / leave / unpaid-days joins (not just salary money maps).
 */

export function employeeIdKeys(raw: string | number | undefined | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const keys = [s];
  if (/^\d+$/.test(s)) {
    const n = String(Number(s));
    if (n !== s) keys.push(n);
  }
  return keys;
}

/** First matching entry across id key variants. */
export function lookupByEmployeeId<T>(
  map: Record<string, T> | null | undefined,
  empId: string | number | undefined | null,
): T | undefined {
  if (!map) return undefined;
  for (const k of employeeIdKeys(empId)) {
    if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
  }
  return undefined;
}

/** Write the same value under every id key variant. */
export function setForEmployeeIdKeys<T>(
  map: Record<string, T>,
  empId: string | number | undefined | null,
  value: T,
): void {
  for (const k of employeeIdKeys(empId)) {
    map[k] = value;
  }
}
