RESET ROLE;
-- Runs after tax-withholding-export-db.sql: alpha's two INV-ALPHA-1 slips sit
-- exported in batch 02 of PT ALPHA; beta has one reported slip (26000BETA1)
-- imported without a batch. Numbers are recorded only through
-- tax_record_coretax_numbers(), which must validate the numbers, lock and
-- version-check the slips, keep numbers unique per entity and mark the slips
-- reported in one transaction.
DO $$
DECLARE
  v_alpha uuid := '00000000-0000-4000-8000-000000000101';
  v_beta uuid := '00000000-0000-4000-8000-000000000102';
  v_entity bigint := (SELECT id FROM public.tax_withholding_entities WHERE legal_name = 'PT ALPHA');
  v_beta_entity bigint := (SELECT id FROM public.tax_withholding_entities WHERE legal_name = 'PT BETA');
  v_ids bigint[] := (SELECT array_agg(id ORDER BY id) FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'exported');
  v_versions timestamptz[] := (SELECT array_agg(updated_at ORDER BY id) FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'exported');
  v_beta_slip bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-BETA-1');
  v_beta_version timestamptz := (SELECT updated_at FROM public.tax_withholding_slips WHERE invoice_number = 'INV-BETA-1');
  v_user uuid := '00000000-0000-4000-8000-000000000002';
  v_count int;
