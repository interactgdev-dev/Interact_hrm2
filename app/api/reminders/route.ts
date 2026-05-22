import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [rows] = (await query(
      "SELECT id, message, is_active, display_order, created_at, updated_at FROM reminders WHERE is_active = 1 ORDER BY display_order ASC"
    )) as any;
    return NextResponse.json({ success: true, reminders: rows });
  } catch (error) {
    console.error("/api/reminders GET error", error);
    return NextResponse.json({ success: false, error: "Failed to fetch reminders" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, is_active = 1, display_order = 1 } = body;

    if (!message) {
      return NextResponse.json({ success: false, error: "message is required" }, { status: 400 });
    }

    const [result]: any = await query(
      "INSERT INTO reminders (message, is_active, display_order) VALUES (?, ?, ?)",
      [message, is_active ? 1 : 0, display_order]
    );

    const [inserted] = (await query(
      "SELECT id, message, is_active, display_order, created_at, updated_at FROM reminders WHERE id = ?",
      [result.insertId]
    )) as any;

    return NextResponse.json({ success: true, reminder: inserted[0] });
  } catch (error) {
    console.error("/api/reminders POST error", error);
    return NextResponse.json({ success: false, error: "Failed to create reminder" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, message, is_active, display_order } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (message !== undefined) {
      updates.push("message = ?");
      values.push(message);
    }
    if (is_active !== undefined) {
      updates.push("is_active = ?");
      values.push(is_active ? 1 : 0);
    }
    if (display_order !== undefined) {
      updates.push("display_order = ?");
      values.push(display_order);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    values.push(id);
    await query(`UPDATE reminders SET ${updates.join(", ")} WHERE id = ?`, values);

    const [updated] = (await query(
      "SELECT id, message, is_active, display_order, created_at, updated_at FROM reminders WHERE id = ?",
      [id]
    )) as any;

    return NextResponse.json({ success: true, reminder: updated[0] });
  } catch (error) {
    console.error("/api/reminders PUT error", error);
    return NextResponse.json({ success: false, error: "Failed to update reminder" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    await query("DELETE FROM reminders WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("/api/reminders DELETE error", error);
    return NextResponse.json({ success: false, error: "Failed to delete reminder" }, { status: 500 });
  }
}
