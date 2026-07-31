-- ============================================================================
-- 170: Restore authenticated profile bootstrap after workspace RLS
-- ============================================================================
-- This migration is safe to run immediately after 163. It keeps profiles
-- tenant-private while guaranteeing that every authenticated user can read
-- their own dashboard profile.
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

DROP POLICY IF EXISTS profiles_read_self ON public.profiles;
DROP POLICY IF EXISTS profiles_read_workspace_team ON public.profiles;

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

COMMIT;
