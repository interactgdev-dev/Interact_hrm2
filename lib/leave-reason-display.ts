/** UI display: strip internal `[ticket:123]` markers from leave reason text. */
export function displayLeaveReason(reason: unknown): string {
  return String(reason || "")
    .replace(/\[ticket:\d+\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
