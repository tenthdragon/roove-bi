-- Add new role ENUM values
-- Must be in a separate migration from data changes due to PostgreSQL transaction constraints

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'direktur_ops';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staf_ops';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'direktur_finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staf_finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ppic_manager';
