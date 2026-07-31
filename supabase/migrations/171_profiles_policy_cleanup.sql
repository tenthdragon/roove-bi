-- ============================================================================
-- 171: Remove legacy profile policies that break authenticated reads
-- ============================================================================
-- Some production databases predate the tracked migration history and can
-- retain manually-created policies that call legacy helpers such as
-- is_owner_or_admin(). PostgreSQL evaluates every applicable permissive policy,
-- so one stale policy without EXECUTE privileges can make even the self-read
-- policy fail with "permission denied for function is_owner_or_admin".
--
-- Profiles now have one deterministic workspace-aware policy set. Admin writes
-- continue to use the service-role paths in the application.
-- ============================================================================

BEGIN;

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

REVOKE ALL ON FUNCTION public.profile_shares_workspace(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_dashboard_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_shares_workspace(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_dashboard_profile() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;

-- Drop every pre-workspace profile policy, including policies that were added
-- manually and therefore do not have a stable name in this repository.
DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.profiles',
      existing_policy.policyname
    );
  END LOOP;
END;
$$;

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
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (
      active_workspace_id IS NULL
      OR public.workspace_can_access(active_workspace_id)
    )
  );

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, active_workspace_id)
  ON public.profiles TO authenticated;

COMMIT;
