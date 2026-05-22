# Employment Status Auto-Update Feature

## Overview
This feature automatically promotes employees from "Probation" status to "Permanent" status after 3 months from their joining date.

**Example:** If an employee joined on August 25, 2025, their employment status will automatically change to "Permanent" on November 25, 2025.

## How It Works

1. The system monitors all employees with "Probation" employment status
2. It checks their joining date from the job details
3. When 3 months have passed since the joining date, the employment status is automatically updated to "Permanent"
4. Both `hrm_employees` and `employee_jobs` tables are updated

## Components

### 1. API Endpoint
**Location:** `app/api/auto-update-employment-status/route.ts`

- **Method:** GET or POST
- **Endpoint:** `/api/auto-update-employment-status`
- **Response:**
  ```json
  {
    "success": true,
    "message": "Auto-update completed. X employees promoted from Probation to Permanent.",
    "updated_count": 5,
    "total_probation_employees": 12,
    "updated_employees": [
      {
        "employee_id": "EMP001",
        "joined_date": "2025-08-25",
        "updated_to_permanent": true,
        "days_since_joining": 92
      }
    ]
  }
  ```

### 2. Admin Dashboard
**Location:** `/admin/employment-status-update`

Features:
- Manual trigger button to run the update immediately
- View results of the last update
- Display of all promoted employees
- Helpful information about setting up automated cron jobs

### 3. Helper Script (Optional)
**Location:** `scripts/auto-update-employment-status.js`

A Node.js script that can be run via cron jobs or task schedulers for automatic daily execution.

## Setup Instructions

### Method 1: Manual Trigger (Quickest)
1. Go to Admin Dashboard
2. Navigate to "Status Auto-Update" (in the HR section)
3. Click "Run Employment Status Update Now" button
4. View the results instantly

### Method 2: Automated Daily Execution via Cron Job

#### For Linux/Mac:

1. Open your crontab editor:
   ```bash
   crontab -e
   ```

2. Add one of the following lines to run daily at midnight:

   **Option A - Using curl (no Node.js required):**
   ```
   0 0 * * * curl -X GET http://your-app-url/api/auto-update-employment-status
   ```

   **Option B - Using Node.js script:**
   ```
   0 0 * * * cd /path/to/hrm-project && node scripts/auto-update-employment-status.js
   ```

3. Set the `API_URL` environment variable if the app is on a different server:
   ```
   0 0 * * * API_URL=https://your-domain.com node /path/to/scripts/auto-update-employment-status.js
   ```

#### For Windows (Task Scheduler):

1. Open Task Scheduler (taskschd.msc)
2. Click "Create Basic Task"
3. Name it: "Employment Status Auto-Update"
4. Set trigger to run daily (e.g., at 12:00 AM)
5. Set action to "Start a program":
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `C:\path\to\project\scripts\auto-update-employment-status.js`
   - (Set `API_URL=http://localhost:3000` in environment if needed)
6. Click OK

### Method 3: Other Schedulers

You can use any external cron/scheduler service:
- **External Cron Services:** Cron-job.org, EasyCron, Crontab Guru
- Make a simple GET request to: `http://your-app-url/api/auto-update-employment-status`

Example curl:
```bash
curl -X GET "http://localhost:3000/api/auto-update-employment-status" \
  -H "Content-Type: application/json"
```

## Database Schema Requirements

### Required Tables and Columns:

**hrm_employees table:**
- `employee_code` (VARCHAR) - Employee ID
- `employment_status` (VARCHAR) - Current status (Probation/Permanent/etc)

**employee_jobs table:**
- `employee_id` (VARCHAR) - Employee ID
- `joined_date` (DATE) - Date of joining

## Important Notes

1. **Probation Status:** New employees must have "Probation" status set during onboarding
2. **Joining Date:** The joining date must be recorded in the employee job details
3. **Timezone:** The system uses the server's local timezone for date calculations
4. **No Manual Changes:** Once promoted, employees cannot be reverted to Probation automatically
5. **Audit Trail:** All automatic updates are logged (check server logs for details)

## Troubleshooting

### Issue: No employees being updated
- Check that employees have "Probation" status in `hrm_employees` table
- Verify that joining dates are set in `employee_jobs` table
- Ensure the dates are in valid DATE format

### Issue: Cron job not executing
- Test the API endpoint manually: `curl -X GET http://localhost:3000/api/auto-update-employment-status`
- Check server logs for errors
- Verify Node.js is properly installed (for script method)
- Confirm the cron job syntax is correct

### Issue: Employees updated but status shows in wrong table
- Both `hrm_employees` and `employee_jobs` are updated
- Check both tables to see where the employment status is referenced in your application

## API Security (Optional Enhancement)

To add authentication to the API endpoint, uncomment the authorization check in `app/api/auto-update-employment-status/route.ts`:

```typescript
const authHeader = req.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}
```

Then set the environment variable:
```bash
CRON_SECRET=your-secret-key
```

And call the endpoint with:
```bash
curl -X GET http://localhost:3000/api/auto-update-employment-status \
  -H "Authorization: Bearer your-secret-key"
```

## Monitoring

Regular monitoring is recommended:
1. Review promoted employees periodically
2. Check if any employees should have been promoted but weren't
3. Monitor API response times
4. Set up alerts for failed executions (if using external cron service)

## Future Enhancements

Potential improvements:
- Email notifications when employees are promoted
- Bulk import/export of promotion records
- Customizable probation period (currently fixed at 3 months)
- Custom promotion workflows
- Integration with payroll system
