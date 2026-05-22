# Ubuntu: "Unknown database 'hrm2'" Error - Fix Guide

## Problem
```
Error: Unknown database 'hrm2'
    at Object.createConnectionPromise [as createConnection]
```

This error means either:
1. Database 'hrm2' doesn't exist on Ubuntu
2. Wrong database name is being used
3. User permissions are incorrect

---

## Immediate Fix: Run Diagnostic

On Ubuntu server:

```bash
cd /root/interact-hrm2

# Pull latest code with improved debug scripts
git pull origin main

# Run database diagnostic
bash scripts/check-db.sh
```

This will show:
- ✓/❌ MySQL connection
- ✓/❌ Available HRM databases
- ✓/❌ Required tables
- Sample data counts

---

## What Database Actually Exists?

If `check-db.sh` shows your database is named differently (e.g., `interact_hrm` instead of `hrm2`), then:

### Option 1: Use Environment Variable (Recommended)
```bash
# Set the correct database name
export DB_NAME=interact_hrm  # (use what check-db.sh showed)

# Test
node scripts/debug-leave-cycle.js 5
```

### Option 2: Rename Database (More Work)
```bash
mysql -u root -p
```

```sql
-- List current databases
SHOW DATABASES;

-- If you see 'interact_hrm' but need 'hrm2':
CREATE DATABASE hrm2;
-- Copy tables from old to new...
-- This is complex, use Option 1 instead
```

---

## Setup Environment Variables Permanently

On Ubuntu, add to `.env` or systemd service file:

### If using `.env`:
```bash
# .env in project root
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=interact_hrm  # Use actual database name from check-db.sh
```

Then when running scripts:
```bash
source .env && node scripts/debug-leave-cycle.js 5
```

### If using PM2:
```bash
# Find PM2 config
pm2 show app-name

# Edit app.config.js or ecosystem.config.js
module.exports = {
  apps: [{
    name: 'hrm',
    script: 'npm start',
    env: {
      DB_HOST: 'localhost',
      DB_USER: 'root',
      DB_PASSWORD: 'your_password',
      DB_NAME: 'interact_hrm',
      NODE_ENV: 'production'
    }
  }]
};

# Restart
pm2 restart app-name
```

### If using Docker:
```bash
# In docker-compose.yml or Dockerfile
environment:
  - DB_HOST=localhost
  - DB_USER=root
  - DB_PASSWORD=your_password
  - DB_NAME=interact_hrm
```

---

## Database Doesn't Exist at All

If check-db.sh shows NO HRM database:

### Option 1: Restore from Backup
```bash
# If you have a backup file (db.sql)
mysql -u root -p < db.sql
```

### Option 2: Create Fresh Database
```bash
mysql -u root -p
```

```sql
CREATE DATABASE `interact_hrm`;
USE `interact_hrm`;

-- Then import the schema (if you have schema files)
SOURCE /path/to/schema.sql;
```

### Option 3: Migrate from Development Machine
On your Windows laptop:
```bash
# Dump the database
mysqldump -u root -p hrm2 > db-ubuntu.sql

# Transfer file to Ubuntu via SCP
scp db-ubuntu.sql user@ubuntu-server:/tmp/

# On Ubuntu
mysql -u root -p interact_hrm < /tmp/db-ubuntu.sql
```

---

## Step-by-Step Verification

1. **Check what databases exist:**
   ```bash
   bash scripts/check-db.sh
   ```
   Look for lines like: `interact_hrm` or `hrm2` or `hrm`

2. **Set environment variable to the right database:**
   ```bash
   export DB_NAME=interact_hrm  # (use actual name from above)
   ```

3. **Test debug script:**
   ```bash
   node scripts/debug-leave-cycle.js 5
   ```
   Should show employee info and leave cycle start date

4. **Restart the app:**
   ```bash
   pm2 restart all
   ```

5. **Test the API:**
   ```bash
   curl "http://localhost:3000/api/leave-balance?employee_id=5"
   ```
   Should show `leaveCycleStart` value

---

## Why This Happens

Ubuntu setup is often fresh and may have:
- ✗ Different database naming convention
- ✗ No environment variables configured
- ✗ Database not imported from development machine
- ✗ Permissions issues preventing database creation

This is why I added better debugging - to automatically detect and work with whatever database exists.

---

## After Fixing Database Issue

Once `node scripts/debug-leave-cycle.js 5` works, leave renewal should work:

1. **App** needs to be restarted (will now use correct DB connection)
2. **Test leave renewal:**
   ```bash
   # Approve a leave for today's date
   # Then check:
   curl "http://localhost:3000/api/leave-balance?employee_id=5"
   # annualBalance should show used days deducted
   ```

---

## Still Not Working?

Run and share output of:
```bash
bash scripts/check-db.sh
node scripts/debug-leave-cycle.js 5
```

This will show exactly where the problem is.
