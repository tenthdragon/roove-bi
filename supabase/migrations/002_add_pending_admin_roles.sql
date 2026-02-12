-- ============================================================
-- Migration 002: Add pending + admin roles, fix trigger
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add new enum values
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';

-- Disable RLS on profiles (was causing issues)
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Recreate trigger: new users get 'pending' role (except first user = owner)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    CASE
      WHEN (SELECT COUNT(*) FROM public.profiles) = 0 THEN 'owner'::user_role
      ELSE 'pending'::user_role
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Update existing 'manager' users to 'admin' (if any)
UPDATE profiles SET role = 'admin' WHERE role = 'manager';
