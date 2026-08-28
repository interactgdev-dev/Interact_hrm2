import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { BiometricAction } from "@/lib/face-types";
import { getSimilarityMin, isFaceVerificationEnabled } from "@/lib/face-matching";
import { getEmployeeMatchKeys } from "@/lib/biometric-employee";

type TokenPayload = {
  employeeIds: string[];
  action: BiometricAction;
  subject: string;
  similarity: number;
  exp: number;
  jti: string;
};

const GRANT_TTL_MS = 120_000;

function getSigningSecret(): string {
  return (
    process.env.BIOMETRIC_TOKEN_SECRET?.trim() ||
    process.env.DB_NAME?.trim() ||
    "interact-hrm-biometric-dev"
  );
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: TokenPayload): string {
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", getSigningSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function parseSignedToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", getSigningSecret()).update(body).digest("base64url");

  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(base64urlDecode(body)) as TokenPayload;
  } catch {
    return null;
  }
}

export function isBiometricEnforcementEnabled(): boolean {
  return isFaceVerificationEnabled();
}

export async function issueBiometricGrantForEmployee(
  employeeId: string,
  employeeName: string | null | undefined,
  action: BiometricAction,
  subject: string,
  similarity: number
): Promise<string> {
  const matchKeys = await getEmployeeMatchKeys(employeeId, employeeName);
  const employeeIds = Array.from(new Set(matchKeys.dbIds.length ? matchKeys.dbIds : [employeeId]));

  const payload: TokenPayload = {
    employeeIds,
    action,
    subject,
    similarity,
    exp: Date.now() + GRANT_TTL_MS,
    jti: randomUUID(),
  };

  return signPayload(payload);
}

export async function consumeBiometricGrant(
  token: string | undefined | null,
  employeeId: string,
  employeeName: string | null | undefined,
  action: BiometricAction
): Promise<boolean> {
  if (!isBiometricEnforcementEnabled()) return true;
  if (!token) return false;

  const grant = parseSignedToken(token);
  if (!grant || Date.now() > grant.exp || grant.action !== action) return false;
  if (!Number.isFinite(grant.similarity) || grant.similarity < getSimilarityMin()) return false;

  const matchKeys = await getEmployeeMatchKeys(employeeId, employeeName);
  const requestIds = new Set(matchKeys.dbIds.length ? matchKeys.dbIds : [employeeId]);
  return grant.employeeIds.some((id) => requestIds.has(id));
}

export function biometricRequiredError(action: BiometricAction): string {
  const labels: Record<BiometricAction, string> = {
    clock_in: "clock in",
    clock_out: "clock out",
    break_start: "start break",
    break_end: "end break",
    prayer_start: "start prayer break",
    prayer_end: "end prayer break",
    refreshment_start: "start refreshment",
    refreshment_end: "end refreshment",
    meeting_start: "start meeting",
    meeting_end: "end meeting",
  };
  return `Face verification is required before you can ${labels[action]}.`;
}
