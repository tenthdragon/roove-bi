RESET ROLE;
-- Users:
--   ...001 platform owner (profiles.role = owner), no membership rows
--   ...002 workspace_owner of alpha
--   ...003 staf_finance of alpha (granted tab:tax-withholding by migration 247)
--   ...004 staf_ops of alpha (no tax permission)
--   ...005 staf_finance of beta only (cross-workspace)
--   ...006 direktur_finance of alpha, membership suspended
--   ...007 admin of alpha; the admin grant is revoked later in this file
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'), ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000005'), ('00000000-0000-4000-8000-000000000006'),
  ('00000000-0000-4000-8000-000000000007');
INSERT INTO public.profiles (id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-000000000002', 'admin'),
  ('00000000-0000-4000-8000-000000000003', 'staf_finance'),
  ('00000000-0000-4000-8000-000000000004', 'staf_ops'),
  ('00000000-0000-4000-8000-000000000005', 'staf_finance'),
  ('00000000-0000-4000-8000-000000000006', 'direktur_finance'),
  ('00000000-0000-4000-8000-000000000007', 'admin');
INSERT INTO public.workspace_memberships (workspace_id, user_id, role, status) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000002', 'workspace_owner', 'active'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000003', 'staf_finance', 'active'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000004', 'staf_ops', 'active'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000005', 'staf_finance', 'active'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000006', 'direktur_finance', 'suspended'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000007', 'admin', 'active');
INSERT INTO public.scalev_webhook_businesses (id, workspace_id, business_code) VALUES
  (1, '00000000-0000-4000-8000-000000000101', 'RTI'),
  (2, '00000000-0000-4000-8000-000000000102', 'PRVA');

-- Master rows: two counterparties and one entity in alpha, one of each in beta.
INSERT INTO public.tax_withholding_entities (workspace_id, business_id, legal_name, npwp, tku_id) VALUES
  ('00000000-0000-4000-8000-000000000101', 1, 'PT ALPHA', '1234567890123456', '1234567890123456000000'),
  ('00000000-0000-4000-8000-000000000102', 2, 'PT BETA', '6543210987654321', '6543210987654321000000');
INSERT INTO public.tax_counterparties (id, workspace_id, name, identity_type, identity_number, is_pkp) VALUES
  (1, '00000000-0000-4000-8000-000000000101', 'VENDOR ALPHA SATU', 'npwp', '0011223344556677', true),
  (2, '00000000-0000-4000-8000-000000000101', 'ORANG ALPHA', 'nik', '3273010101010001', false),
  (3, '00000000-0000-4000-8000-000000000102', 'VENDOR BETA', 'npwp', '0099887766554433', true);
INSERT INTO public.tax_counterparty_facilities (workspace_id, counterparty_id, facility_code, applies_to) VALUES
  ('00000000-0000-4000-8000-000000000101', 1, 'TaxExAr23', ARRAY['pph23']),
  ('00000000-0000-4000-8000-000000000102', 3, 'PP23', ARRAY['pph23']);

-- Reads run as the authenticated role with a JWT subject, like PostgREST.
CREATE FUNCTION public.tax_access_visible_rows(p_user uuid)
RETURNS TABLE (entities bigint, counterparties bigint, facilities bigint)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.tax_withholding_entities),
    (SELECT count(*) FROM public.tax_counterparties),
    (SELECT count(*) FROM public.tax_counterparty_facilities);
END $$;
GRANT EXECUTE ON FUNCTION public.tax_access_visible_rows(uuid) TO authenticated;

CREATE FUNCTION public.tax_access_expect(p_label text, p_user uuid, p_entities bigint, p_counterparties bigint, p_facilities bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.tax_access_visible_rows(p_user);
  IF v.entities <> p_entities OR v.counterparties <> p_counterparties OR v.facilities <> p_facilities THEN
    RAISE EXCEPTION '% saw entities=% counterparties=% facilities=% (expected %/%/%)',
      p_label, v.entities, v.counterparties, v.facilities, p_entities, p_counterparties, p_facilities;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.tax_access_expect(text, uuid, bigint, bigint, bigint) TO authenticated;

SET ROLE authenticated;
SELECT public.tax_access_expect('platform owner', '00000000-0000-4000-8000-000000000001', 2, 3, 2);
SELECT public.tax_access_expect('workspace owner of alpha', '00000000-0000-4000-8000-000000000002', 1, 2, 1);
SELECT public.tax_access_expect('staf_finance of alpha', '00000000-0000-4000-8000-000000000003', 1, 2, 1);
SELECT public.tax_access_expect('admin of alpha', '00000000-0000-4000-8000-000000000007', 1, 2, 1);
SELECT public.tax_access_expect('staf_ops of alpha without tax permission', '00000000-0000-4000-8000-000000000004', 0, 0, 0);
SELECT public.tax_access_expect('staf_finance of beta sees beta only', '00000000-0000-4000-8000-000000000005', 1, 1, 1);
SELECT public.tax_access_expect('suspended direktur_finance of alpha', '00000000-0000-4000-8000-000000000006', 0, 0, 0);
SELECT public.tax_access_expect('anonymous subject', '00000000-0000-4000-8000-000000000099', 0, 0, 0);
RESET ROLE;

-- Revoking the workspace permission removes access immediately.
DELETE FROM public.workspace_role_permissions
WHERE workspace_id = '00000000-0000-4000-8000-000000000101' AND role = 'admin' AND permission_key = 'tab:tax-withholding';
-- Revoking the membership removes access even though the role template still grants the tab.
UPDATE public.workspace_memberships SET status = 'suspended'
WHERE workspace_id = '00000000-0000-4000-8000-000000000101' AND user_id = '00000000-0000-4000-8000-000000000003';
-- Granting the tab to a role in one workspace does not leak into the other.
INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
VALUES ('00000000-0000-4000-8000-000000000102', 'staf_ops', 'tab:tax-withholding');

SET ROLE authenticated;
SELECT public.tax_access_expect('admin of alpha after permission revoked', '00000000-0000-4000-8000-000000000007', 0, 0, 0);
SELECT public.tax_access_expect('staf_finance of alpha after membership suspended', '00000000-0000-4000-8000-000000000003', 0, 0, 0);
SELECT public.tax_access_expect('staf_ops of alpha when beta grants staf_ops', '00000000-0000-4000-8000-000000000004', 0, 0, 0);
RESET ROLE;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.tax_counterparties', 'SELECT')
    OR has_table_privilege('authenticated', 'public.tax_counterparties', 'INSERT')
    OR has_table_privilege('authenticated', 'public.tax_counterparties', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.tax_counterparties', 'DELETE')
    OR has_table_privilege('authenticated', 'public.tax_withholding_entities', 'INSERT')
    OR has_table_privilege('authenticated', 'public.tax_counterparty_facilities', 'INSERT')
    OR has_function_privilege('anon', 'public.workspace_has_tax_access(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Privilege leak on tax master tables';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.tax_object_codes', 'SELECT') THEN
    RAISE EXCEPTION 'Object codes must stay readable reference data';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('tax_counterparties', 'tax_withholding_entities', 'tax_counterparty_facilities')
        AND cmd = 'SELECT' AND qual LIKE '%workspace_has_tax_access%') <> 3 THEN
    RAISE EXCEPTION 'Read policies must use workspace_has_tax_access';
  END IF;
END $$;
SELECT 'PASS: tax master reads limited to finance access, isolated per workspace, revocable, writes service-role only';
