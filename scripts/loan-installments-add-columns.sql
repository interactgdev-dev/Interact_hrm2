-- Run this in phpMyAdmin to add/update columns for loan_installments
-- Status: paid | pending | stop
-- Payable This Month: editable amount (can differ from original_amount/per_installment)

-- 1. Add payable_this_month column
-- (If error "Duplicate column" appears, skip this line - column already exists)
ALTER TABLE loan_installments
ADD COLUMN payable_this_month DECIMAL(12,2) DEFAULT NULL
AFTER paid_amount;

-- 2. Ensure status column supports: paid, pending, stop
ALTER TABLE loan_installments
MODIFY COLUMN status VARCHAR(20) DEFAULT 'pending';

-- 3. Set payable_this_month = original_amount for existing rows
UPDATE loan_installments SET payable_this_month = original_amount WHERE payable_this_month IS NULL;
