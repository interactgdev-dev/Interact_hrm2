import { NextRequest, NextResponse } from "next/server";
import {
  deleteScreenshotFiles,
  deleteScreenshotsForDay,
  isGalleryUnlocked,
  listDateFoldersForEmployee,
  listScreenshotEmployees,
  listScreenshotsForEmployee,
} from "@/lib/guard-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }

    const sp = req.nextUrl.searchParams;
    const employeeId = String(sp.get("employeeId") || "").trim();
    const datesOnly = sp.get("datesOnly") === "1" || sp.get("datesOnly") === "true";

    if (!employeeId) {
      const employees = await listScreenshotEmployees();
      return NextResponse.json({ success: true, employees });
    }

    if (datesOnly) {
      const dates = await listDateFoldersForEmployee(employeeId);
      return NextResponse.json({ success: true, dates });
    }

    const date = String(sp.get("date") || "").trim();
    const timeFrom = String(sp.get("timeFrom") || "").trim();
    const timeTo = String(sp.get("timeTo") || "").trim();
    const page = parseInt(String(sp.get("page") || "1"), 10);
    const pageSize = parseInt(String(sp.get("pageSize") || "24"), 10);

    const result = await listScreenshotsForEmployee({
      employeeId,
      date: date || undefined,
      timeFrom: timeFrom || undefined,
      timeTo: timeTo || undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 24,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "List failed",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!isGalleryUnlocked(req)) {
      return NextResponse.json(
        { success: false, error: "Gallery locked", locked: true },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      path?: string;
      paths?: string[];
      employeeId?: string;
      date?: string;
    };

    const employeeId = String(body.employeeId || "").trim();
    const date = String(body.date || "").trim();
    if (employeeId && date) {
      const n = await deleteScreenshotsForDay(employeeId, date);
      return NextResponse.json({ success: true, deletedCount: n });
    }

    const paths = Array.isArray(body.paths)
      ? body.paths.map((p) => String(p || "").trim()).filter(Boolean)
      : body.path
        ? [String(body.path).trim()]
        : [];

    if (!paths.length) {
      return NextResponse.json(
        { success: false, error: "path(s) or employeeId+date required" },
        { status: 400 }
      );
    }

    const result = await deleteScreenshotFiles(paths);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Delete failed",
      },
      { status: 500 }
    );
  }
}
