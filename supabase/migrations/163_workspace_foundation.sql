-- ============================================================================
-- 163: Workspace tenancy foundation
-- ============================================================================
-- This migration is intentionally additive:
--   * every existing user starts in Roove Workspace
--   * Apurva Workspace is provisioned but remains empty
--   * no existing business data is deleted or renamed
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisioning', 'active', 'suspended')),
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.workspaces (id, slug, name, status)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'roove', 'Roove Workspace', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'apurva', 'Apurva Workspace', 'provisioning')
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS public.workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_memberships_default_user
  ON public.workspace_memberships (user_id)
  WHERE is_default = TRUE AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_active
  ON public.workspace_memberships (user_id, status, workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_role_permissions (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (workspace_id, role, permission_key)
);

-- Copy the current permission matrix into both workspaces as an initial
-- template. From this point onward each workspace edits its own copy.
INSERT INTO public.workspace_role_permissions (
  workspace_id,
  role,
  permission_key
)
SELECT
  workspace.id,
  permission.role,
  permission.permission_key
FROM public.workspaces workspace
CROSS JOIN public.role_permissions permission
WHERE workspace.id IN (
  '00000000-0000-4000-8000-000000000001'::UUID,
  '00000000-0000-4000-8000-000000000002'::UUID
)
ON CONFLICT DO NOTHING;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE SET NULL;

INSERT INTO public.workspace_memberships (
  workspace_id,
  user_id,
  role,
  status,
  is_default
)
SELECT
  '00000000-0000-4000-8000-000000000001'::UUID,
  p.id,
  CASE
    WHEN p.role::TEXT = 'owner' THEN 'workspace_owner'
    ELSE p.role::TEXT
  END,
  'active',
  TRUE
FROM public.profiles p
ON CONFLICT (workspace_id, user_id) DO UPDATE
SET role = EXCLUDED.role,
    status = 'active',
    is_default = TRUE,
    updated_at = NOW();

UPDATE public.profiles
SET active_workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
WHERE active_workspace_id IS NULL;

CREATE TABLE IF NOT EXISTS public.workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name TEXT,
  credential_reference TEXT,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_active
  ON public.workspace_integrations (workspace_id, provider, is_active);

CREATE TABLE IF NOT EXISTS public.workspace_warehouse_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  warehouse_code TEXT NOT NULL,
  access_level TEXT NOT NULL
    CHECK (access_level IN ('owner', 'operator', 'customer', 'read_only')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, warehouse_code)
);

-- BTN is the currently shared physical warehouse. Data ownership is added in
-- the following migration; this grant alone never grants access to another
-- workspace's inventory.
INSERT INTO public.workspace_warehouse_access (
  workspace_id,
  warehouse_code,
  access_level
)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'BTN', 'operator'),
  ('00000000-0000-4000-8000-000000000002', 'BTN', 'customer')
