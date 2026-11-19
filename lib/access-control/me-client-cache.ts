/**
 * Deduplicate /api/access-control/me on the client (layout + page + hooks).
 * Short TTL so permission changes still refresh soon after navigation.
 */

type MePayload = Record<string, unknown> & { success?: boolean };

let inflightEid = "";
let inflight: Promise<MePayload> | null = null;
let cachedEid = "";
let cachedAt = 0;
let cachedPayload: MePayload | null = null;

const TTL_MS = 20_000;

export function fetchAccessControlMe(employeeId: string): Promise<MePayload> {
  const eid = String(employeeId || "").trim();
  if (!eid) {
    return Promise.resolve({ success: false, error: "employeeId required" });
  }

  if (
    cachedPayload &&
    cachedEid === eid &&
    Date.now() - cachedAt < TTL_MS
  ) {
    return Promise.resolve(cachedPayload);
  }

  if (inflight && inflightEid === eid) {
    return inflight;
  }

  inflightEid = eid;
  inflight = fetch(
    `/api/access-control/me?employeeId=${encodeURIComponent(eid)}`,
    { cache: "no-store" },
  )
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as MePayload;
      if (data?.success) {
        cachedEid = eid;
        cachedAt = Date.now();
        cachedPayload = data;
      }
      return data;
    })
    .finally(() => {
      if (inflightEid === eid) {
        inflight = null;
        inflightEid = "";
      }
    });

  return inflight;
}

export function invalidateAccessControlMeCache(employeeId?: string) {
  const eid = String(employeeId || "").trim();
  if (!eid || cachedEid === eid) {
    cachedEid = "";
    cachedAt = 0;
    cachedPayload = null;
  }
}
