import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../../lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  if (!fromDate || !toDate) {
    return NextResponse.json({ success: false, error: 'fromDate and toDate required' }, { status: 400 });
  }

  try {
    // Fetch all attendance records for the date range
    const [rows]: any = await pool.query(`
      SELECT ea.*, 
        CONCAT(e.first_name, ' ', e.last_name) as employee_name,
        e.pseudonym AS pseudonym,
        d.name AS department_name,
        sa.start_time AS shift_start_time,
        sa.end_time AS shift_end_time,
        sa.assigned_date AS shift_assigned_date
      FROM employee_attendance ea
      LEFT JOIN hrm_employees e ON ea.employee_id = e.id
      LEFT JOIN employee_jobs j ON e.id = j.employee_id
      LEFT JOIN departments d ON j.department_id = d.id
      LEFT JOIN shift_assignments sa
        ON sa.employee_id = ea.employee_id
       AND sa.assigned_date = (
         SELECT MAX(sa2.assigned_date)
         FROM shift_assignments sa2
         WHERE sa2.employee_id = ea.employee_id
           AND sa2.assigned_date <= ea.date
       )
      WHERE DATE(ea.date) BETWEEN ? AND ?
    `, [fromDate, toDate]);

    // Build a map of employee_id -> most recent valid shift timings
    const empShiftMap: Record<string, {start: string, end: string, seconds: number}> = {};
    rows.forEach((record: any) => {
      if (record.shift_start_time && record.shift_end_time) {
        const [startH, startM] = record.shift_start_time.split(":").map(Number);
        const [endH, endM] = record.shift_end_time.split(":").map(Number);
        let shiftSeconds = (endH * 3600 + endM * 60) - (startH * 3600 + startM * 60);
        if (shiftSeconds < 0) shiftSeconds += 24 * 3600;
        if (
          record.employee_id &&
          shiftSeconds > 0
        ) {
          empShiftMap[record.employee_id] = {
            start: record.shift_start_time,
            end: record.shift_end_time,
            seconds: shiftSeconds
          };
        }
      }
    });

    // Group records by employee_id
    const byEmployee: Record<string, any[]> = {};
    rows.forEach((rec: any) => {
      if (!byEmployee[rec.employee_id]) byEmployee[rec.employee_id] = [];
      byEmployee[rec.employee_id].push(rec);
    });

    // For each employee, group records by date and sum overtime (with shift fallback)
    const result = Object.entries(byEmployee).map(([employee_id, records]) => {
      // Group by date
      const byDate: Record<string, any[]> = {};
      records.forEach((rec: any) => {
        const dateKey = rec.date ? rec.date.toISOString().slice(0, 10) : null;
        if (!dateKey) return;
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(rec);
      });

      // Calculate T.W Days like monthly attendance page
      let tw_days = 0;
      const fromDateObj = new Date(fromDate);
      const toDateObj = new Date(toDate);
      for (let d = new Date(fromDateObj); d <= toDateObj; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().slice(0, 10);
        const weekday = d.getDay();
        // Exclude weekends (0=Sun, 6=Sat)
        if (weekday === 0 || weekday === 6) continue;
        // Exclude off days (if status is 'off' for all records)
        const dayRecords = byDate[dateKey] || [];
        const allOff = dayRecords.length > 0 && dayRecords.every(rec => rec.status && rec.status.toLowerCase() === 'off');
        if (allOff) continue;
        // Exclude approved leaves (if leave_type is 'approved' for all records)
        const allLeave = dayRecords.length > 0 && dayRecords.every(rec => rec.leave_type && rec.leave_type.toLowerCase() === 'approved');
        if (allLeave) continue;
        tw_days++;
      }

      // ...existing code...
      let extra_hours = "-";
      let unpaidDays = 0;
      let totalDeduction = 0;
      let totalSeconds = 0;
      let basic_salary = records[0]?.basic_salary || 0;
      // ...existing code...
      return {
        employee_id,
        extra_hours,
        tw_days,
        tunpaid_days: unpaidDays,
        total_deduction: totalDeduction
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
