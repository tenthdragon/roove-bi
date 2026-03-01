-- ============================================================
-- Migration 003: Fix security issues
-- 1. Re-enable RLS on profiles with proper policies
-- 2. Create sheet_connections table with RLS
-- Safe to re-run (uses DROP IF EXISTS before CREATE)
-- Run this in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- PART 1: Fix profiles RLS
-- ============================================================

-- Re-enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies on profiles (old + new) to start clean
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Owner manage profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Owner can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Owner can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Allow profile creation" ON profiles;

-- Authenticated users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Owner can read ALL profiles (needed for user management)
CREATE POLICY "Owner can read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

-- Users can update their own non-role fields
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Owner can update any profile (for role management)
CREATE POLICY "Owner can update all profiles"
  ON profiles FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

-- Allow insert via trigger (service role handles this, but just in case)
CREATE POLICY "Allow profile creation"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ============================================================
-- PART 2: Create sheet_connections table with proper RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS sheet_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spreadsheet_id TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced TIMESTAMPTZ,
  last_sync_status TEXT, -- 'success', 'error'
  last_sync_message TEXT
);

-- Enable RLS
ALTER TABLE sheet_connections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (safe to re-run)
DROP POLICY IF EXISTS "Authenticated users can read sheet_connections" ON sheet_connections;
DROP POLICY IF EXISTS "Owner can insert sheet_connections" ON sheet_connections;
DROP POLICY IF EXISTS "Owner can update sheet_connections" ON sheet_connections;
DROP POLICY IF EXISTS "Owner can delete sheet_connections" ON sheet_connections;

-- Authenticated users can read sheet connections
CREATE POLICY "Authenticated users can read sheet_connections"
  ON sheet_connections FOR SELECT TO authenticated
  USING (true);

-- Only owner can insert/update/delete
CREATE POLICY "Owner can insert sheet_connections"
  ON sheet_connections FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

CREATE POLICY "Owner can update sheet_connections"
  ON sheet_connections FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

CREATE POLICY "Owner can delete sheet_connections"
  ON sheet_connections FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_sheet_connections_active
  ON sheet_connections(is_active);
