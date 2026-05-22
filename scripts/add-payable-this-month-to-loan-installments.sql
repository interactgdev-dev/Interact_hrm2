-- Add payable_this_month column to loan_installments (manually editable)
-- Run this in phpMyAdmin if the column doesn't exist

ALTER TABLE loan_installments
ADD COLUMN payable_this_month DECIMAL(12,2) DEFAULT NULL
AFTER paid_amount;
