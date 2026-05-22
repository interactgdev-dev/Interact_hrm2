import { pool } from './db';

/**
 * Checks if an employee has any active breaks or prayer breaks
 * Returns object with:
 * - hasActiveBreak: boolean indicating if any break is active
 * - breakType: 'break' | 'prayer_break' | null
 * - message: user-friendly error message if break is active
 */
export async function checkActiveBreaks(employeeId: string) {
  let conn;
  try {
    conn = await pool.getConnection();
    if (!conn) {
      throw new Error("Failed to get database connection");
    }

    // Check for breaks table
    const [breakRecords] = await conn.execute(
      `SELECT id, break_start, break_end, prayer_break_start, prayer_break_end 
       FROM breaks 
       WHERE employee_id = ? AND date = CURDATE() LIMIT 1`,
      [employeeId]
    );
    
    const breakRecord = (breakRecords as any[])[0];
    if (!breakRecord) {
      return { 
        hasActiveBreak: false, 
        breakType: null,
        message: null
      };
    }

    // Check if regular break is active (started but not ended)
    if (breakRecord.break_start && !breakRecord.break_end) {
      return { 
        hasActiveBreak: true, 
        breakType: 'break',
        message: "Cannot clock out. Break is still active. Please end your break first."
      };
    }

    // Check if prayer break is active (started but not ended)
    if (breakRecord.prayer_break_start && !breakRecord.prayer_break_end) {
      return { 
        hasActiveBreak: true, 
        breakType: 'prayer_break',
        message: "Cannot clock out. Prayer Break is still active. Please end your prayer break first."
      };
    }

    return { 
      hasActiveBreak: false, 
      breakType: null,
      message: null
    };
  } catch (error) {
    console.error('Error checking active breaks:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Synchronously check for active breaks (for use within existing database connections)
 * Use this when you already have a connection
 */
export async function checkActiveBreaksWithConnection(conn: any, employeeId: string) {
  try {
    const [breakRecords] = await conn.execute(
      `SELECT id, break_start, break_end, prayer_break_start, prayer_break_end 
       FROM breaks 
       WHERE employee_id = ? AND date = CURDATE() LIMIT 1`,
      [employeeId]
    );
    
    const breakRecord = (breakRecords as any[])[0];
    if (!breakRecord) {
      return { 
        hasActiveBreak: false, 
        breakType: null,
        message: null
      };
    }

    // Check if regular break is active (started but not ended)
    if (breakRecord.break_start && !breakRecord.break_end) {
      return { 
        hasActiveBreak: true, 
        breakType: 'break',
        message: "Cannot clock out. Break is still active. Please end your break first."
      };
    }

    // Check if prayer break is active (started but not ended)
    if (breakRecord.prayer_break_start && !breakRecord.prayer_break_end) {
      return { 
        hasActiveBreak: true, 
        breakType: 'prayer_break',
        message: "Cannot clock out. Prayer Break is still active. Please end your prayer break first."
      };
    }

    return { 
      hasActiveBreak: false, 
      breakType: null,
      message: null
    };
  } catch (error) {
    console.error('Error checking active breaks:', error);
    throw error;
  }
}
