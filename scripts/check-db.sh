#!/bin/bash

# Quick database diagnostic script for Ubuntu
# Usage: ./scripts/check-db.sh

echo "=== HRM Database Diagnostic ==="
echo ""
echo "Environment Variables:"
echo "  DB_HOST: ${DB_HOST:-localhost}"
echo "  DB_USER: ${DB_USER:-root}"
echo "  DB_PASSWORD: ${DB_PASSWORD:-(not set)}"
echo "  DB_NAME: ${DB_NAME:-hrm2}"
echo ""

DB_USER=${DB_USER:-root}
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=${DB_HOST:-localhost}

# Build mysql command with appropriate flags
if [ -z "$DB_PASSWORD" ]; then
  MYSQL_CMD="mysql -u $DB_USER -h $DB_HOST"
else
  MYSQL_CMD="mysql -u $DB_USER -p$DB_PASSWORD -h $DB_HOST"
fi

echo "=== Testing MySQL Connection ==="
if $MYSQL_CMD -e "SELECT 1;" &>/dev/null; then
  echo "✓ MySQL connection successful"
else
  echo "❌ MySQL connection failed"
  echo "Try:"
  echo "  export DB_USER=root"
  echo "  export DB_PASSWORD=your_password"
  exit 1
fi

echo ""
echo "=== Available Databases ==="
$MYSQL_CMD -e "SHOW DATABASES;" | grep -i hrm
if [ $? -eq 0 ]; then
  echo "✓ HRM database found"
else
  echo "❌ No HRM database found. Full list:"
  $MYSQL_CMD -e "SHOW DATABASES;"
  exit 1
fi

echo ""
echo "=== Checking Database Tables ==="
DB_NAME=${DB_NAME:-hrm2}
echo "Database: $DB_NAME"

TABLES=$($MYSQL_CMD "$DB_NAME" -e "SHOW TABLES;" 2>&1)

if echo "$TABLES" | grep -q "employee_jobs"; then
  echo "✓ employee_jobs table exists"
else
  echo "❌ employee_jobs table NOT found"
fi

if echo "$TABLES" | grep -q "employee_leaves"; then
  echo "✓ employee_leaves table exists"
else
  echo "❌ employee_leaves table NOT found"
fi

if echo "$TABLES" | grep -q "hrm_employees"; then
  echo "✓ hrm_employees table exists"
else
  echo "❌ hrm_employees table NOT found"
fi

echo ""
echo "=== Sample Data Check ==="
echo "Total employees:"
$MYSQL_CMD "$DB_NAME" -e "SELECT COUNT(*) as count FROM hrm_employees LIMIT 1;" 2>/dev/null || echo "❌ Cannot query hrm_employees"

echo "Employees with joined_date:"
$MYSQL_CMD "$DB_NAME" -e "SELECT COUNT(*) as count FROM employee_jobs WHERE joined_date IS NOT NULL;" 2>/dev/null || echo "❌ Cannot query employee_jobs"

echo ""
echo "=== Done ==="
