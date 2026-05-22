import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

// GET - Fetch all master shifts
export async function GET() {
  try {
    const [rows]: any = await pool.execute(
      'SELECT * FROM master_shifts ORDER BY id DESC'
    );
    return NextResponse.json({ success: true, shifts: rows });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// POST - Create new shift
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { shift_name, clock_in_time, clock_out_time, total_hours, overtime, work_days } = body;

    if (!shift_name || !clock_in_time || !clock_out_time) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    await pool.execute(
      `INSERT INTO master_shifts (name, shift_in, shift_out, overtime_daily, working_days)
       VALUES (?, ?, ?, ?, ?)`,
      [shift_name, clock_in_time, clock_out_time, overtime ? 1 : 0, work_days || 'Mon-Fri']
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// PUT - Update existing shift
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, shift_name, clock_in_time, clock_out_time, total_hours, overtime, work_days } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    await pool.execute(
      `UPDATE master_shifts 
       SET name = ?, shift_in = ?, shift_out = ?, overtime_daily = ?, working_days = ?
       WHERE id = ?`,
      [shift_name, clock_in_time, clock_out_time, overtime ? 1 : 0, work_days || 'Mon-Fri', id]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// DELETE - Delete shift
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    await pool.execute('DELETE FROM master_shifts WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
