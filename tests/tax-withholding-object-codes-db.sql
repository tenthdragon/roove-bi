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

-- Export routing after migration 256: a PPh 4(2) slip of a foreign-TIN
-- recipient with a BPNR-listed code belongs to BPNR; the same code for a
-- resident stays in BPPU.
DO $$
DECLARE
  v_alpha UUID := '00000000-0000-4000-8000-000000000101';
  v_entity BIGINT := (SELECT id FROM public.tax_withholding_entities WHERE workspace_id = '00000000-0000-4000-8000-000000000101' ORDER BY id LIMIT 1);
  v_vendor BIGINT := (SELECT id FROM public.tax_counterparties WHERE workspace_id = '00000000-0000-4000-8000-000000000101' ORDER BY id LIMIT 1);
  v_foreign BIGINT;
  v_resident BIGINT;
  v_batch RECORD;
BEGIN
  INSERT INTO public.tax_withholding_slips (
    workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
    period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
    gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
    withholding_amount, total_amount, document_date, withholding_date, status
  ) VALUES
    (v_alpha, v_entity, v_vendor, 'PEMENANG ASING', 'foreign_tin', 'TIN-PRIZE', 11, 2026, DATE '2026-11-05', 'INV-PRIZE-FOREIGN', '28-405-02', 'pph4_2',
     'dpp', 1000000, 1000000, 25, 'object_code', 250000, 1000000, DATE '2026-11-05', DATE '2026-11-05', 'ready'),
    (v_alpha, v_entity, v_vendor, 'PEMENANG LOKAL', 'npwp', '0012345678901234', 11, 2026, DATE '2026-11-05', 'INV-PRIZE-LOCAL', '28-405-02', 'pph4_2',
     'dpp', 1000000, 1000000, 25, 'object_code', 250000, 1000000, DATE '2026-11-05', DATE '2026-11-05', 'ready');
  SELECT id INTO v_resident FROM public.tax_withholding_slips WHERE invoice_number = 'INV-PRIZE-LOCAL';
  SELECT id INTO v_foreign FROM public.tax_withholding_slips WHERE invoice_number = 'INV-PRIZE-FOREIGN';

  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 11, ARRAY[v_foreign], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_foreign),
      'BPPU - EBUPOT - ALPHA - 11 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), NULL);
    RAISE EXCEPTION 'foreign-TIN slip must not enter a BPPU batch';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPNR', 2026, 11, ARRAY[v_resident], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_resident),
      'BPNR - EBUPOT - ALPHA - 11 2026 - ', 'BPNRBulk-v1', '<BPNRBulk/>', repeat('b', 64), NULL);
    RAISE EXCEPTION 'resident slip must not enter a BPNR batch';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  SELECT * INTO v_batch FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPNR', 2026, 11, ARRAY[v_foreign], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_foreign),
    'BPNR - EBUPOT - ALPHA - 11 2026 - ', 'BPNRBulk-v1', '<BPNRBulk>prize</BPNRBulk>', repeat('c', 64), NULL);
  IF v_batch.file_name <> 'BPNR - EBUPOT - ALPHA - 11 2026 - 01.xml' THEN
    RAISE EXCEPTION 'Foreign-TIN PPh 4(2) slip must open the BPNR sequence of its masa: %', v_batch.file_name;
  END IF;
  SELECT * INTO v_batch FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 11, ARRAY[v_resident], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_resident),
    'BPPU - EBUPOT - ALPHA - 11 2026 - ', 'BpuBulk-v3', '<BpuBulk>prize</BpuBulk>', repeat('d', 64), NULL);
  IF v_batch.file_name <> 'BPPU - EBUPOT - ALPHA - 11 2026 - 01.xml' THEN
    RAISE EXCEPTION 'Resident PPh 4(2) slip must stay in BPPU: %', v_batch.file_name;
  END IF;
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE id IN (v_foreign, v_resident) AND status = 'exported') <> 2 THEN
    RAISE EXCEPTION 'Both prize slips must be exported through their own form';
  END IF;
END $$;
SELECT 'PASS: export guard routes foreign-TIN non-resident codes to BPNR and resident slips to BPPU';
