const mysql = require('mysql2/promise');

async function killSleepingConnections() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    // Get all sleeping connections
    const [processes] = await conn.execute(
      "SELECT ID, USER, HOST, DB, COMMAND, TIME FROM INFORMATION_SCHEMA.PROCESSLIST WHERE COMMAND = 'Sleep' AND USER = 'root' AND DB = 'interact_hrm'"
    );

    console.log(`Found ${processes.length} sleeping connections for interact_hrm database`);

    if (processes.length === 0) {
      console.log('No sleeping connections to kill');
      await conn.end();
      return;
    }

    // Kill each sleeping connection
    let killed = 0;
    for (const proc of processes) {
      try {
        await conn.execute(`KILL ${proc.ID}`);
        killed++;
        console.log(`Killed connection ${proc.ID} (sleeping for ${proc.TIME}s)`);
      } catch (err) {
        // Connection might already be gone
        console.log(`Could not kill ${proc.ID}: ${err.message}`);
      }
    }

    console.log(`\n✅ Killed ${killed} sleeping connections`);
    await conn.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

killSleepingConnections();