BEGIN
  IF cardinality(v_ids) <> 2 THEN RAISE EXCEPTION 'Fixture expects two exported alpha slips, got %', cardinality(v_ids); END IF;

  -- Malformed input is rejected before any lock is taken.
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA1'], v_versions, false, v_user);
    RAISE EXCEPTION 'array length mismatch must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA1', 'sudah diupload'], v_versions, false, v_user);
    RAISE EXCEPTION 'number with spaces or lower case must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA1', '26000ALPHA1'], v_versions, false, v_user);
    RAISE EXCEPTION 'one number for two slips must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_ids[1], v_ids[1]], ARRAY['26000ALPHA1', '26000ALPHA2'], ARRAY[v_versions[1], v_versions[1]], false, v_user);
    RAISE EXCEPTION 'duplicate slip id must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Another workspace's slip is invisible; a stale version aborts the call.
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_beta_slip], ARRAY['26000ALPHA9'], ARRAY[v_beta_version], true, v_user);
    RAISE EXCEPTION 'slip of another workspace must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA1', '26000ALPHA2'], ARRAY[v_versions[1], now() - interval '1 day'], false, v_user);
    RAISE EXCEPTION 'stale version must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE coretax_slip_number LIKE '26000ALPHA%') <> 0 THEN
    RAISE EXCEPTION 'Failed calls must not record anything';
  END IF;

  -- Happy path: both slips become reported with their numbers and an audit stamp.
  v_count := public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA1', '26000ALPHA2'], v_versions, false, v_user);
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected 2 recorded, got %', v_count; END IF;
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE id = ANY (v_ids) AND status = 'reported' AND coretax_recorded_at IS NOT NULL AND coretax_recorded_by = v_user) <> 2 THEN
    RAISE EXCEPTION 'Recorded slips must be reported with audit columns set';
  END IF;
  IF (SELECT coretax_slip_number FROM public.tax_withholding_slips WHERE id = v_ids[1]) <> '26000ALPHA1'
    OR (SELECT coretax_slip_number FROM public.tax_withholding_slips WHERE id = v_ids[2]) <> '26000ALPHA2' THEN
    RAISE EXCEPTION 'Numbers must follow the id order of the arrays';
  END IF;
  SELECT array_agg(updated_at ORDER BY id) INTO v_versions FROM public.tax_withholding_slips WHERE id = ANY (v_ids);

  -- A reported slip is frozen unless the caller allows replacing its number.
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_ids[1]], ARRAY['26000ALPHA3'], ARRAY[v_versions[1]], false, v_user);
    RAISE EXCEPTION 'replacing without permission must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  -- A number already held by another slip of the same entity is refused.
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_ids[2]], ARRAY['26000ALPHA1'], ARRAY[v_versions[2]], true, v_user);
    RAISE EXCEPTION 'number of another slip must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN NULL;
  END;
  v_count := public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_ids[1]], ARRAY['26000ALPHA3'], ARRAY[v_versions[1]], true, v_user);
  IF (SELECT coretax_slip_number FROM public.tax_withholding_slips WHERE id = v_ids[1]) <> '26000ALPHA3' THEN
    RAISE EXCEPTION 'Replacement with permission must store the new number';
  END IF;
  -- Swapping two numbers in one call is allowed: the old holders are part of the call.
  SELECT array_agg(updated_at ORDER BY id) INTO v_versions FROM public.tax_withholding_slips WHERE id = ANY (v_ids);
  v_count := public.tax_record_coretax_numbers(v_alpha, v_entity, v_ids, ARRAY['26000ALPHA2', '26000ALPHA3'], v_versions, true, v_user);
  IF (SELECT coretax_slip_number FROM public.tax_withholding_slips WHERE id = v_ids[1]) <> '26000ALPHA2' THEN
    RAISE EXCEPTION 'Swap within one call must succeed';
  END IF;

  -- Numbers are unique per entity, so another entity may reuse one; free-text
  -- legacy values stay outside the index.
  v_count := public.tax_record_coretax_numbers(v_beta, v_beta_entity, ARRAY[v_beta_slip], ARRAY['26000ALPHA2'], ARRAY[v_beta_version], true, NULL);
  IF (SELECT coretax_slip_number FROM public.tax_withholding_slips WHERE id = v_beta_slip) <> '26000ALPHA2' THEN
    RAISE EXCEPTION 'Another entity may hold the same number';
  END IF;
  BEGIN
    UPDATE public.tax_withholding_slips SET coretax_slip_number = '26000ALPHA2' WHERE id = v_ids[2];
    RAISE EXCEPTION 'duplicate number within an entity must violate the unique index';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.tax_withholding_slips SET coretax_slip_number = 'SUDAH DIUPLOAD' WHERE id = ANY (v_ids);
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE coretax_slip_number = 'SUDAH DIUPLOAD') <> 2 THEN
    RAISE EXCEPTION 'Legacy free text must not be constrained';
  END IF;
  UPDATE public.tax_withholding_slips SET coretax_slip_number = '26000ALPHA2' WHERE id = v_ids[1];
  UPDATE public.tax_withholding_slips SET coretax_slip_number = '26000ALPHA3' WHERE id = v_ids[2];

  -- Clearing a number returns the slip to exported; the batch keeps it valid.
  UPDATE public.tax_withholding_slips
    SET coretax_slip_number = NULL, status = 'exported', coretax_recorded_at = NULL, coretax_recorded_by = NULL
    WHERE id = v_ids[2] AND status = 'reported' AND export_batch_id IS NOT NULL;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_ids[2]) <> 'exported' THEN
    RAISE EXCEPTION 'Cleared slip must be exported again';
  END IF;
  -- A reported slip can never lose its number while staying reported.
  BEGIN
    UPDATE public.tax_withholding_slips SET coretax_slip_number = NULL WHERE id = v_ids[1];
    RAISE EXCEPTION 'reported slip without number must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- An inactive entity cannot record.
  UPDATE public.tax_withholding_entities SET is_active = false WHERE id = v_entity;
  BEGIN
    PERFORM public.tax_record_coretax_numbers(v_alpha, v_entity, ARRAY[v_ids[2]], ARRAY['26000ALPHA4'], (SELECT ARRAY[updated_at] FROM public.tax_withholding_slips WHERE id = v_ids[2]), false, v_user);
    RAISE EXCEPTION 'inactive entity must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  UPDATE public.tax_withholding_entities SET is_active = true WHERE id = v_entity;
END $$;

DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.tax_record_coretax_numbers(uuid, bigint, bigint[], text[], timestamptz[], boolean, uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.tax_record_coretax_numbers(uuid, bigint, bigint[], text[], timestamptz[], boolean, uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.tax_record_coretax_numbers(uuid, bigint, bigint[], text[], timestamptz[], boolean, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected Coretax function grants';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_tax_withholding_slips_coretax_number') NOT LIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'Coretax number index must be unique';
  END IF;
END $$;
SELECT 'PASS: Coretax numbers are validated, version-checked, unique per entity, and move slips to reported atomically';
