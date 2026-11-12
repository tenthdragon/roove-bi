RESET ROLE;
-- Runs after tax-withholding-coretax-db.sql: alpha's first INV-ALPHA-1 slip is
-- reported (26000ALPHA2), the second is exported again; beta's slip is
-- reported. Payment records hold one kode billing per entity + masa + pasal +
-- KAP/KJS; recording the NTPN moves the group's reported slips to paid and
-- clearing it moves them back unless another record still pays the group.
DO $$
DECLARE
  v_alpha uuid := '00000000-0000-4000-8000-000000000101';
  v_entity bigint := (SELECT id FROM public.tax_withholding_entities WHERE legal_name = 'PT ALPHA');
  v_reported bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'reported');
  v_exported bigint := (SELECT id FROM public.tax_withholding_slips WHERE invoice_number = 'INV-ALPHA-1' AND status = 'exported');
  v_user uuid := '00000000-0000-4000-8000-000000000002';
  v_a bigint;
  v_b bigint;
  v_version timestamptz;
  v_moved int;
  v_lock_key bigint;
BEGIN
  IF v_reported IS NULL OR v_exported IS NULL THEN RAISE EXCEPTION 'Fixture expects one reported and one exported alpha slip'; END IF;
  IF (SELECT kap || '/' || kjs FROM public.tax_object_codes WHERE code = '24-104-24') <> '411124/104' THEN
    RAISE EXCEPTION 'Fixture expects 24-104-24 to carry KAP 411124 / KJS 104';
  END IF;

  -- Formats are enforced by the table.
  BEGIN
    INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount)
    VALUES (v_alpha, v_entity, 10, 2026, 'pph23', '411124', '104', '123', 137);
    RAISE EXCEPTION 'short billing id must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount, ntpn)
    VALUES (v_alpha, v_entity, 10, 2026, 'pph23', '411124', '104', '012345678901234', 137, 'ABCDEFGH12345678');
    RAISE EXCEPTION 'ntpn without paid_at/paid_amount must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The entity must belong to the record's workspace (composite foreign key).
  BEGIN
    INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount)
    VALUES (v_alpha, (SELECT id FROM public.tax_withholding_entities WHERE legal_name = 'PT BETA'), 10, 2026, 'pph23', '411124', '104', '012345678901234', 137);
    RAISE EXCEPTION 'entity of another workspace must be rejected';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount, created_by)
  VALUES (v_alpha, v_entity, 10, 2026, 'pph23', '411124', '104', '012345678901234', 137, v_user) RETURNING id INTO v_a;
  BEGIN
    INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount)
    VALUES (v_alpha, v_entity, 11, 2026, 'pph23', '411124', '104', '012345678901234', 1);
    RAISE EXCEPTION 'one billing id per entity';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.tax_payment_records (workspace_id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount)
  VALUES (v_alpha, v_entity, 10, 2026, 'pph23', '411124', '104', '012345678901235', 50) RETURNING id INTO v_b;
  SELECT updated_at INTO v_version FROM public.tax_payment_records WHERE id = v_a;

  -- NTPN recording: format, stale version, cross-workspace, then the happy path.
  BEGIN
    PERFORM public.tax_record_payment_ntpn(v_alpha, v_a, 'abcdefgh12345678', DATE '2026-11-10', 137, v_version, v_user);
    RAISE EXCEPTION 'lower-case ntpn must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_payment_ntpn(v_alpha, v_a, 'ABCDEFGH12345678', DATE '2026-11-10', 137, now() - interval '1 day', v_user);
    RAISE EXCEPTION 'stale version must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_payment_ntpn('00000000-0000-4000-8000-000000000102', v_a, 'ABCDEFGH12345678', DATE '2026-11-10', 137, v_version, v_user);
    RAISE EXCEPTION 'record of another workspace must be invisible';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_reported) <> 'reported' THEN RAISE EXCEPTION 'Failed calls must not touch slips'; END IF;

  v_moved := public.tax_record_payment_ntpn(v_alpha, v_a, 'ABCDEFGH12345678', DATE '2026-11-10', 137, v_version, v_user);
  IF v_moved <> 1 THEN RAISE EXCEPTION 'Expected 1 slip paid, got %', v_moved; END IF;
  -- The call serialises the whole group through a transaction-level advisory lock.
  SELECT public.tax_payment_group_lock_key(r) INTO v_lock_key FROM public.tax_payment_records r WHERE id = v_a;
  IF v_lock_key <> public.tax_payment_group_lock_key((SELECT r FROM public.tax_payment_records r WHERE id = v_b)) THEN
    RAISE EXCEPTION 'Records of one group must share a lock key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_locks
    WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1 AND granted
      AND classid = ((v_lock_key >> 32) & 4294967295)::oid AND objid = (v_lock_key & 4294967295)::oid
  ) THEN
    RAISE EXCEPTION 'tax_record_payment_ntpn must hold the group advisory lock';
  END IF;
  IF (SELECT status FROM public.tax_withholding_slips WHERE id = v_reported) <> 'paid'
    OR (SELECT status FROM public.tax_withholding_slips WHERE id = v_exported) <> 'exported' THEN
    RAISE EXCEPTION 'Only reported slips of the group move to paid';
  END IF;
  IF (SELECT (ntpn, paid_at, paid_amount, paid_recorded_by) FROM public.tax_payment_records WHERE id = v_a) <> ('ABCDEFGH12345678'::text, DATE '2026-11-10', 137::numeric, v_user) THEN
    RAISE EXCEPTION 'Payment fields must be stored';
  END IF;
  SELECT updated_at INTO v_version FROM public.tax_payment_records WHERE id = v_a;
  BEGIN
    PERFORM public.tax_record_payment_ntpn(v_alpha, v_a, 'ABCDEFGH12345679', DATE '2026-11-10', 137, v_version, v_user);
    RAISE EXCEPTION 'a record with an NTPN cannot take another';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  BEGIN
    PERFORM public.tax_record_payment_ntpn(v_alpha, v_b, 'ABCDEFGH12345678', DATE '2026-11-10', 50, (SELECT updated_at FROM public.tax_payment_records WHERE id = v_b), v_user);
    RAISE EXCEPTION 'an NTPN is unique per entity';
  EXCEPTION WHEN SQLSTATE 'P0004' THEN NULL;
  END;

  -- A second record of the same group: its NTPN finds nothing left to move,
  -- and clearing the first keeps the slips paid while the second still pays.
  v_moved := public.tax_record_payment_ntpn(v_alpha, v_b, 'ABCDEFGH12345679', DATE '2026-11-11', 50, (SELECT updated_at FROM public.tax_payment_records WHERE id = v_b), v_user);
  IF v_moved <> 0 THEN RAISE EXCEPTION 'Already-paid slips must not be counted again'; END IF;
  v_moved := public.tax_clear_payment_ntpn(v_alpha, v_a, v_version);
  IF v_moved <> 0 OR (SELECT status FROM public.tax_withholding_slips WHERE id = v_reported) <> 'paid' THEN
    RAISE EXCEPTION 'Slips stay paid while another record of the group holds an NTPN';
  END IF;
  IF (SELECT ntpn FROM public.tax_payment_records WHERE id = v_a) IS NOT NULL THEN RAISE EXCEPTION 'Cleared record must lose its NTPN'; END IF;
  BEGIN
    PERFORM public.tax_clear_payment_ntpn(v_alpha, v_a, (SELECT updated_at FROM public.tax_payment_records WHERE id = v_a));
    RAISE EXCEPTION 'clearing a record without NTPN must be rejected';
  EXCEPTION WHEN SQLSTATE 'P0003' THEN NULL;
  END;
  v_moved := public.tax_clear_payment_ntpn(v_alpha, v_b, (SELECT updated_at FROM public.tax_payment_records WHERE id = v_b));
  IF v_moved <> 1 OR (SELECT status FROM public.tax_withholding_slips WHERE id = v_reported) <> 'reported' THEN
    RAISE EXCEPTION 'Clearing the last NTPN of a group returns its slips to reported';
  END IF;

  -- Paid slips keep their Coretax number (CHECK on reported/paid).
  v_moved := public.tax_record_payment_ntpn(v_alpha, v_a, 'ABCDEFGH12345678', DATE '2026-11-10', 137, (SELECT updated_at FROM public.tax_payment_records WHERE id = v_a), v_user);
  BEGIN
    UPDATE public.tax_withholding_slips SET coretax_slip_number = NULL WHERE id = v_reported;
    RAISE EXCEPTION 'paid slip without number must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  DELETE FROM public.tax_payment_records WHERE id = v_b;
