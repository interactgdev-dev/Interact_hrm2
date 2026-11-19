import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

function isMissingIdDefaultError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err);
  return msg.includes("Field 'id' doesn't have a default value");
}

async function insertMasterShift(values: {
  shift_name: string;
  clock_in_time: string;
  clock_out_time: string;
  overtime: boolean;
  work_days: string;
}): Promise<number> {
  const params = [
    values.shift_name,
    values.clock_in_time,
    values.clock_out_time,
    values.overtime ? 1 : 0,
    values.work_days || 'Mon-Fri',
  ];

  try {
    const [result]: any = await pool.execute(
      `INSERT INTO master_shifts (name, shift_in, shift_out, overtime_daily, working_days)
       VALUES (?, ?, ?, ?, ?)`,
      params,
    );
    return Number(result.insertId) || 0;
  } catch (err) {
    if (!isMissingIdDefaultError(err)) throw err;

    const [maxRows]: any = await pool.execute(
      'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM master_shifts',
    );
    const nextId = Number(maxRows[0]?.next_id || 1);
    await pool.execute(
      `INSERT INTO master_shifts (id, name, shift_in, shift_out, overtime_daily, working_days)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nextId, ...params],
    );

    try {
      await pool.query(
        'ALTER TABLE master_shifts MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT',
      );
      await pool.query(`ALTER TABLE master_shifts AUTO_INCREMENT = ${nextId + 1}`);
    } catch {
      /* migration may fix on next deploy */
    }

    return nextId;
  }
}

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

    const id = await insertMasterShift({
      shift_name,
      clock_in_time,
      clock_out_time,
      overtime: Boolean(overtime),
      work_days: work_days || 'Mon-Fri',
    });

    return NextResponse.json({ success: true, id });
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
