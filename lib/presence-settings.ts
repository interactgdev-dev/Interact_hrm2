import { ensureAdminSettingsTable } from "@/lib/admin-settings";
import { pool } from "@/lib/db";

const TABLE = "hrm_admin_settings";

export type PresenceSettings = {
  /**
   * When true, all desktop agents must shut down permanently (disable auto-start + exit).
   * Heartbeat keeps returning exit until agents stop checking in.
   */
  agentsRetired: boolean;
  /** Master switch — desktop agent idle monitoring on/off */
  presenceEnabled: boolean;
  /** Seconds of no mouse/keyboard before action (legacy; face scan uses faceScanIntervalSeconds) */
  idleWarningSeconds: number;
  /** Countdown on "Are you there?" before auto-log (legacy prompt; Guard may skip) */
  popupCountdownSeconds: number;
  /**
   * true = idle then camera/face enrollment check (same as clock/break)
   * false = idle mouse/keyboard only → popup (no camera)
   */
  cameraVerificationEnabled: boolean;
  /** After seated match, wait this long before another check while still idle (legacy) */
  recheckWhileIdleSeconds: number;
  /**
   * Guard: while clocked in and NOT on break, run face verify this often (seconds).
   * Idle state is ignored — timer only. Default for everyone without an override.
   */
  faceScanIntervalSeconds: number;
  /**
   * Per-employee face scan interval overrides (employee id → seconds).
   * Wins over department + default.
   */
  faceScanIntervalByEmployee: Record<string, number>;
  /**
   * Per-department face scan interval overrides (department id → seconds).
   * Used when no employee override. Wins over default.
   */
  faceScanIntervalByDepartment: Record<string, number>;
  /** Guard: max face-verify attempts before seat-absent ticket (default 3). */
  faceVerifyMaxAttempts: number;
  /** Guard: seconds between failed face-verify attempts (default 10). */
  faceVerifyRetryGapSeconds: number;
  /**
   * Password required to Exit the desktop agent from the tray.
   * Synced to agents; only admins should know this value.
   */
  agentExitPassword: string;
  /**
   * Employee IDs allowed to run presence agent.
   * Empty array = all employees (when presenceEnabled is true).
   */
  enabledEmployeeIds: string[];
  /** Admin master switch — Guard agents upload full-screen screenshots when on. */
  screenshotCaptureEnabled: boolean;
  /** Seconds between Guard auto screenshots (5–3600). */
  screenshotIntervalSeconds: number;
  /** JPEG quality 10–95 — lower = smaller files. Synced to Guard agents. */
  screenshotJpegQuality: number;
  /** Capture scale 25–100% of screen pixels — lower = smaller files. */
  screenshotScalePercent: number;
  /**
   * HRM base URL agents should use (set on admin page; synced via heartbeat).
   * Example staging: https://192.168.10.6:8443
   */
  agentHrmBaseUrl: string;
};

export const DEFAULT_PRESENCE_SETTINGS: PresenceSettings = {
  agentsRetired: false,
  presenceEnabled: true,
  idleWarningSeconds: 1800,
  popupCountdownSeconds: 60,
  cameraVerificationEnabled: true,
  recheckWhileIdleSeconds: 120,
  faceScanIntervalSeconds: 600,
  faceScanIntervalByEmployee: {},
  faceScanIntervalByDepartment: {},
  faceVerifyMaxAttempts: 3,
  faceVerifyRetryGapSeconds: 10,
  agentExitPassword: "InteractAdmin",
  enabledEmployeeIds: [],
  screenshotCaptureEnabled: false,
  /** 300s default — agents stagger across the window (no stampede). */
  screenshotIntervalSeconds: 300,
  /** Low preset defaults — smaller uploads keep staging stable. */
  screenshotJpegQuality: 35,
  screenshotScalePercent: 40,
  agentHrmBaseUrl: "https://192.168.10.6:8443",
};

const KEYS = {
  agentsRetired: "presence_agents_retired",
  presenceEnabled: "presence_enabled",
  idleWarningSeconds: "presence_idle_warning_seconds",
  popupCountdownSeconds: "presence_popup_countdown_seconds",
  cameraVerificationEnabled: "presence_camera_verification_enabled",
  recheckWhileIdleSeconds: "presence_recheck_while_idle_seconds",
  faceScanIntervalSeconds: "presence_face_scan_interval_seconds",
  faceScanIntervalByEmployee: "presence_face_scan_interval_by_employee",
  faceScanIntervalByDepartment: "presence_face_scan_interval_by_department",
  faceVerifyMaxAttempts: "presence_face_verify_max_attempts",
  faceVerifyRetryGapSeconds: "presence_face_verify_retry_gap_seconds",
  agentExitPassword: "presence_agent_exit_password",
  enabledEmployeeIds: "presence_enabled_employee_ids",
  screenshotCaptureEnabled: "presence_screenshot_capture_enabled",
  screenshotIntervalSeconds: "presence_screenshot_interval_seconds",
  screenshotJpegQuality: "presence_screenshot_jpeg_quality",
  screenshotScalePercent: "presence_screenshot_scale_percent",
  agentHrmBaseUrl: "presence_agent_hrm_base_url",
} as const;

