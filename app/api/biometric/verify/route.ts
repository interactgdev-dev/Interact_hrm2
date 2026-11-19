import { NextRequest, NextResponse } from "next/server";
import { issueBiometricGrantForEmployee } from "@/lib/biometric-session";
import {
  type BiometricAction,
  verifyDescriptorsForEmployee,
} from "@/lib/face-verify";
import { isValidDescriptor } from "@/lib/face-matching";
import { resolveEmployeeDbId } from "@/lib/resolve-employee-id";
import { logServerEmployeeActivity } from "@/lib/admin-activity-log";

export const runtime = "nodejs";

const ACTIONS: BiometricAction[] = [
  "clock_in",
  "clock_out",
  "break_start",
  "break_end",
  "prayer_start",
  "prayer_end",
  "refreshment_start",
  "refreshment_end",
  "meeting_start",
  "meeting_end",
];

function collectProbes(body: {
  descriptor?: number[];
  descriptors?: number[][];
}): number[][] {
  const out: number[][] = [];
  if (Array.isArray(body.descriptors)) {
    for (const d of body.descriptors) {
      if (isValidDescriptor(d)) out.push(d);
    }
  }
  if (isValidDescriptor(body.descriptor)) out.push(body.descriptor);
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let employeeId = "";
    let employeeName: string | null = null;
    let action = "" as BiometricAction;
    let probes: number[][] = [];

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        employee_id?: string;
        employee_name?: string;
        action?: string;
        descriptor?: number[];
        descriptors?: number[][];
      };
      employeeId = String(body.employee_id || "").trim();
      employeeName = String(body.employee_name || "").trim() || null;
      action = String(body.action || "").trim() as BiometricAction;
      probes = collectProbes(body);
    } else {
      const form = await req.formData();
      employeeId = String(form.get("employee_id") || "").trim();
      employeeName = String(form.get("employee_name") || "").trim() || null;
      action = String(form.get("action") || "").trim() as BiometricAction;
      const rawList = form.get("descriptors");
      if (rawList) {
        try {
          const parsed = JSON.parse(String(rawList)) as number[][];
          if (Array.isArray(parsed)) {
            probes = parsed.filter(isValidDescriptor);
          }
        } catch {
          // ignore
        }
      }
      const raw = form.get("descriptor");
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw)) as number[];
          if (isValidDescriptor(parsed)) probes.push(parsed);
        } catch {
          // ignore
        }
      }
    }

    if (!employeeId || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { success: false, error: "Missing employee or action." },
        { status: 400 }
      );
    }
    if (!probes.length) {
      return NextResponse.json(
        {
          success: false,
          error: "No face detected. Center your face in the camera frame.",
          code: "no_face",
        },
        { status: 400 }
      );
    }

    const resolvedId = (await resolveEmployeeDbId(employeeId)) || employeeId;
    // Try every face in the frame — enrolled employee succeeds even if a coworker is visible.
    const result = await verifyDescriptorsForEmployee(probes, resolvedId, employeeName);

    if (!result.verified) {
      return NextResponse.json({
        success: false,
        verified: false,
        error: result.reason,
        code: result.code,
        similarity: result.similarity,
      });
    }

    const token = await issueBiometricGrantForEmployee(
      employeeId,
      employeeName,
      action,
      result.subject,
      result.similarity
    );

    const actionLabel = String(action || "verify").replace(/_/g, " ");
    void logServerEmployeeActivity(req, {
      type: "face_verify",
      employeeId: resolvedId,
      employeeName: employeeName || result.subject || null,
      detail: `Face verified for ${actionLabel}`,
      page: "/employee-dashboard",
      method: "POST",
      url: "/api/biometric/verify",
    });

    return NextResponse.json({
      success: true,
      verified: true,
      biometric_token: token,
      similarity: result.similarity,
      subject: result.subject,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
