/**
 * Utility script to manage open/unclosed breaks in the database
 * Usage: node close-open-breaks.js [command] [options]
 * 
 * Commands:
 *   list              - List all open breaks
 *   close [id]        - Close specific break by ID
 *   close-today       - Close all open breaks from today
 *   close-old         - Close all open breaks from previous days
 */

const mysql = require('mysql2/promise');

async function listOpenBreaks() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    const [openBreaks] = await conn.execute(
      `SELECT id, employee_id, employee_name, date, break_start, break_end, prayer_break_start, prayer_break_end
       FROM breaks 
       WHERE (break_end IS NULL AND break_start IS NOT NULL) 
          OR (prayer_break_end IS NULL AND prayer_break_start IS NOT NULL)
       ORDER BY date DESC, break_start DESC`
    );

    console.log(`\n📋 Found ${openBreaks.length} open breaks:\n`);

    if (openBreaks.length === 0) {
      console.log('No open breaks found');
      await conn.end();
      return;
    }

    openBreaks.forEach((record, index) => {
      const breakType = record.break_start && !record.break_end ? 'Break' : 'Prayer Break';
      const startTime = breakType === 'Break' ? record.break_start : record.prayer_break_start;
      console.log(
        `${index + 1}. ID: ${record.id} | Employee: ${record.employee_name} (${record.employee_id}) | Date: ${record.date} | Type: ${breakType} | Start: ${startTime}`
      );
    });

    await conn.end();
  } catch (err) {
    console.error('Error listing breaks:', err.message);
  }
}

async function closeBreakById(id) {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    const [records] = await conn.execute(
      `SELECT id, break_start, break_end, prayer_break_start, prayer_break_end 
       FROM breaks WHERE id = ?`,
      [id]
    );

    const record = records[0];
    if (!record) {
      console.log(`Break ID ${id} not found`);
      await conn.end();
      return;
    }

    let updateSql = '';
    let params = [];

    if (record.break_start && !record.break_end) {
      updateSql = `UPDATE breaks SET break_end = NOW() WHERE id = ?`;
      params = [id];
      console.log(`Closing Break ID ${id}...`);
    } else if (record.prayer_break_start && !record.prayer_break_end) {
      updateSql = `UPDATE breaks SET prayer_break_end = NOW() WHERE id = ?`;
      params = [id];
      console.log(`Closing Prayer Break ID ${id}...`);
    } else {
      console.log(`Break ID ${id} is not open`);
      await conn.end();
      return;
    }

    await conn.execute(updateSql, params);
    console.log(`Successfully closed break ID ${id}`);
    await conn.end();
  } catch (err) {
    console.error('Error closing break:', err.message);
  }
}

async function closeAllOpenTodayBreaks() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    const [openBreaks] = await conn.execute(
      `SELECT id, break_start, break_end, prayer_break_start, prayer_break_end
       FROM breaks 
       WHERE DATE(break_start) = CURDATE()
         AND ((break_end IS NULL AND break_start IS NOT NULL) 
           OR (prayer_break_end IS NULL AND prayer_break_start IS NOT NULL))`
    );

    console.log(`\nFound ${openBreaks.length} open breaks from today\n`);

    if (openBreaks.length === 0) {
      console.log('No open breaks from today');
      await conn.end();
      return;
    }

    let closed = 0;

    for (const record of openBreaks) {
      try {
        if (record.break_start && !record.break_end) {
          await conn.execute(
            `UPDATE breaks SET break_end = NOW() WHERE id = ?`,
            [record.id]
          );
          closed++;
          console.log(`Closed break ID ${record.id}`);
        } else if (record.prayer_break_start && !record.prayer_break_end) {
          await conn.execute(
            `UPDATE breaks SET prayer_break_end = NOW() WHERE id = ?`,
            [record.id]
          );
          closed++;
          console.log(`Closed prayer break ID ${record.id}`);
        }
      } catch (err) {
        console.log(`Failed to close break ID ${record.id}: ${err.message}`);
      }
    }

    console.log(`\nSuccessfully closed ${closed} out of ${openBreaks.length} breaks from today`);
    await conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

async function closeAllOldOpenBreaks() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    const [openBreaks] = await conn.execute(
      `SELECT id, break_start, prayer_break_start
       FROM breaks 
       WHERE DATE(break_start) < CURDATE()
         AND ((break_end IS NULL AND break_start IS NOT NULL) 
           OR (prayer_break_end IS NULL AND prayer_break_start IS NOT NULL))`
    );

    console.log(`\nFound ${openBreaks.length} open breaks from before today\n`);

    if (openBreaks.length === 0) {
      console.log('No old open breaks found');
      await conn.end();
      return;
    }

    let closed = 0;

    for (const record of openBreaks) {
      try {
        if (record.break_start) {
          await conn.execute(
            `UPDATE breaks SET break_end = DATE_ADD(break_start, INTERVAL 1 HOUR) WHERE id = ?`,
            [record.id]
          );
          closed++;
          console.log(`Closed old break ID ${record.id}`);
        }
        if (record.prayer_break_start) {
          await conn.execute(
            `UPDATE breaks SET prayer_break_end = DATE_ADD(prayer_break_start, INTERVAL 30 MINUTE) WHERE id = ?`,
            [record.id]
          );
          closed++;
          console.log(`Closed old prayer break ID ${record.id}`);
        }
      } catch (err) {
        console.log(`Failed to close break ID ${record.id}: ${err.message}`);
      }
    }

    console.log(`\nSuccessfully closed ${closed} old breaks`);
    await conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// Main execution
const args = process.argv.slice(2);
const command = args[0] || 'list';

console.log('\nBreak Management Utility\n');

switch (command) {
  case 'list':
    listOpenBreaks();
    break;
  case 'close':
    if (!args[1]) {
      console.error('Please provide break ID: node close-open-breaks.js close [id]');
      process.exit(1);
    }
    closeBreakById(Number(args[1]));
    break;
  case 'close-today':
    closeAllOpenTodayBreaks();
    break;
  case 'close-old':
    closeAllOldOpenBreaks();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log('\nAvailable commands:');
    console.log('  list              - List all open breaks');
    console.log('  close [id]        - Close specific break by ID');
    console.log('  close-today       - Close all open breaks from today');
    console.log('  close-old         - Close all open breaks from previous days');
    process.exit(1);
}
