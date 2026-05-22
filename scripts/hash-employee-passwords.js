import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "interact_hrm"
};

async function hashAllPlainPasswords() {
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute('SELECT id, password FROM employees');
  for (const row of rows) {
    const pwd = row.password;
    if (typeof pwd === 'string' && pwd.length > 0 && !pwd.startsWith('$2')) {
      const hash = await bcrypt.hash(pwd, 10);
      await conn.execute('UPDATE employees SET password = ? WHERE id = ?', [hash, row.id]);
      console.log(`Updated id ${row.id}: ${pwd} -> ${hash}`);
    }
  }
  await conn.end();
  console.log('Done hashing all plain text passwords.');
}

hashAllPlainPasswords();
