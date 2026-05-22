import mysql from 'mysql2/promise';

// Determine if running on Windows (XAMPP) or Linux (Ubuntu)
const isWindows = process.platform === 'win32';

// Create connection config
const connectionConfig: any = {
	host: process.env.DB_HOST || 'localhost',
	port: parseInt(process.env.DB_PORT || '3306'),
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || '',
	database: process.env.DB_NAME || 'interact_hrm',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
	maxIdle: 10,
	idleTimeout: 60000,
	enableKeepAlive: true,
	keepAliveInitialDelay: 0
};

// Only use socket path on Linux/Unix systems
if (!isWindows) {
	connectionConfig.socketPath = '/var/run/mysqld/mysqld.sock';
	// Remove host/port when using socket
	delete connectionConfig.host;
	delete connectionConfig.port;
}

export const pool = mysql.createPool(connectionConfig);


// Generic query function
export async function query(sql: string, params?: any[]) {
	return await pool.query(sql, params);
}
