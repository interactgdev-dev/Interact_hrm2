/**
 * Convert a stored upload path (e.g. `/uploads/uuid.png` or
 * `/uploads/employee-files/x.pdf`) into a URL served by the API route.
 * Next.js production does not serve files written to `public/` after build.
 */
export function uploadServeUrl(filePath: string): string {
  const raw = String(filePath || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/api/uploads/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  const normalized = raw.replace(/\\/g, "/");
  const withoutPrefix = normalized.replace(/^\/?uploads\//i, "");
  const parts = withoutPrefix.split("/").filter(Boolean).map(encodeURIComponent);
  if (!parts.length) return "";
  return `/api/uploads/${parts.join("/")}`;
}
