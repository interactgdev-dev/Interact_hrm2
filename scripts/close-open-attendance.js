const mysql = require('mysql2/promise');

async function closeOpenAttendance() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    // Find all open attendance records that are older than today (clock_in exists but clock_out is NULL)
    const [openRecords] = await conn.execute(
      "SELECT id, employee_id, employee_name, date, clock_in FROM employee_attendance WHERE clock_out IS NULL AND DATE(date) < CURDATE() ORDER BY clock_in DESC"
    );

    console.log(`Found ${openRecords.length} open attendance records:\n`);

    if (openRecords.length === 0) {
      console.log('No open records to close');
      await conn.end();
      return;
    }

    // Display open records
    openRecords.forEach((record, index) => {
      console.log(`${index + 1}. ID: ${record.id}, Employee: ${record.employee_name} (${record.employee_id}), Date: ${record.date}, Clock In: ${record.clock_in}`);
    });

    console.log('\n⚠️  Closing all OLD open records (before today) by setting clock_out = clock_in + 8 hours...\n');

    // Close each open record by setting clock_out to clock_in + 8 hours
    let closed = 0;
    for (const record of openRecords) {
      try {
        // Set clock_out to clock_in + 8 hours and calculate total_hours
        await conn.execute(
          `UPDATE employee_attendance 
           SET clock_out = DATE_ADD(clock_in, INTERVAL 8 HOUR),
               total_hours = 8.00
           WHERE id = ?`,
          [record.id]
        );
        closed++;
        console.log(`✅ Closed record ${record.id} for ${record.employee_name} on ${record.date}`);
      } catch (err) {
        console.log(`❌ Failed to close record ${record.id}: ${err.message}`);
      }
    }

    console.log(`\n✅ Successfully closed ${closed} out of ${openRecords.length} records`);
    await conn.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

closeOpenAttendance();
