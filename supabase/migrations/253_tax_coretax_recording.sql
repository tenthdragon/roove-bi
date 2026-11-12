-- ============================================================================
-- 253: Pencatatan nomor bukti potong Coretax (fase 4)
-- ============================================================================
-- After a BPPU file is uploaded, Coretax assigns each bukti potong a number
-- (nine upper-case alphanumerics so far, e.g. 26000UK7L). Recording it moves
-- the slip from `exported` to `reported`. The number identifies one bukti
-- potong per withholding entity, so it is unique per entity among values that
-- look like a Coretax number; legacy imports hold free text ("SUDAH DIUPLOAD",
-- two numbers in one cell) that stays outside the index until corrected.
--
-- tax_record_coretax_numbers() records a list of numbers in one transaction,
-- re-checking under the lock that each slip is still exported (or reported,
-- when the caller explicitly allows replacing a number) and unchanged since
-- the caller read it. Writes go through service-role server actions only.
-- ============================================================================

BEGIN;

ALTER TABLE public.tax_withholding_slips
  ADD COLUMN IF NOT EXISTS coretax_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coretax_recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Refuse to proceed while two slips of one entity share a Coretax-looking
-- number: that is a data error to resolve by hand, not something to hide.
DO $$
DECLARE v_conflicts TEXT;
BEGIN
  SELECT string_agg(format('%s (%s bukti potong)', coretax_slip_number, n), ', ')
    INTO v_conflicts
  FROM (
    SELECT workspace_id, entity_id, coretax_slip_number, count(*) AS n
    FROM public.tax_withholding_slips
    WHERE coretax_slip_number ~ '^[0-9A-Z]+$'
    GROUP BY workspace_id, entity_id, coretax_slip_number
    HAVING count(*) > 1
  ) d;
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting Coretax slip numbers: %', v_conflicts;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_withholding_slips_coretax_number
  ON public.tax_withholding_slips (workspace_id, entity_id, coretax_slip_number)
  WHERE coretax_slip_number ~ '^[0-9A-Z]+$';

-- Records Coretax numbers for exported slips of one entity and marks them
-- reported. Every id carries the updated_at the caller saw; a slip edited in
-- between (voided, re-exported) aborts the whole call. With p_allow_replace the
-- caller may overwrite the number of a reported slip (typo correction); paid
-- slips are never touched.
CREATE OR REPLACE FUNCTION public.tax_record_coretax_numbers(
  p_workspace_id UUID,
  p_entity_id BIGINT,
  p_slip_ids BIGINT[],
  p_numbers TEXT[],
  p_versions TIMESTAMPTZ[],
  p_allow_replace BOOLEAN,
  p_recorded_by UUID
)
RETURNS INT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INT := cardinality(p_slip_ids);
  v_count INT;
  v_current INT;
  v_bad TEXT;
  v_used TEXT;
BEGIN
  IF p_slip_ids IS NULL OR v_total = 0 THEN
    RAISE EXCEPTION 'Tidak ada bukti potong untuk dicatat.' USING ERRCODE = '22023';
  END IF;
  IF p_numbers IS NULL OR cardinality(p_numbers) <> v_total OR p_versions IS NULL OR cardinality(p_versions) <> v_total THEN
    RAISE EXCEPTION 'Nomor dan versi harus dikirim untuk setiap bukti potong.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(p_slip_ids) AS id) <> v_total THEN
    RAISE EXCEPTION 'Bukti potong yang sama dikirim lebih dari sekali.' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(coalesce(n, '(kosong)'), ', ') INTO v_bad
  FROM unnest(p_numbers) AS n
  WHERE n IS NULL OR n !~ '^[0-9A-Z]{6,20}$' OR n !~ '[0-9]';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Nomor bukti potong tidak valid: %', v_bad USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT n) FROM unnest(p_numbers) AS n) <> v_total THEN
    RAISE EXCEPTION 'Nomor bukti potong yang sama diberikan ke beberapa bukti potong.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.tax_withholding_entities
    WHERE id = p_entity_id AND workspace_id = p_workspace_id AND is_active
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemotong tidak ditemukan atau nonaktif.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE s.updated_at = v.version)
    INTO v_count, v_current
  FROM (
    SELECT id, updated_at
    FROM public.tax_withholding_slips
    WHERE id = ANY (p_slip_ids)
      AND workspace_id = p_workspace_id
      AND entity_id = p_entity_id
      AND (status = 'exported' OR (p_allow_replace AND status = 'reported'))
    FOR UPDATE
  ) s
  JOIN unnest(p_slip_ids, p_versions) AS v(id, version) ON v.id = s.id;
  IF v_count <> v_total THEN
    RAISE EXCEPTION 'Sebagian bukti potong bukan status di-export (% dari % cocok); muat ulang.', v_count, v_total
      USING ERRCODE = 'P0003';
  END IF;
  IF v_current <> v_count THEN
    RAISE EXCEPTION 'Sebagian bukti potong berubah sejak dibaca (% dari % masih sama); muat ulang.', v_current, v_count
      USING ERRCODE = 'P0003';
  END IF;

  SELECT string_agg(coretax_slip_number, ', ') INTO v_used
  FROM public.tax_withholding_slips
  WHERE workspace_id = p_workspace_id
    AND entity_id = p_entity_id
    AND coretax_slip_number = ANY (p_numbers)
    AND NOT (id = ANY (p_slip_ids));
  IF v_used IS NOT NULL THEN
    RAISE EXCEPTION 'Nomor bukti potong sudah dipakai bukti potong lain: %', v_used USING ERRCODE = 'P0004';
  END IF;

  -- Two steps so numbers can be swapped between slips of one call: the unique
  -- index ignores the '~'-prefixed placeholders written first.
  UPDATE public.tax_withholding_slips s
    SET coretax_slip_number = '~' || v.number
  FROM unnest(p_slip_ids, p_numbers) AS v(id, number)
  WHERE s.id = v.id;
  UPDATE public.tax_withholding_slips s
    SET coretax_slip_number = v.number,
        status = 'reported',
        coretax_recorded_at = now(),
        coretax_recorded_by = p_recorded_by
  FROM unnest(p_slip_ids, p_numbers) AS v(id, number)
  WHERE s.id = v.id;

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.tax_record_coretax_numbers(UUID, BIGINT, BIGINT[], TEXT[], TIMESTAMPTZ[], BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tax_record_coretax_numbers(UUID, BIGINT, BIGINT[], TEXT[], TIMESTAMPTZ[], BOOLEAN, UUID) TO service_role;

COMMIT;
