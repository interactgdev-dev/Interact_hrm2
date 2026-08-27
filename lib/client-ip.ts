import type { NextRequest } from "next/server";

/** Client IP for server-side audit (clock-in / clock-out). Not for display. */
export function getRequestClientIp(req: NextRequest): string | null {
  const candidates: Array<string | null | undefined> = [
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    req.headers.get("x-real-ip")?.trim(),
    req.headers.get("x-client-ip")?.trim(),
    typeof (req as { ip?: string }).ip === "string"
      ? (req as { ip?: string }).ip
      : null,
  ];
  for (const raw of candidates) {
    if (!raw || raw.toLowerCase() === "unknown") continue;
    const ip = raw.replace(/^::ffff:/i, "").trim();
    if (ip) return ip.slice(0, 64);
  }
  return null;
}
