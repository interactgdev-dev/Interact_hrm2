import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// GET: Fetch all company policies
export async function GET() {
  const [rows] = (await query("SELECT * FROM company_policies ORDER BY id ASC")) as any;
  return NextResponse.json({ success: true, policies: rows });
}

// POST: Add new company policy
export async function POST(req: Request) {
  const { heading, description } = await req.json();
  await query(
    "INSERT INTO company_policies (heading, description, display_order, status) VALUES (?, ?, 1, 'active')",
    [heading, description]
  );
  return NextResponse.json({ success: true });
}

// PUT: Update company policy
export async function PUT(req: Request) {
  const { id, heading, description } = await req.json();
  await query(
    "UPDATE company_policies SET heading = ?, description = ? WHERE id = ?",
    [heading, description, id]
  );
  return NextResponse.json({ success: true });
}

// DELETE: Delete company policy
export async function DELETE(req: Request) {
  const { id } = await req.json();
  await query("DELETE FROM company_policies WHERE id = ?", [id]);
  return NextResponse.json({ success: true });
}
