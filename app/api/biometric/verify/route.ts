import { NextRequest, NextResponse } from "next/server";
import { issueBiometricGrantForEmployee } from "@/lib/biometric-session";
import {
  type BiometricAction,
  verifyDescriptorForEmployee,
} from "@/lib/face-verify";
import { isValidDescriptor } from "@/lib/face-matching";
import { resolveEmployeeDbId } from "@/lib/resolve-employee-id";

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

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let employeeId = "";
    let employeeName: string | null = null;
    let action = "" as BiometricAction;
    let descriptor: number[] | null = null;

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        employee_id?: string;
        employee_name?: string;
        action?: string;
        descriptor?: number[];
      };
      employeeId = String(body.employee_id || "").trim();
      employeeName = String(body.employee_name || "").trim() || null;
      action = String(body.action || "").trim() as BiometricAction;
      descriptor = isValidDescriptor(body.descriptor) ? body.descriptor : null;
    } else {
      const form = await req.formData();
      employeeId = String(form.get("employee_id") || "").trim();
      employeeName = String(form.get("employee_name") || "").trim() || null;
      action = String(form.get("action") || "").trim() as BiometricAction;
      const raw = form.get("descriptor");
      if (raw) {
        try {
          const parsed = JSON.parse(String(raw)) as number[];
          if (isValidDescriptor(parsed)) descriptor = parsed;
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
    if (!descriptor) {
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
    const result = await verifyDescriptorForEmployee(descriptor, resolvedId, employeeName);

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
