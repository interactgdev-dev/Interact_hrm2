const mysql = require('mysql2/promise');

async function checkConnections() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'interact_hrm'
    });

    // Check current max_connections
    const [maxRows] = await conn.execute("SHOW VARIABLES LIKE 'max_connections'");
    console.log('\nCurrent max_connections:', maxRows);

    // Check current connections
    const [currentRows] = await conn.execute("SHOW STATUS LIKE 'Threads_connected'");
    console.log('Current connections:', currentRows);

    // Check max used connections
    const [maxUsedRows] = await conn.execute("SHOW STATUS LIKE 'Max_used_connections'");
    console.log('Max used connections:', maxUsedRows);

    // Show all current connections
    const [processRows] = await conn.execute("SHOW PROCESSLIST");
    console.log(`\nTotal active processes: ${processRows.length}`);
    console.log('\nActive connections by state:');
    const stateCount = {};
    processRows.forEach(p => {
      const state = p.State || 'null';
      stateCount[state] = (stateCount[state] || 0) + 1;
    });
    console.log(stateCount);

    await conn.end();
    console.log('\n✅ Check complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.code === 'ER_CON_COUNT_ERROR') {
      console.log('\n⚠️  TOO MANY CONNECTIONS! MySQL has reached its connection limit.');
      console.log('To fix this, you need to:');
      console.log('1. Restart MySQL service to clear hung connections');
      console.log('2. Or increase max_connections in my.ini (MySQL config file)');
    }
  }
}

checkConnections();