ON CONFLICT (workspace_id, warehouse_code) DO UPDATE
SET access_level = EXCLUDED.access_level,
    is_active = TRUE,
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.is_platform_owner(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_user_id
      AND p.role::TEXT = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_has_membership(
  p_workspace_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_has_role(
  p_workspace_id UUID,
  p_roles TEXT[],
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(p_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = p_user_id
        AND wm.status = 'active'
        AND wm.role = ANY(p_roles)
    );
$$;

CREATE OR REPLACE FUNCTION public.workspace_can_access(
  p_workspace_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(p_user_id)
    OR public.workspace_has_membership(p_workspace_id, p_user_id);
$$;

-- Keep membership joins out of the profiles RLS expression itself. This
-- SECURITY DEFINER helper prevents policy recursion while still deriving the
-- requesting user exclusively from the authenticated JWT.
CREATE OR REPLACE FUNCTION public.profile_shares_workspace(
  p_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships mine
    JOIN public.workspace_memberships theirs
      ON theirs.workspace_id = mine.workspace_id
     AND theirs.status = 'active'
    WHERE mine.user_id = auth.uid()
      AND mine.status = 'active'
      AND theirs.user_id = p_profile_id
  );
$$;

-- Login bootstrap must never depend on a team-level profiles policy. The
-- function returns only the row whose id is present in the caller's JWT.
CREATE OR REPLACE FUNCTION public.get_my_dashboard_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
ROWS 1
AS $$
  SELECT p.*
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_platform_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_has_membership(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_has_role(UUID, TEXT[], UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_can_access(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_shares_workspace(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_dashboard_profile() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_platform_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_has_membership(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_has_role(UUID, TEXT[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_can_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_shares_workspace(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_dashboard_profile() TO authenticated;

-- Migration 002 historically disabled profile RLS. Re-enable it now that team
-- visibility has a workspace boundary.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read profiles"
  ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"
  ON public.profiles;
DROP POLICY IF EXISTS "Owner manage profiles"
  ON public.profiles;
DROP POLICY IF EXISTS profiles_read_self
  ON public.profiles;
DROP POLICY IF EXISTS profiles_read_workspace_team
  ON public.profiles;

CREATE POLICY profiles_read_self
  ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_read_workspace_team
  ON public.profiles
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR public.profile_shares_workspace(id)
  );

CREATE POLICY profiles_update_self
  ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND (
      active_workspace_id IS NULL
      OR public.workspace_can_access(active_workspace_id)
    )
  );

-- A normal user may change presentation/default-workspace fields only. Role,
-- email, Telegram mapping and other administrative fields remain service-side.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, active_workspace_id)
  ON public.profiles TO authenticated;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_warehouse_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_read_accessible ON public.workspaces;
CREATE POLICY workspaces_read_accessible ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(id));

DROP POLICY IF EXISTS workspaces_platform_manage ON public.workspaces;
CREATE POLICY workspaces_platform_manage ON public.workspaces
  FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

DROP POLICY IF EXISTS workspace_memberships_read_accessible ON public.workspace_memberships;
CREATE POLICY workspace_memberships_read_accessible ON public.workspace_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_owner()
    OR public.workspace_has_role(workspace_id, ARRAY['workspace_owner'])
  );

DROP POLICY IF EXISTS workspace_memberships_manage ON public.workspace_memberships;
CREATE POLICY workspace_memberships_manage ON public.workspace_memberships
  FOR ALL TO authenticated
  USING (
    public.is_platform_owner()
    OR public.workspace_has_role(workspace_id, ARRAY['workspace_owner'])
  )
  WITH CHECK (
    public.is_platform_owner()
    OR public.workspace_has_role(workspace_id, ARRAY['workspace_owner'])
  );

DROP POLICY IF EXISTS workspace_role_permissions_read
  ON public.workspace_role_permissions;
CREATE POLICY workspace_role_permissions_read
  ON public.workspace_role_permissions
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP POLICY IF EXISTS workspace_role_permissions_manage
  ON public.workspace_role_permissions;
CREATE POLICY workspace_role_permissions_manage
  ON public.workspace_role_permissions
  FOR ALL TO authenticated
  USING (
    public.workspace_has_role(workspace_id, ARRAY['workspace_owner'])
  )
  WITH CHECK (
    public.workspace_has_role(workspace_id, ARRAY['workspace_owner'])
  );

DROP POLICY IF EXISTS workspace_integrations_read ON public.workspace_integrations;
CREATE POLICY workspace_integrations_read ON public.workspace_integrations
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP POLICY IF EXISTS workspace_integrations_manage ON public.workspace_integrations;
CREATE POLICY workspace_integrations_manage ON public.workspace_integrations
  FOR ALL TO authenticated
  USING (
    public.workspace_has_role(
      workspace_id,
      ARRAY['workspace_owner', 'admin', 'direktur_ops']
    )
  )
  WITH CHECK (
    public.workspace_has_role(
      workspace_id,
      ARRAY['workspace_owner', 'admin', 'direktur_ops']
    )
  );

DROP POLICY IF EXISTS workspace_warehouse_access_read ON public.workspace_warehouse_access;
CREATE POLICY workspace_warehouse_access_read ON public.workspace_warehouse_access
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP POLICY IF EXISTS workspace_warehouse_access_manage ON public.workspace_warehouse_access;
CREATE POLICY workspace_warehouse_access_manage ON public.workspace_warehouse_access
  FOR ALL TO authenticated
  USING (public.is_platform_owner())
  WITH CHECK (public.is_platform_owner());

CREATE OR REPLACE FUNCTION public.set_workspace_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_workspaces ON public.workspaces;
CREATE TRIGGER set_updated_at_workspaces
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_workspace_memberships ON public.workspace_memberships;
CREATE TRIGGER set_updated_at_workspace_memberships
  BEFORE UPDATE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_workspace_integrations ON public.workspace_integrations;
CREATE TRIGGER set_updated_at_workspace_integrations
  BEFORE UPDATE ON public.workspace_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_workspace_warehouse_access ON public.workspace_warehouse_access;
CREATE TRIGGER set_updated_at_workspace_warehouse_access
  BEFORE UPDATE ON public.workspace_warehouse_access
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

COMMIT;
