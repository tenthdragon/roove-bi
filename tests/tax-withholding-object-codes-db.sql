-- Migration 256: the object code reference is maintainable from the app.
-- Runs after the migration was applied twice, as supabase_admin.
DO $$
DECLARE
  v_before TIMESTAMPTZ;
  v_after TIMESTAMPTZ;
  v_missing TEXT;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tax_object_codes'
          AND column_name IN ('description', 'legal_basis')) <> 2 THEN
    RAISE EXCEPTION 'description and legal_basis columns must exist on tax_object_codes';
  END IF;

  SELECT string_agg(code, ', ') INTO v_missing
  FROM unnest(ARRAY['27-100-07', '27-100-08', '27-100-09', '27-102-03', '27-107-01', '28-405-02',
                    '28-409-08', '28-409-09', '28-409-10', '28-409-11', '28-409-12', '28-409-13', '28-409-14']) AS wanted(code)
  WHERE NOT EXISTS (SELECT 1 FROM public.tax_object_codes c WHERE c.code = wanted.code);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BPNR codes missing after migration 256: %', v_missing;
  END IF;

  -- Effective rate: norma 25% x tarif 20% is stored as 5%, so the rule engine
  -- proposes the rate the BPNR Deemed/Rate pair resolves back to.
  IF (SELECT pph_article || '/' || rate_percent::text || '/' || kap || '/' || kjs
        FROM public.tax_object_codes WHERE code = '27-100-08') <> 'pph26/5.000/411127/100' THEN
    RAISE EXCEPTION 'Unexpected 27-100-08 attributes: %',
      (SELECT pph_article || '/' || rate_percent::text || '/' || kap || '/' || kjs FROM public.tax_object_codes WHERE code = '27-100-08');
  END IF;
  IF (SELECT pph_article || '/' || rate_percent::text || '/' || kap || '/' || kjs
        FROM public.tax_object_codes WHERE code = '28-409-11') <> 'pph4_2/3.000/411128/409' THEN
    RAISE EXCEPTION 'Unexpected 28-409-11 attributes';
  END IF;

  -- Applying the migration twice must not duplicate or overwrite the seed.
  IF (SELECT count(*) FROM public.tax_object_codes WHERE legal_basis LIKE 'Template Coretax BPNR%') <> 13 THEN
    RAISE EXCEPTION 'Seed must be idempotent: expected 13 BPNR-sourced codes, got %',
      (SELECT count(*) FROM public.tax_object_codes WHERE legal_basis LIKE 'Template Coretax BPNR%');
  END IF;
  IF (SELECT is_active FROM public.tax_object_codes WHERE code = '27-102-03') IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'New codes must be active by default';
  END IF;

  -- Audit trigger: editing a code bumps updated_at.
  SELECT updated_at INTO v_before FROM public.tax_object_codes WHERE code = '27-100-07';
  PERFORM pg_sleep(0.01);
  UPDATE public.tax_object_codes SET description = 'Uji deskripsi' WHERE code = '27-100-07';
  SELECT updated_at INTO v_after FROM public.tax_object_codes WHERE code = '27-100-07';
  IF v_after <= v_before THEN
    RAISE EXCEPTION 'updated_at trigger must bump on update (% -> %)', v_before, v_after;
  END IF;
  UPDATE public.tax_object_codes SET description = NULL WHERE code = '27-100-07';

  -- Client roles still read only; the Kode Objek screen writes via service role.
  IF has_table_privilege('authenticated', 'public.tax_object_codes', 'INSERT')
    OR has_table_privilege('authenticated', 'public.tax_object_codes', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.tax_object_codes', 'DELETE')
    OR has_table_privilege('anon', 'public.tax_object_codes', 'SELECT') THEN
    RAISE EXCEPTION 'Object code writes must stay service-role only';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.tax_object_codes', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role must be able to maintain object codes';
  END IF;
END $$;
SELECT 'PASS: object code reference gains description/legal_basis, audit trigger, and 13 BPNR codes idempotently';
