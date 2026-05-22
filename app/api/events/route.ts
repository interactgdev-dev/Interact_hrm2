import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/** Empty string is not a valid MySQL DATETIME/TIMESTAMP under strict mode; use NULL for optional end times. */
function optionalDatetimeForDb(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

// Force Node runtime (mysql2 is not supported on the Edge runtime)
export const runtime = "nodejs";
// Always serve fresh data
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [rows] = (await query(
      "SELECT id, title, description, start_at, end_at, is_all_day, location, status, widget_heading, created_at, updated_at FROM upcoming_events WHERE status = 'published' ORDER BY start_at ASC"
    )) as any;
    // Get the widget heading from first event, or use default
    let widgetHeading = "Upcoming Events";
    const rowsArray = rows as any[];
    if (rowsArray && rowsArray.length > 0 && rowsArray[0]?.widget_heading) {
      widgetHeading = rowsArray[0].widget_heading;
    } else {
      // If no events, get heading from database anyway
      const [headingResult] = (await query("SELECT widget_heading FROM upcoming_events WHERE status = 'published' LIMIT 1")) as any;
      const headingArray = headingResult as any[];
      if (headingArray && headingArray.length > 0 && headingArray[0]?.widget_heading) {
        widgetHeading = headingArray[0].widget_heading;
      }
    }
    return NextResponse.json({ success: true, events: rows, widgetHeading });
  } catch (error) {
    console.error("/api/events GET error", error);
    return NextResponse.json({ success: false, error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      title,
      description = null,
      start_at,
      end_at = null,
      is_all_day = false,
      location = null,
      status = "published",
      widget_heading
    } = body;

    if (!title || !start_at) {
      return NextResponse.json({ success: false, error: "title and start_at are required" }, { status: 400 });
    }

    // Use widget_heading from request if provided, else get from database
    let headingToUse = widget_heading;
    if (!headingToUse) {
      const [headingResult] = (await query("SELECT widget_heading FROM upcoming_events WHERE status = 'published' LIMIT 1")) as any;
      const headingArray = headingResult as any[];
      headingToUse = headingArray && headingArray.length > 0 ? headingArray[0].widget_heading : "Upcoming Events";
    }

    const endAtDb = optionalDatetimeForDb(end_at);

    const [result]: any = await query(
      "INSERT INTO upcoming_events (title, description, start_at, end_at, is_all_day, location, status, widget_heading) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [title, description, start_at, endAtDb, is_all_day ? 1 : 0, location, status, headingToUse]
    );

    const [inserted] = (await query(
      "SELECT id, title, description, start_at, end_at, is_all_day, location, status, widget_heading, created_at, updated_at FROM upcoming_events WHERE id = ?",
      [result.insertId]
    )) as any;

    return NextResponse.json({ success: true, event: inserted[0] });
  } catch (error) {
    console.error("/api/events POST error", error);
    return NextResponse.json({ success: false, error: "Failed to create event" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    await query("DELETE FROM upcoming_events WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("/api/events DELETE error", error);
    return NextResponse.json({ success: false, error: "Failed to delete event" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { widget_heading } = body;

    if (!widget_heading) {
      return NextResponse.json({ success: false, error: "widget_heading is required" }, { status: 400 });
    }

    // Validate heading - only allow specific values
    const allowedHeadings = ["Upcoming Events", "Announcements"];
    if (!allowedHeadings.includes(widget_heading)) {
      return NextResponse.json({ success: false, error: "Invalid heading. Allowed: Upcoming Events, Announcements" }, { status: 400 });
    }

    // Update heading for all published events
    await query("UPDATE upcoming_events SET widget_heading = ? WHERE status = 'published'", [widget_heading]);
    return NextResponse.json({ success: true, widgetHeading: widget_heading });
  } catch (error) {
    console.error("/api/events PUT error", error);
    return NextResponse.json({ success: false, error: "Failed to update widget heading" }, { status: 500 });
  }
}
