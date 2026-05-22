# Ubuntu Leave Balance Renewal Debugging Guide

## Current Status
✅ **Localhost**: Leave renewal working correctly
- Employee ID 5: annualBalance = 19/20 (used 1 day on 2026-04-07)
- leaveCycleStart = 2026-04-07 (correct for joining anniversary)
- Code changes: Committed and pushed to GitHub ✓

❌ **Ubuntu**: Leave balance not updating after joining anniversary date

## Root Cause Analysis

The issue on Ubuntu is likely due to ONE of these factors:

### 1. **App Not Restarted** (Most Common)
The old code is still running. Even though you pulled the latest code, Node.js still has the old version in memory.

**Fix:**
```bash
# SSH to Ubuntu server
cd /path/to/project

# Get latest code
git pull origin main

# Restart the application (use appropriate command for your setup):
pm2 restart all              # If using PM2
# OR
systemctl restart app-name   # If using systemd
# OR
docker restart container-name # If using Docker
```

Then test:
```bash
curl "http://ubuntu-server:3000/api/leave-balance?employee_id=5"
```

### 2. **Database Connection Error**

The hardcoded DB credentials issue was fixed in commit `1ab2468`, but Ubuntu might still be using old env vars.

**Check:**
```bash
# SSH to Ubuntu
echo $DB_HOST
echo $DB_USER
echo $DB_PASSWORD
echo $DB_NAME

# Expected output:
# DB_HOST=localhost
# DB_USER=root (or your MySQL user)
# DB_PASSWORD=your_password
# DB_NAME=hrm2
```

If not set, add to `.env` or systemd/PM2 config:
```bash
export DB_HOST=localhost
export DB_USER=root
export DB_PASSWORD=your_password
export DB_NAME=hrm2
```

Then restart app.

### 3. **Employee joined_date Not Set in Database**

The leave cycle depends on `employee_jobs.joined_date`. If this is NULL or incorrect, cycle calculation fails.

**Debug on Ubuntu:**
```bash
# SSH to Ubuntu
mysql -u root -p hrm2

SELECT id, joined_date, employment_status FROM employee_jobs WHERE employee_id = 5\\G
```

**Expected Output:**
```
joined_date: 2025-04-06   # (or whatever last year's date is)
employment_status: Permanent
```

**If joined_date is NULL:**
```sql
UPDATE employee_jobs 
SET joined_date = '2025-04-06'  -- Set to one year ago from today's anniversary
WHERE employee_id = 5;
```

### 4. **Missing `upcoming_events` Table**

This was identified earlier. Some routes query this table and fail.

**Create the table:**
```sql
CREATE TABLE IF NOT EXISTS upcoming_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NULL,
  is_all_day TINYINT(1) NOT NULL DEFAULT 0,
  location VARCHAR(255) NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'published',
  widget_heading VARCHAR(100) NOT NULL DEFAULT 'Upcoming Events',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 5. **MySQL Timezone Mismatch**

If Ubuntu MySQL is running in a different timezone than the server, date comparisons might be off.

**Check:**
```bash
# SSH to Ubuntu
mysql -u root -p -e "SELECT NOW(), CURDATE(), @@session.time_zone, @@global.time_zone;"
```

**Expected Output:**
```
NOW() should be close to current UTC time
@@session.time_zone: should be +00:00 or @@global.system (system timezone)
```

If very different from actual time, update MySQL config:
```bash
sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
# Add under [mysqld]:
default-time-zone = '+00:00'

# Restart MySQL
sudo systemctl restart mysql
```

## Step-by-Step Verification on Ubuntu

1. **SSH to Ubuntu:**
   ```bash
   ssh user@ubuntu-server
   cd /path/to/project
   ```

2. **Check environment variables:**
   ```bash
   env | grep DB_
   ```

3. **Verify DB connectivity:**
   ```bash
   mysql -u $DB_USER -p$DB_PASSWORD -e "SELECT 'Connected' as status, @@session.time_zone;"
   ```

4. **Check employee joined_date:**
   ```bash
   mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "SELECT employee_id, joined_date FROM employee_jobs LIMIT 5;"
   ```

5. **Pull latest code:**
   ```bash
   git pull origin main
   git log -1 --oneline  # Should show commit 1ab2468 or later
   ```

6. **Restart app:**
   ```bash
   pm2 restart app-name
   pm2 logs app-name  # Monitor for errors
   ```

7. **Test API directly on Ubuntu:**
   ```bash
   curl "http://localhost:3000/api/leave-balance?employee_id=5" | jq .
   
   # Expected: should show leaveCycleStart = "2026-04-0X" (today's anniversary year)
   ```

8. **Test leave deduction workflow:**
   - Admin approves a new leave on today's date
   - Employee login → My Info → Leave → Check if balance decremented

## Key Code Changes in Commits

**Commit 1ab2468:** Fixed DB credentials
- Changed: hardcoded `mysql.createConnection(dbConfig)` → `pool.getConnection()`
- Result: Uses env vars instead of hardcoded root@localhost

**Commit b9d5329:** Improved leave page refresh
- Added: `cache: "no-store"` to fetch calls
- Added: Timestamp cache-buster `?ts=${Date.now()}`
- Fixed: WebSocket URL from hardcoded `ws://localhost:3000` → dynamic host

**lib/leave-cycle.ts:** Leave renewal logic
- Calculates cycle start based on employee joining date anniversary
- Handles leap years (Feb 29)
- Returns YYYY-MM-DD string for filtering

## If Still Not Working

Enable verbose logging in `/app/api/leave-balance/route.ts`:

Add after line 37 (after joining the job record):

```typescript
console.log('[LEAVE-BALANCE-DEBUG]', {
  employeeId,
  joinedDate: job?.joined_date,
  today: new Date().toISOString(),
  leaveCycleStart,
  leavesQuery,
  leaveParams
});
```

Then restart and check app logs:
```bash
pm2 logs app-name | grep LEAVE-BALANCE-DEBUG
```

This will show exactly what cycle date is being used to filter leaves.

## Summary

**Most Likely Fix:** Restart the Node.js application after pulling the latest code (commit 1ab2468).

Run on Ubuntu:
```bash
git pull origin main
pm2 restart all
```

Then test the API and check if leave balances now reset on the joining date anniversary.