async function getRaw(key: string): Promise<string | null> {
  await ensureAdminSettingsTable();
  const [rows] = await pool.execute(
    `SELECT setting_value FROM ${TABLE} WHERE setting_key = ? LIMIT 1`,
    [key]
  );
  const list = rows as { setting_value: string }[];
  return list[0]?.setting_value ?? null;
}

async function setRaw(key: string, value: string): Promise<void> {
  await ensureAdminSettingsTable();
  await pool.execute(
    `INSERT INTO ${TABLE} (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function parseIntClamped(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseIdList(raw: string | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .map((v) => String(v ?? "").trim())
          .filter((v) => v.length > 0)
      ),
    ];
  } catch {
    return [];
  }
}

function normalizeIdList(input: unknown): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input
        .map((v) => String(v ?? "").trim())
        .filter((v) => v.length > 0)
    ),
  ];
}

function parseIntervalMap(raw: string | null): Record<string, number> {
  if (raw == null || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = String(k ?? "").trim();
      if (!id) continue;
      const n = parseIntClamped(String(v), 0, 30, 86400);
      if (n >= 30) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeIntervalMap(input: unknown): Record<string, number> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const id = String(k ?? "").trim();
    if (!id) continue;
    const n = parseIntClamped(String(v), 0, 30, 86400);
    if (n >= 30) out[id] = n;
  }
  return out;
}

function defaultFaceScanInterval(settings: PresenceSettings): number {
  if (settings.faceScanIntervalSeconds > 0) return settings.faceScanIntervalSeconds;
  if (settings.idleWarningSeconds > 0) return settings.idleWarningSeconds;
  return DEFAULT_PRESENCE_SETTINGS.faceScanIntervalSeconds;
}

/**
 * Effective face-scan interval for an assigned employee.
 * Priority: employee override → department override → global default.
 */
export async function resolveFaceScanIntervalSeconds(
  settings: PresenceSettings,
  employeeId: string | number | null | undefined
): Promise<number> {
  const fallback = defaultFaceScanInterval(settings);
  const empKey = String(employeeId ?? "").trim();
  if (!empKey) return fallback;

  const empOverride = settings.faceScanIntervalByEmployee[empKey];
  if (empOverride != null && empOverride >= 30) return empOverride;

  try {
    const [rows] = await pool.execute(
      `SELECT department_id FROM employee_jobs WHERE employee_id = ? LIMIT 1`,
      [empKey]
    );
    const deptId = String(
      (rows as { department_id?: number | string | null }[])[0]?.department_id ??
        ""
    ).trim();
    if (deptId) {
      const deptOverride = settings.faceScanIntervalByDepartment[deptId];
      if (deptOverride != null && deptOverride >= 30) return deptOverride;
    }
  } catch {
    /* jobs optional */
  }

  return fallback;
}

export async function getPresenceSettings(): Promise<PresenceSettings> {
  const d = DEFAULT_PRESENCE_SETTINGS;
  const [
    agentsRetired,
    presenceEnabled,
    idleWarningSeconds,
    popupCountdownSeconds,
    cameraVerificationEnabled,
    recheckWhileIdleSeconds,
    faceScanIntervalSeconds,
    faceScanIntervalByEmployee,
    faceScanIntervalByDepartment,
    faceVerifyMaxAttempts,
    faceVerifyRetryGapSeconds,
    agentExitPassword,
    enabledEmployeeIds,
    screenshotCaptureEnabled,
    screenshotIntervalSeconds,
    screenshotJpegQuality,
    screenshotScalePercent,
    agentHrmBaseUrl,
  ] = await Promise.all([
    getRaw(KEYS.agentsRetired),
    getRaw(KEYS.presenceEnabled),
    getRaw(KEYS.idleWarningSeconds),
    getRaw(KEYS.popupCountdownSeconds),
    getRaw(KEYS.cameraVerificationEnabled),
    getRaw(KEYS.recheckWhileIdleSeconds),
    getRaw(KEYS.faceScanIntervalSeconds),
    getRaw(KEYS.faceScanIntervalByEmployee),
    getRaw(KEYS.faceScanIntervalByDepartment),
    getRaw(KEYS.faceVerifyMaxAttempts),
    getRaw(KEYS.faceVerifyRetryGapSeconds),
    getRaw(KEYS.agentExitPassword),
    getRaw(KEYS.enabledEmployeeIds),
    getRaw(KEYS.screenshotCaptureEnabled),
    getRaw(KEYS.screenshotIntervalSeconds),
    getRaw(KEYS.screenshotJpegQuality),
    getRaw(KEYS.screenshotScalePercent),
    getRaw(KEYS.agentHrmBaseUrl),
  ]);

  return {
    agentsRetired: parseBool(agentsRetired, d.agentsRetired),
    presenceEnabled: parseBool(presenceEnabled, d.presenceEnabled),
    idleWarningSeconds: parseIntClamped(idleWarningSeconds, d.idleWarningSeconds, 10, 86400),
    popupCountdownSeconds: parseIntClamped(
      popupCountdownSeconds,
      d.popupCountdownSeconds,
      10,
      600
    ),
    cameraVerificationEnabled: parseBool(
      cameraVerificationEnabled,
      d.cameraVerificationEnabled
    ),
    recheckWhileIdleSeconds: parseIntClamped(
      recheckWhileIdleSeconds,
      d.recheckWhileIdleSeconds,
      30,
      7200
    ),
    faceScanIntervalSeconds: parseIntClamped(
      faceScanIntervalSeconds,
      // Fall back to former idle timeout so existing installs keep a sensible cadence
      parseIntClamped(idleWarningSeconds, d.faceScanIntervalSeconds, 30, 86400),
      30,
      86400
    ),
    faceScanIntervalByEmployee: parseIntervalMap(faceScanIntervalByEmployee),
    faceScanIntervalByDepartment: parseIntervalMap(faceScanIntervalByDepartment),
    faceVerifyMaxAttempts: parseIntClamped(
      faceVerifyMaxAttempts,
      d.faceVerifyMaxAttempts,
      1,
      10
    ),
    faceVerifyRetryGapSeconds: parseIntClamped(
      faceVerifyRetryGapSeconds,
      d.faceVerifyRetryGapSeconds,
      5,
      120
    ),
    agentExitPassword: sanitizeExitPassword(agentExitPassword, d.agentExitPassword),
    enabledEmployeeIds: parseIdList(enabledEmployeeIds),
    screenshotCaptureEnabled: parseBool(
      screenshotCaptureEnabled,
      d.screenshotCaptureEnabled
    ),
    screenshotIntervalSeconds: parseIntClamped(
      screenshotIntervalSeconds,
      d.screenshotIntervalSeconds,
      120,
      3600
    ),
    screenshotJpegQuality: parseIntClamped(
      screenshotJpegQuality,
      d.screenshotJpegQuality,
      10,
      95
    ),
    screenshotScalePercent: parseIntClamped(
      screenshotScalePercent,
      d.screenshotScalePercent,
      25,
      100
    ),
    agentHrmBaseUrl: sanitizeHrmBaseUrl(agentHrmBaseUrl, d.agentHrmBaseUrl),
  };
}

function sanitizeExitPassword(raw: string | null, fallback: string): string {
  const v = (raw ?? "").trim();
  if (v.length < 4) return fallback;
  if (v.length > 64) return v.slice(0, 64);
  return v;
}

function sanitizeHrmBaseUrl(raw: string | null, fallback: string): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return fallback;
  if (!/^https?:\/\//i.test(v)) return fallback;
  if (v.length > 200) return v.slice(0, 200);
  return v;
}

export async function savePresenceSettings(
  input: Partial<PresenceSettings>
): Promise<PresenceSettings> {
  const current = await getPresenceSettings();
  const ids = normalizeIdList(input.enabledEmployeeIds);
  const empIntervals = normalizeIntervalMap(input.faceScanIntervalByEmployee);
  const deptIntervals = normalizeIntervalMap(input.faceScanIntervalByDepartment);
  const next: PresenceSettings = {
    agentsRetired:
      typeof input.agentsRetired === "boolean"
        ? input.agentsRetired
        : current.agentsRetired,
    presenceEnabled:
      typeof input.presenceEnabled === "boolean"
        ? input.presenceEnabled
        : current.presenceEnabled,
    idleWarningSeconds: parseIntClamped(
      String(input.idleWarningSeconds ?? current.idleWarningSeconds),
      current.idleWarningSeconds,
      10,
      86400
    ),
    popupCountdownSeconds: parseIntClamped(
      String(input.popupCountdownSeconds ?? current.popupCountdownSeconds),
      current.popupCountdownSeconds,
      10,
      600
    ),
    cameraVerificationEnabled:
      typeof input.cameraVerificationEnabled === "boolean"
        ? input.cameraVerificationEnabled
        : current.cameraVerificationEnabled,
    recheckWhileIdleSeconds: parseIntClamped(
      String(input.recheckWhileIdleSeconds ?? current.recheckWhileIdleSeconds),
      current.recheckWhileIdleSeconds,
      30,
      7200
    ),
    faceScanIntervalSeconds: parseIntClamped(
      String(input.faceScanIntervalSeconds ?? current.faceScanIntervalSeconds),
      current.faceScanIntervalSeconds,
      30,
      86400
    ),
    faceScanIntervalByEmployee:
      empIntervals !== undefined ? empIntervals : current.faceScanIntervalByEmployee,
    faceScanIntervalByDepartment:
      deptIntervals !== undefined
        ? deptIntervals
        : current.faceScanIntervalByDepartment,
    faceVerifyMaxAttempts: parseIntClamped(
      String(input.faceVerifyMaxAttempts ?? current.faceVerifyMaxAttempts),
      current.faceVerifyMaxAttempts,
      1,
      10
    ),
    faceVerifyRetryGapSeconds: parseIntClamped(
      String(input.faceVerifyRetryGapSeconds ?? current.faceVerifyRetryGapSeconds),
      current.faceVerifyRetryGapSeconds,
      5,
      120
    ),
    agentExitPassword: sanitizeExitPassword(
      typeof input.agentExitPassword === "string"
        ? input.agentExitPassword
        : current.agentExitPassword,
      current.agentExitPassword
    ),
    enabledEmployeeIds: ids !== undefined ? ids : current.enabledEmployeeIds,
    screenshotCaptureEnabled:
      typeof input.screenshotCaptureEnabled === "boolean"
        ? input.screenshotCaptureEnabled
        : current.screenshotCaptureEnabled,
    screenshotIntervalSeconds: parseIntClamped(
      String(input.screenshotIntervalSeconds ?? current.screenshotIntervalSeconds),
      current.screenshotIntervalSeconds,
      120,
      3600
    ),
    screenshotJpegQuality: parseIntClamped(
      String(input.screenshotJpegQuality ?? current.screenshotJpegQuality),
      current.screenshotJpegQuality,
      10,
      95
    ),
    screenshotScalePercent: parseIntClamped(
      String(input.screenshotScalePercent ?? current.screenshotScalePercent),
      current.screenshotScalePercent,
      25,
      100
    ),
    agentHrmBaseUrl: sanitizeHrmBaseUrl(
      typeof input.agentHrmBaseUrl === "string"
        ? input.agentHrmBaseUrl
        : current.agentHrmBaseUrl,
      current.agentHrmBaseUrl
    ),
  };

  await Promise.all([
    setRaw(KEYS.agentsRetired, next.agentsRetired ? "true" : "false"),
    setRaw(KEYS.presenceEnabled, next.presenceEnabled ? "true" : "false"),
    setRaw(KEYS.idleWarningSeconds, String(next.idleWarningSeconds)),
    setRaw(KEYS.popupCountdownSeconds, String(next.popupCountdownSeconds)),
    setRaw(
      KEYS.cameraVerificationEnabled,
      next.cameraVerificationEnabled ? "true" : "false"
    ),
    setRaw(KEYS.recheckWhileIdleSeconds, String(next.recheckWhileIdleSeconds)),
    setRaw(KEYS.faceScanIntervalSeconds, String(next.faceScanIntervalSeconds)),
    setRaw(
      KEYS.faceScanIntervalByEmployee,
      JSON.stringify(next.faceScanIntervalByEmployee)
    ),
    setRaw(
      KEYS.faceScanIntervalByDepartment,
      JSON.stringify(next.faceScanIntervalByDepartment)
    ),
    setRaw(KEYS.faceVerifyMaxAttempts, String(next.faceVerifyMaxAttempts)),
    setRaw(KEYS.faceVerifyRetryGapSeconds, String(next.faceVerifyRetryGapSeconds)),
    setRaw(KEYS.agentExitPassword, next.agentExitPassword),
    setRaw(KEYS.enabledEmployeeIds, JSON.stringify(next.enabledEmployeeIds)),
    setRaw(
      KEYS.screenshotCaptureEnabled,
      next.screenshotCaptureEnabled ? "true" : "false"
    ),
    setRaw(KEYS.screenshotIntervalSeconds, String(next.screenshotIntervalSeconds)),
    setRaw(KEYS.screenshotJpegQuality, String(next.screenshotJpegQuality)),
    setRaw(KEYS.screenshotScalePercent, String(next.screenshotScalePercent)),
    setRaw(KEYS.agentHrmBaseUrl, next.agentHrmBaseUrl),
  ]);

  return next;
}
