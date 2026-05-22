import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// GET: Fetch all departments
export async function GET() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.execute("SELECT * FROM departments ORDER BY name");
    return NextResponse.json({ success: true, departments: rows });
  } catch (error) {
    console.error("Error fetching departments:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// POST: Add new department
export async function POST(req: NextRequest) {
  let conn;
  try {
    const { name } = await req.json();
    conn = await pool.getConnection();
    await conn.execute("INSERT INTO departments (name) VALUES (?)", [name]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error adding department:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// PUT: Update department
export async function PUT(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const { name } = await req.json();
    conn = await pool.getConnection();
    await conn.execute("UPDATE departments SET name = ? WHERE id = ?", [name, id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating department:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// DELETE: Remove department
export async function DELETE(req: NextRequest) {
  let conn;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    conn = await pool.getConnection();
    await conn.execute("DELETE FROM departments WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting department:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