END $$;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.tax_payment_records', 'SELECT')
    OR has_table_privilege('authenticated', 'public.tax_payment_records', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR NOT has_table_privilege('authenticated', 'public.tax_payment_records', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.tax_payment_records', 'INSERT,UPDATE,DELETE')
    OR has_sequence_privilege('authenticated', 'public.tax_payment_records_id_seq', 'USAGE,SELECT,UPDATE')
    OR NOT has_sequence_privilege('service_role', 'public.tax_payment_records_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'Unexpected payment table grants';
  END IF;
  IF has_function_privilege('authenticated', 'public.tax_payment_group_lock_key(public.tax_payment_records)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.tax_record_payment_ntpn(uuid, bigint, text, date, numeric, timestamptz, uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.tax_record_payment_ntpn(uuid, bigint, text, date, numeric, timestamptz, uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.tax_clear_payment_ntpn(uuid, bigint, timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.tax_clear_payment_ntpn(uuid, bigint, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected payment function grants';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'tax_payment_records' AND cmd = 'SELECT' AND qual LIKE '%workspace_has_tax_access%') <> 1 THEN
    RAISE EXCEPTION 'Payment read policy must use workspace_has_tax_access';
  END IF;
END $$;

CREATE FUNCTION public.tax_payments_visible(p_user uuid) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  RETURN (SELECT count(*) FROM public.tax_payment_records);
END $$;
GRANT EXECUTE ON FUNCTION public.tax_payments_visible(uuid) TO authenticated;

SET ROLE authenticated;
DO $$ BEGIN
  IF public.tax_payments_visible('00000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'platform owner must see alpha payments'; END IF;
  IF public.tax_payments_visible('00000000-0000-4000-8000-000000000002') <> 1 THEN RAISE EXCEPTION 'workspace owner of alpha must see alpha payments'; END IF;
  IF public.tax_payments_visible('00000000-0000-4000-8000-000000000005') <> 0 THEN RAISE EXCEPTION 'staf_finance of beta must see no alpha payments'; END IF;
  IF public.tax_payments_visible('00000000-0000-4000-8000-000000000004') <> 0 THEN RAISE EXCEPTION 'staf_ops must see no payments'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: payment records are formatted, unique per entity, version-checked, move reported slips to paid and back, and are finance-scoped';
