#!/usr/bin/env node

/**
 * Employment Status Auto-Update Helper Script
 * 
 * This script can be run periodically using a cron job or task scheduler
 * to automatically promote employees from Probation to Permanent status
 * after 3 months from their joining date.
 * 
 * Usage:
 *   node scripts/auto-update-employment-status.js
 * 
 * To set up automatic daily execution:
 * 
 * Linux/Mac (crontab):
 *   0 0 * * * cd /path/to/project && node scripts/auto-update-employment-status.js
 * 
 * Windows (Task Scheduler):
 *   Create a scheduled task that runs: node C:\path\to\project\scripts\auto-update-employment-status.js
 *   Schedule it to run daily at a specific time (e.g., midnight)
 */

const http = require('http');
const https = require('https');

const apiUrl = process.env.API_URL || 'http://localhost:3000';
const endpoint = '/api/auto-update-employment-status';

console.log('[Employment Status Auto-Update]');
console.log(`Triggering auto-update at ${new Date().toISOString()}`);
console.log(`API URL: ${apiUrl}${endpoint}`);

const url = new URL(apiUrl + endpoint);
const protocol = url.protocol === 'https:' ? https : http;

const options = {
	hostname: url.hostname,
	port: url.port || (url.protocol === 'https:' ? 443 : 80),
	path: url.pathname + url.search,
	method: 'GET',
	headers: {
		'Content-Type': 'application/json',
		'User-Agent': 'Employment-Status-Auto-Update/1.0'
	},
	timeout: 30000
};

const req = protocol.request(options, (res) => {
	let data = '';

	res.on('data', (chunk) => {
		data += chunk;
	});

	res.on('end', () => {
		try {
			const response = JSON.parse(data);

			if (response.success) {
				console.log('✓ Update successful');
				console.log(`  Total probation employees: ${response.total_probation_employees}`);
				console.log(`  Employees promoted: ${response.updated_count}`);

				if (response.updated_employees && response.updated_employees.length > 0) {
					console.log('\n  Details:');
					response.updated_employees.forEach((emp) => {
						console.log(`    - ${emp.employee_id} (joined: ${emp.joined_date}, ${emp.days_since_joining} days)`);
					});
				}

				process.exit(0);
			} else {
				console.error('✗ Update failed:', response.error);
				process.exit(1);
			}
		} catch (err) {
			console.error('✗ Failed to parse response:', err.message);
			process.exit(1);
		}
	});
});

req.on('error', (err) => {
	console.error('✗ Request failed:', err.message);
	process.exit(1);
});

req.on('timeout', () => {
	req.abort();
	console.error('✗ Request timeout');
	process.exit(1);
});

req.end();
