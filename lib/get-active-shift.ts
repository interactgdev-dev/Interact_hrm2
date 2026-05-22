/**
 * Helper function to find the active shift assignment for an employee at a given time
 * Handles overnight shifts (e.g., 6:30 PM - 3:30 AM)
 */

import { pool } from "./db";
import { getDateStringInTimeZone, getTimeStringInTimeZone, SERVER_TIMEZONE } from "./timezone";

interface ShiftAssignment {
  id: number;
  employee_id: number;
  shift_name: string;
  start_time: string;
  end_time: string;
  assigned_date: string;
}

/**
 * Get active shift assignment for an employee at a specific datetime
 * @param employeeId - Employee ID
 * @param timestamp - ISO timestamp string (e.g., from break_start)
 * @returns shift_assignment_id or null if no match found
 */
export async function getActiveShiftAssignment(
  employeeId: number | string,
  timestamp: string
): Promise<number | null> {
  let conn;
  try {
    conn = await pool.getConnection();
    
    const eventDate = new Date(timestamp);
    const dateOnly = getDateStringInTimeZone(eventDate, SERVER_TIMEZONE); // YYYY-MM-DD
    const timeOnly = getTimeStringInTimeZone(eventDate, SERVER_TIMEZONE).substring(0, 8); // HH:MM:SS
    
    // Query to find matching shift assignment
    // Handles both normal shifts (same day) and overnight shifts (previous day)
    const query = `
      SELECT id, employee_id, shift_name, start_time, end_time, assigned_date
      FROM shift_assignments
      WHERE employee_id = ?
        AND (
          -- Case 1: Normal shift (start_time < end_time, same day)
          (
            start_time < end_time 
            AND assigned_date = ?
            AND ? BETWEEN start_time AND end_time
          )
          OR
          -- Case 2: Overnight shift (start_time > end_time)
          -- Check if time is after start on assigned_date
          (
            start_time > end_time
            AND assigned_date = ?
            AND ? >= start_time
          )
          OR
          -- Case 3: Overnight shift continuation on next day
          -- Check if time is before end on day after assigned_date
          (
            start_time > end_time
            AND assigned_date = DATE_SUB(?, INTERVAL 1 DAY)
            AND ? < end_time
          )
        )
      ORDER BY assigned_date DESC, id DESC
      LIMIT 1
    `;
    
    const [rows] = await conn.execute(query, [
      employeeId,
      dateOnly,  // Case 1: same day
      timeOnly,
      dateOnly,  // Case 2: overnight start
      timeOnly,
      dateOnly,  // Case 3: overnight end (previous day)
      timeOnly
    ]);
    
    const shifts = rows as ShiftAssignment[];
    
    if (shifts.length > 0) {
      return shifts[0].id;
    }
    
    // Fallback: Find most recent shift assignment if no exact match
    const fallbackQuery = `
      SELECT id 
      FROM shift_assignments 
      WHERE employee_id = ? 
        AND assigned_date <= ?
      ORDER BY assigned_date DESC, id DESC
      LIMIT 1
    `;
    
    const [fallbackRows] = await conn.execute(fallbackQuery, [employeeId, dateOnly]);
    const fallbackShifts = fallbackRows as { id: number }[];
    
    return fallbackShifts.length > 0 ? fallbackShifts[0].id : null;
    
  } catch (error) {
    console.error("Error getting active shift assignment:", error);
    return null;
  } finally {
    if (conn) conn.release();
  }
}
