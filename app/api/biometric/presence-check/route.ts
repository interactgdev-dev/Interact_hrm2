import { NextRequest, NextResponse } from "next/server";
import { verifyDescriptorsForEmployee } from "@/lib/face-verify";
import { isValidDescriptor } from "@/lib/face-matching";
import { resolveEmployeeDbId } from "@/lib/resolve-employee-id";

export const runtime = "nodejs";

/**
 * Idle Guard + same FaceVerifyModal as Break — server match is identical to
 * /api/biometric/verify (verifyDescriptorsForEmployee), without biometric_token.
 * Multi-person frames OK: any matching face for the claimed employee succeeds.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      employee_id?: string;
      employee_name?: string;
      descriptor?: number[];
      descriptors?: number[][];
    };
    const employeeId = String(body.employee_id || "").trim();
    const employeeName = String(body.employee_name || "").trim() || null;

    const probes: number[][] = [];
    if (Array.isArray(body.descriptors)) {
      for (const d of body.descriptors) {
        if (isValidDescriptor(d)) probes.push(d);
      }
    }
    if (isValidDescriptor(body.descriptor)) probes.push(body.descriptor);

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "employee_id required", code: "error" },
        { status: 400 },
      );
    }
    if (!probes.length) {
      return NextResponse.json({
        success: true,
        verified: false,
        atSeat: false,
        code: "no_face",
        error: "No face detected in frame.",
      });
    }

    const resolvedId = (await resolveEmployeeDbId(employeeId)) || employeeId;
    const result = await verifyDescriptorsForEmployee(
      probes,
      resolvedId,
      employeeName
    );

    return NextResponse.json({
      success: true,
      verified: result.verified,
      atSeat: result.verified,
      code: result.verified ? "ok" : result.code,
      similarity: result.similarity,
      error: result.verified ? null : result.reason,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        verified: false,
        atSeat: false,
        code: "error",
        error: err instanceof Error ? err.message : "Presence check failed",
      },
      { status: 500 },
    );
  }
}
