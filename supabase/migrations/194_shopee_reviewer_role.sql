-- PostgreSQL enum values must be committed before they can be used by a
-- following migration.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'shopee_reviewer';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sales_manager';
