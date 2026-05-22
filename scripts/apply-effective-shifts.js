// Script to apply pending shifts from shift_effective_dates to shift_assignments on the effective date
const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'root', // update as needed
  password: '', // update as needed
  database: 'interact_hrm', // update as needed
};

async function applyEffectiveShifts() {
  const today = new Date().toISOString().split('T')[0];
  const conn = await mysql.createConnection(dbConfig);

  // Fetch pending shifts for today
  const [pending] = await conn.execute(
    `SELECT * FROM shift_effective_dates WHERE effective_date = ?`,
    [today]
  );

  for (const shift of pending) {
    // Insert into shift_assignments
    await conn.execute(
      `INSERT INTO shift_assignments (employee_id, shift_name, start_time, end_time, allow_overtime) VALUES (?, ?, ?, ?, ?)`,
      [shift.employee_id, shift.shift_name, shift.start_time, shift.end_time, shift.allow_overtime]
    );
    // Optionally delete or mark as processed
    await conn.execute(
      `DELETE FROM shift_effective_dates WHERE id = ?`,
      [shift.id]
    );
  }

  await conn.end();
  console.log(`Applied ${pending.length} effective shifts for ${today}`);
}

// Auto-run daily at midnight using node-cron
const cron = require('node-cron');

cron.schedule('0 0 * * *', () => {
  applyEffectiveShifts().catch(console.error);
});

// Also run immediately if script is started manually
applyEffectiveShifts().catch(console.error);
