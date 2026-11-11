-- Supabase default privileges can grant ALL to authenticated on newly created
-- tables. GRANT SELECT alone does not remove those inherited creation grants.
-- Keep client access read-only; RLS still limits which tax master rows are read.
BEGIN;

REVOKE ALL ON TABLE
  public.tax_object_codes,
  public.tax_withholding_entities,
  public.tax_counterparties,
  public.tax_counterparty_facilities
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.tax_object_codes,
  public.tax_withholding_entities,
  public.tax_counterparties,
  public.tax_counterparty_facilities
TO authenticated;

GRANT ALL ON TABLE
  public.tax_object_codes,
  public.tax_withholding_entities,
  public.tax_counterparties,
  public.tax_counterparty_facilities
TO service_role;

REVOKE ALL ON SEQUENCE
  public.tax_withholding_entities_id_seq,
  public.tax_counterparties_id_seq,
  public.tax_counterparty_facilities_id_seq
FROM PUBLIC, anon, authenticated;

GRANT ALL ON SEQUENCE
  public.tax_withholding_entities_id_seq,
  public.tax_counterparties_id_seq,
  public.tax_counterparty_facilities_id_seq
TO service_role;

COMMIT;
