import mysql from "mysql2/promise";

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "interact_hrm"
};

async function copyPlainPasswords() {
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute('SELECT id, password FROM employees');
  for (const row of rows) {
    const pwd = row.password;
    // If password is a bcrypt hash, skip
    if (typeof pwd === 'string' && pwd.startsWith('$2')) continue;
    // If already set, skip
    if (row.password_plain) continue;
    // Set plain password
    await conn.execute('UPDATE employees SET password_plain = ? WHERE id = ?', [pwd, row.id]);
    console.log(`Set plain password for id ${row.id}: ${pwd}`);
  }
  await conn.end();
  console.log('Done copying plain text passwords.');
}

copyPlainPasswords();
