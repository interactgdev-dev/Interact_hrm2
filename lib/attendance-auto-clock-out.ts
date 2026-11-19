/** MySQL TINYINT(1) may arrive as 0/1, boolean, or string. */
export function isAutoClockOutRecord(
  value: boolean | number | string | null | undefined,
): boolean {
  return value === true || value === 1 || value === "1";
}

/** Valid clock / T.Punch display value (not empty / placeholder). */
export function isValidTPunchOutTime(value: string | null | undefined): boolean {
  const tp = String(value ?? "").trim();
  return Boolean(tp) && tp !== "-" && tp !== "---";
}

/**
 * Auto clock-out rows must show the same time in Clock Out and T.Punch Out.
 * - Prefer real T.Punch Out → copy into Clock Out
 * - If T.Punch Out is still empty (pairing lag / miss) but Clock Out was
 *   reconciled to the Tungsten exit → copy into T.Punch Out so the column
 *   is never blank for auto-closed sessions.
 */
export function applyAutoClockOutTPunchDisplay<
  T extends { hrmClockOut: string; tungstenPunchOut: string },
>(
  session: T,
  autoClockOut: boolean | number | string | null | undefined,
): T {
  if (!isAutoClockOutRecord(autoClockOut)) return session;

  const hasTp = isValidTPunchOutTime(session.tungstenPunchOut);
  const hasOut = isValidTPunchOutTime(session.hrmClockOut);

  if (hasTp && session.hrmClockOut !== session.tungstenPunchOut) {
    return { ...session, hrmClockOut: session.tungstenPunchOut };
  }
  if (!hasTp && hasOut) {
    return { ...session, tungstenPunchOut: session.hrmClockOut };
  }
  return session;
}
