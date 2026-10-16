import { NextRequest, NextResponse } from "next/server";
import {
  deleteMonthlyStatusOverride,
  listMonthlyStatusOverridesInRange,
  upsertMonthlyStatusOverride,
} from "@/lib/monthly-attendance-status-overrides-table";
import { isAllowedMonthlyAttendanceStatus } from "@/lib/attendance-status";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate")?.trim() || "";
    const toDate = searchParams.get("toDate")?.trim() || "";
    const employeeId = searchParams.get("employeeId")?.trim() || "";

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { success: false, error: "fromDate and toDate are required" },
        { status: 400 },
      );
    }

    const overrides = await listMonthlyStatusOverridesInRange(
      fromDate,
      toDate,
      employeeId || undefined,
    );
    return NextResponse.json({ success: true, overrides });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const employeeId = String(body.employeeId ?? body.employee_id ?? "").trim();
    const attendanceDate = String(
      body.attendanceDate ?? body.attendance_date ?? body.date ?? "",
    ).trim();
    const statusLabel = String(body.statusLabel ?? body.status_label ?? body.status ?? "").trim();
    const reason = String(body.reason ?? body.note ?? "").trim();
    const updatedBy = String(body.updatedBy ?? body.updated_by ?? "admin").trim() || "admin";

    if (!employeeId || !attendanceDate) {
      return NextResponse.json(
        { success: false, error: "employeeId and attendanceDate are required" },
        { status: 400 },
      );
    }
    if (!isAllowedMonthlyAttendanceStatus(statusLabel)) {
      return NextResponse.json(
        { success: false, error: "Invalid status" },
        { status: 400 },
      );
    }
    if (!reason) {
      return NextResponse.json(
        { success: false, error: "Reason is required when changing status manually" },
        { status: 400 },
      );
    }

    const row = await upsertMonthlyStatusOverride({
      employeeId,
      attendanceDate,
      statusLabel,
      reason,
      updatedBy,
    });
    return NextResponse.json({ success: true, override: row });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let employeeId = searchParams.get("employeeId")?.trim() || "";
    let attendanceDate = searchParams.get("attendanceDate")?.trim()
      || searchParams.get("date")?.trim()
      || "";

    if (!employeeId || !attendanceDate) {
      try {
        const body = await req.json();
        employeeId = employeeId || String(body.employeeId ?? body.employee_id ?? "").trim();
        attendanceDate =
          attendanceDate ||
          String(body.attendanceDate ?? body.attendance_date ?? body.date ?? "").trim();
      } catch {
        /* no body */
      }
    }

    if (!employeeId || !attendanceDate) {
      return NextResponse.json(
        { success: false, error: "employeeId and attendanceDate are required" },
        { status: 400 },
      );
    }

    const deleted = await deleteMonthlyStatusOverride(employeeId, attendanceDate);
    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
