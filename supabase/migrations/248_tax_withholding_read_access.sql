-- ============================================================================
-- 248: Scope tax master reads to finance access
-- ============================================================================
-- Migration 247 let every active workspace member read tax counterparties,
-- withholding entities and facilities through the database API. Those rows
-- carry NPWP/NIK, addresses and phone numbers, so direct reads must follow the
-- same rule as the page: platform owner, workspace owner, or a membership role
-- granted `tab:tax-withholding` in that workspace. Workspace isolation is kept
-- because the check is evaluated against the row's own workspace_id.
-- Writes stay service-role only. tax_object_codes is public reference data.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.workspace_has_tax_access(
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
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships membership
      LEFT JOIN public.workspace_role_permissions permission
        ON permission.workspace_id = membership.workspace_id
       AND permission.role = membership.role
       AND permission.permission_key = 'tab:tax-withholding'
      WHERE membership.workspace_id = p_workspace_id
        AND membership.user_id = p_user_id
        AND membership.status = 'active'
        AND (
          membership.role = 'workspace_owner'
          OR permission.permission_key IS NOT NULL
        )
    );
$$;

REVOKE ALL ON FUNCTION public.workspace_has_tax_access(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_has_tax_access(UUID, UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS tax_withholding_entities_read ON public.tax_withholding_entities;
CREATE POLICY tax_withholding_entities_read ON public.tax_withholding_entities
  FOR SELECT TO authenticated
  USING (public.workspace_has_tax_access(workspace_id));

DROP POLICY IF EXISTS tax_counterparties_read ON public.tax_counterparties;
CREATE POLICY tax_counterparties_read ON public.tax_counterparties
  FOR SELECT TO authenticated
  USING (public.workspace_has_tax_access(workspace_id));

DROP POLICY IF EXISTS tax_counterparty_facilities_read ON public.tax_counterparty_facilities;
CREATE POLICY tax_counterparty_facilities_read ON public.tax_counterparty_facilities
  FOR SELECT TO authenticated
  USING (public.workspace_has_tax_access(workspace_id));

COMMIT;
