RESET ROLE;
-- Runs after tax-withholding-slips-db.sql. Alpha has two lines of INV-ALPHA-1
-- (one ready, one draft by default); beta has one reported slip.
-- Batches are created only through tax_create_export_batch(), which must move
-- exactly the requested ready slips to `exported`, number batches per masa, and
-- refuse slips that are not ready, already batched, or outside the masa.
DO $$
DECLARE
  v_alpha uuid := '00000000-0000-4000-8000-000000000101';
  v_beta uuid := '00000000-0000-4000-8000-000000000102';
  v_entity bigint := (SELECT id FROM public.tax_withholding_entities WHERE legal_name = 'PT ALPHA');
  v_ready bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'ready');
  v_draft bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'draft');
  v_beta_slip bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-BETA-1');
  v_batch record;
  v_second record;
  v_bpnr bigint;
  v_stale timestamptz := now() - interval '1 day';
BEGIN
  IF v_ready IS NULL OR v_draft IS NULL THEN RAISE EXCEPTION 'Fixture slips missing'; END IF;

  -- A draft slip cannot be exported, and the whole call fails (no partial batch).
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready, v_draft], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready, v_draft]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), '00000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'draft slip must block the batch';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.tax_export_batches) <> 0 THEN RAISE EXCEPTION 'Failed batch must not be stored'; END IF;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_ready) <> 'ready' THEN RAISE EXCEPTION 'Failed batch must not touch slips'; END IF;

  -- Another workspace's slip is invisible to the function.
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_beta_slip], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_beta_slip]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), NULL);
    RAISE EXCEPTION 'slip of another workspace must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  -- Wrong masa is rejected even for a ready slip.
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 11, ARRAY[v_ready], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
      'BPPU - EBUPOT - ALPHA - 11 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), NULL);
    RAISE EXCEPTION 'slip outside the masa must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  -- A slip edited after preview (updated_at moved) is rejected even though it is still ready.
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready], ARRAY[v_stale],
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), NULL);
    RAISE EXCEPTION 'stale slip version must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready], ARRAY[]::timestamptz[],
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('a', 64), NULL);
    RAISE EXCEPTION 'missing versions must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Happy path: one ready slip, duplicate ids collapse, sequence 01.
  SELECT * INTO v_batch FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready, v_ready], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready, v_ready]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
    'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk>1</BpuBulk>', repeat('a', 64), '00000000-0000-4000-8000-000000000002');
  IF v_batch.sequence <> 1 OR v_batch.file_name <> 'BPPU - EBUPOT - ALPHA - 10 2026 - 01.xml' THEN
    RAISE EXCEPTION 'First batch must be sequence 01: % %', v_batch.sequence, v_batch.file_name;
  END IF;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_ready) <> 'exported'
    OR (SELECT export_batch_id FROM public.tax_withholding_slips WHERE id = v_ready) <> v_batch.batch_id THEN
    RAISE EXCEPTION 'Exported slip must point at its batch';
  END IF;
  IF (SELECT (slip_count, total_gross, total_withholding) FROM public.tax_export_batches WHERE id = v_batch.batch_id) <> (1, 6846.846847::numeric, 137::numeric) THEN
    RAISE EXCEPTION 'Batch totals must come from the locked slips';
  END IF;

  -- The same slip cannot enter a second batch.
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('b', 64), NULL);
    RAISE EXCEPTION 'exported slip must not be batched again';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;

  -- Exported slips are frozen for ordinary edits by the status checks: status
  -- `exported` without a batch, or a batch on a draft slip, are both impossible.
  BEGIN
    UPDATE public.tax_withholding_slips SET export_batch_id = NULL WHERE id = v_ready;
    RAISE EXCEPTION 'exported slip without batch must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.tax_withholding_slips SET export_batch_id = v_batch.batch_id WHERE id = v_draft;
    RAISE EXCEPTION 'draft slip with batch must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Void: back to draft, batch pointer moves to voided_from_batch_id; the batch row is untouched.
  UPDATE public.tax_withholding_slips
    SET status = 'draft', export_batch_id = NULL, voided_from_batch_id = v_batch.batch_id, void_reason = 'DPP salah'
    WHERE id = v_ready AND status = 'exported';
  IF (SELECT slip_count FROM public.tax_export_batches WHERE id = v_batch.batch_id) <> 1 THEN RAISE EXCEPTION 'Batch must stay immutable'; END IF;
  BEGIN
    DELETE FROM public.tax_export_batches WHERE id = v_batch.batch_id;
    RAISE EXCEPTION 'batch referenced by a voided slip must not be deletable';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- The corrected slip joins the next batch as sequence 02.
  UPDATE public.tax_withholding_slips SET status = 'ready' WHERE id IN (v_ready, v_draft);
  SELECT * INTO v_second FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready, v_draft], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready, v_draft]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
    'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk>2</BpuBulk>', repeat('c', 64), NULL);
  IF v_second.sequence <> 2 OR v_second.file_name <> 'BPPU - EBUPOT - ALPHA - 10 2026 - 02.xml' THEN
    RAISE EXCEPTION 'Second batch must be sequence 02';
  END IF;
  IF (SELECT count(*) FROM public.tax_withholding_slips WHERE export_batch_id = v_second.batch_id AND status = 'exported') <> 2 THEN
    RAISE EXCEPTION 'Both slips must be in the second batch';
  END IF;
  IF (SELECT voided_from_batch_id FROM public.tax_withholding_slips WHERE id = v_ready) <> v_batch.batch_id THEN
    RAISE EXCEPTION 'Void history must survive re-export';
  END IF;

  -- An inactive entity cannot export.
  UPDATE public.tax_withholding_entities SET is_active = false WHERE id = v_entity;
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_ready], (SELECT array_agg(updated_at ORDER BY i) FROM unnest(ARRAY[v_ready]) WITH ORDINALITY AS u(id, i) JOIN public.tax_withholding_slips s ON s.id = u.id),
      'x - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('d', 64), NULL);
    RAISE EXCEPTION 'inactive entity must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  UPDATE public.tax_withholding_entities SET is_active = true WHERE id = v_entity;

  -- Phase 5b: BPNR batches are numbered apart from BPPU and hold only PPh 26
  -- slips; a BPPU batch refuses PPh 26 and the form itself is validated.
  INSERT INTO public.tax_withholding_slips (
    workspace_id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number,
    period_month, period_year, invoice_date, invoice_number, object_code, pph_article,
    gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source,
    withholding_amount, total_amount, document_date, withholding_date, status
  ) VALUES (v_alpha, v_entity, 1, 'VENDOR ASING', 'foreign_tin', 'TIN-ALPHA-26',
    10, 2026, DATE '2026-10-21', 'INV-ALPHA-26', '27-104-01', 'pph26',
    'dpp', 500000, 500000, 20, 'object_code', 100000, 500000, DATE '2026-10-21', DATE '2026-10-21', 'ready')
  RETURNING id INTO v_bpnr;
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'XYZ', 2026, 10, ARRAY[v_bpnr], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_bpnr),
      'x - ', 'BPNRBulk-v1', '<BPNRBulk/>', repeat('e', 64), NULL);
    RAISE EXCEPTION 'unknown form must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPPU', 2026, 10, ARRAY[v_bpnr], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_bpnr),
      'BPPU - EBUPOT - ALPHA - 10 2026 - ', 'BpuBulk-v3', '<BpuBulk/>', repeat('e', 64), NULL);
    RAISE EXCEPTION 'PPh 26 slip must not enter a BPPU batch';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_bpnr) <> 'ready' THEN RAISE EXCEPTION 'Refused BPPU batch must not touch the PPh 26 slip'; END IF;
  SELECT * INTO v_batch FROM public.tax_create_export_batch(v_alpha, v_entity, 'BPNR', 2026, 10, ARRAY[v_bpnr], (SELECT array_agg(updated_at) FROM public.tax_withholding_slips WHERE id = v_bpnr),
    'BPNR - EBUPOT - ALPHA - 10 2026 - ', 'BPNRBulk-v1', '<BPNRBulk>1</BPNRBulk>', repeat('f', 64), NULL);
  IF v_batch.sequence <> 1 OR v_batch.file_name <> 'BPNR - EBUPOT - ALPHA - 10 2026 - 01.xml' THEN
    RAISE EXCEPTION 'First BPNR batch must be sequence 01 even after two BPPU batches: % %', v_batch.sequence, v_batch.file_name;
  END IF;
  IF (SELECT (form, schema_version, slip_count, total_withholding) FROM public.tax_export_batches WHERE id = v_batch.batch_id) <> ('BPNR'::text, 'BPNRBulk-v1'::text, 1, 100000::numeric) THEN
    RAISE EXCEPTION 'BPNR batch must record its form';
  END IF;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_bpnr) <> 'exported' THEN RAISE EXCEPTION 'BPNR slip must be exported'; END IF;
  IF (SELECT count(*) FROM public.tax_export_batches WHERE entity_id = v_entity AND period_month = 10 AND sequence = 1) <> 2 THEN
    RAISE EXCEPTION 'BPPU and BPNR each own sequence 01 of the masa';
  END IF;
  BEGIN
    INSERT INTO public.tax_export_batches (workspace_id, entity_id, form, period_month, period_year, sequence, file_name, schema_version, slip_count, total_gross, total_withholding, xml_sha256, xml_content)
    VALUES (v_alpha, v_entity, 'BPNR', 10, 2026, 1, 'dup.xml', 'BPNRBulk-v1', 1, 1, 1, repeat('0', 64), '<x/>');
    RAISE EXCEPTION 'duplicate sequence within a form must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.tax_export_batches SET form = 'SPT' WHERE id = v_batch.batch_id;
    RAISE EXCEPTION 'unknown form value must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Grants: batches readable by finance scope only, writable by service role; the
