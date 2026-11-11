RESET ROLE;
-- Runs after tax-withholding-access-db.sql: at this point staf_finance of alpha
-- (...003) is suspended and admin of alpha (...007) lost the tab grant.
-- Remaining readers: platform owner (...001), workspace owner of alpha (...002),
-- staf_finance of beta (...005). staf_ops of alpha (...004) must see nothing.
INSERT INTO public.tax_withholding_slips (
  workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
  period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
  gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
  withholding_amount, vat_rate_percent, vat_amount, total_amount, document_date, withholding_date, status
)
SELECT '00000000-0000-4000-8000-000000000101', e.id, 1, 'VENDOR ALPHA SATU', 'npwp', '0011223344556677',
  10, 2026, DATE '2026-10-16', 'INV-ALPHA-1', '24-104-24', 'pph23',
  'total_incl_vat', 7600, 6846.846847, 2, 'object_code', 137, 11, 753, 7599.846847, DATE '2026-10-16', DATE '2026-10-16', 'ready'
FROM public.tax_withholding_entities e WHERE e.legal_name = 'PT ALPHA';
INSERT INTO public.tax_withholding_slips (
  workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
  period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
  gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
  withholding_amount, vat_rate_percent, vat_amount, total_amount, document_date, withholding_date, status, coretax_slip_number
)
SELECT '00000000-0000-4000-8000-000000000102', e.id, 3, 'VENDOR BETA', 'npwp', '0099887766554433',
  10, 2026, DATE '2026-10-20', 'INV-BETA-1', '24-104-24', 'pph23',
  'dpp', 1000000, 1000000, 2, 'object_code', 20000, 11, 110000, 1110000, DATE '2026-10-20', DATE '2026-10-20', 'reported', '26000BETA1'
FROM public.tax_withholding_entities e WHERE e.legal_name = 'PT BETA';

CREATE FUNCTION public.tax_slips_visible(p_user uuid) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  RETURN (SELECT count(*) FROM public.tax_withholding_slips);
END $$;
GRANT EXECUTE ON FUNCTION public.tax_slips_visible(uuid) TO authenticated;

SET ROLE authenticated;
DO $$ BEGIN
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'platform owner must see both slips'; END IF;
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000002') <> 1 THEN RAISE EXCEPTION 'workspace owner of alpha must see alpha only'; END IF;
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000005') <> 1 THEN RAISE EXCEPTION 'staf_finance of beta must see beta only'; END IF;
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000004') <> 0 THEN RAISE EXCEPTION 'staf_ops without tax access must see no slips'; END IF;
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000003') <> 0 THEN RAISE EXCEPTION 'suspended member must see no slips'; END IF;
  IF public.tax_slips_visible('00000000-0000-4000-8000-000000000007') <> 0 THEN RAISE EXCEPTION 'member whose grant was revoked must see no slips'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.tax_withholding_slips', 'SELECT')
    OR has_table_privilege('authenticated', 'public.tax_withholding_slips', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR NOT has_table_privilege('authenticated', 'public.tax_withholding_slips', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.tax_withholding_slips', 'INSERT,UPDATE,DELETE')
    OR has_sequence_privilege('authenticated', 'public.tax_withholding_slips_id_seq', 'USAGE,SELECT,UPDATE')
    OR NOT has_sequence_privilege('service_role', 'public.tax_withholding_slips_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'Unexpected slip grants';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'tax_withholding_slips' AND cmd = 'SELECT' AND qual LIKE '%workspace_has_tax_access%') <> 1 THEN
    RAISE EXCEPTION 'Slip read policy must use workspace_has_tax_access';
  END IF;
  -- Import identity: same invoice/vendor/object/date/DPP is a duplicate, a different DPP is a second line.
  BEGIN
    INSERT INTO public.tax_withholding_slips (
      workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
      period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
      gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
      withholding_amount, total_amount, document_date, withholding_date)
    SELECT workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
      period_month, period_year, invoice_date, '  inv-alpha-1 ', object_code, pph_article,
      gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
      withholding_amount, total_amount, document_date, withholding_date
    FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1';
    RAISE EXCEPTION 'Duplicate slip must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.tax_withholding_slips (
    workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
    period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
    gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
    withholding_amount, total_amount, document_date, withholding_date)
  SELECT workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
    period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
    'dpp', 500, 500, rate_percent, rate_source, 10, 500, document_date, withholding_date
  FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1';
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1') <> 2 THEN
    RAISE EXCEPTION 'A second line of the same invoice with a different DPP must be allowed';
  END IF;
  -- Reported status requires the Coretax slip number.
  BEGIN
    UPDATE public.tax_withholding_slips SET status = 'reported' WHERE invoice_number = 'INV-ALPHA-1';
    RAISE EXCEPTION 'reported without coretax_slip_number must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT 'PASS: slip reads limited to finance access per workspace; writes service-role only; import identity and status checks enforced';