-- function is callable by service role only.
DO $$ BEGIN
  IF has_table_privilege('anon', 'public.tax_export_batches', 'SELECT')
    OR has_table_privilege('authenticated', 'public.tax_export_batches', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR NOT has_table_privilege('authenticated', 'public.tax_export_batches', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.tax_export_batches', 'INSERT,UPDATE,DELETE')
    OR has_sequence_privilege('authenticated', 'public.tax_export_batches_id_seq', 'USAGE,SELECT,UPDATE')
    OR NOT has_sequence_privilege('service_role', 'public.tax_export_batches_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'Unexpected batch grants';
  END IF;
  IF has_function_privilege('authenticated', 'public.tax_create_export_batch(uuid, bigint, text, int, int, bigint[], timestamptz[], text, text, text, text, uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.tax_create_export_batch(uuid, bigint, text, int, int, bigint[], timestamptz[], text, text, text, text, uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.tax_create_export_batch(uuid, bigint, text, int, int, bigint[], timestamptz[], text, text, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected batch function grants';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'tax_export_batches' AND cmd = 'SELECT' AND qual LIKE '%workspace_has_tax_access%') <> 1 THEN
    RAISE EXCEPTION 'Batch read policy must use workspace_has_tax_access';
  END IF;
END $$;

CREATE FUNCTION public.tax_batches_visible(p_user uuid) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  RETURN (SELECT count(*) FROM public.tax_export_batches);
END $$;
GRANT EXECUTE ON FUNCTION public.tax_batches_visible(uuid) TO authenticated;

SET ROLE authenticated;
DO $$ BEGIN
  IF public.tax_batches_visible('00000000-0000-4000-8000-000000000001') <> 3 THEN RAISE EXCEPTION 'platform owner must see alpha batches'; END IF;
  IF public.tax_batches_visible('00000000-0000-4000-8000-000000000002') <> 3 THEN RAISE EXCEPTION 'workspace owner of alpha must see alpha batches'; END IF;
  IF public.tax_batches_visible('00000000-0000-4000-8000-000000000005') <> 0 THEN RAISE EXCEPTION 'staf_finance of beta must see no alpha batches'; END IF;
  IF public.tax_batches_visible('00000000-0000-4000-8000-000000000004') <> 0 THEN RAISE EXCEPTION 'staf_ops must see no batches'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: export batches are atomic, sequenced per masa and form, immutable, void-aware, article-guarded, and finance-scoped';
