-- ============================================================================
-- 255: Export batches per formulir — BPPU (residen) dan BPNR (PPh 26, fase 5b)
-- ============================================================================
-- Coretax takes non-resident bukti potong (PPh 26) through a separate upload,
-- BPNR, with its own XML schema. A batch therefore records which form it is,
-- batch numbers run per entity + masa + form (so the first BPNR file of a masa
-- is "- 01" regardless of BPPU batches), and tax_create_export_batch() refuses
-- a mix: a BPNR batch holds only PPh 26 slips, a BPPU batch none.
-- ============================================================================

BEGIN;

ALTER TABLE public.tax_export_batches
  ADD COLUMN IF NOT EXISTS form TEXT NOT NULL DEFAULT 'BPPU';

DO $$
DECLARE
  v_old TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_export_batches_form_check') THEN
    ALTER TABLE public.tax_export_batches
      ADD CONSTRAINT tax_export_batches_form_check CHECK (form IN ('BPPU', 'BPNR'));
  END IF;
  -- The original unique key (workspace, entity, year, month, sequence) carries a
  -- name PostgreSQL truncated; find it by its columns rather than by name.
  SELECT conname INTO v_old
  FROM pg_constraint
  WHERE conrelid = 'public.tax_export_batches'::regclass
    AND contype = 'u'
    AND conname <> 'tax_export_batches_form_sequence_key'
    AND (SELECT array_agg(attname ORDER BY ordinality)
         FROM unnest(conkey) WITH ORDINALITY AS k(attnum, ordinality)
         JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.attnum)
        = ARRAY['workspace_id', 'entity_id', 'period_year', 'period_month', 'sequence']::name[];
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_export_batches_form_sequence_key') THEN
    ALTER TABLE public.tax_export_batches
      ADD CONSTRAINT tax_export_batches_form_sequence_key
      UNIQUE (workspace_id, entity_id, form, period_year, period_month, sequence);
  END IF;
  IF v_old IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tax_export_batches DROP CONSTRAINT %I', v_old);
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_tax_export_batches_period;
CREATE INDEX IF NOT EXISTS idx_tax_export_batches_form_period
  ON public.tax_export_batches (workspace_id, entity_id, form, period_year, period_month, sequence);

-- Same contract as before plus p_form. Under the lock a slip only counts when
-- its pasal matches the form, so a mismatched id fails the batch with P0003
-- like any other slip that is no longer eligible.
DROP FUNCTION IF EXISTS public.tax_create_export_batch(UUID, BIGINT, INT, INT, BIGINT[], TIMESTAMPTZ[], TEXT, TEXT, TEXT, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.tax_create_export_batch(
  p_workspace_id UUID,
  p_entity_id BIGINT,
  p_form TEXT,
  p_period_year INT,
  p_period_month INT,
  p_slip_ids BIGINT[],
  p_slip_versions TIMESTAMPTZ[],
  p_file_name_prefix TEXT,
  p_schema_version TEXT,
  p_xml_content TEXT,
  p_xml_sha256 TEXT,
  p_created_by UUID
)
RETURNS TABLE (batch_id BIGINT, sequence SMALLINT, file_name TEXT)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids BIGINT[] := (SELECT array_agg(DISTINCT id) FROM unnest(p_slip_ids) AS id);
  v_count INT;
  v_current INT;
  v_gross NUMERIC(20, 6);
  v_withholding NUMERIC(18, 0);
  v_sequence SMALLINT;
  v_batch_id BIGINT;
  v_file_name TEXT;
BEGIN
  IF p_form IS NULL OR p_form NOT IN ('BPPU', 'BPNR') THEN
    RAISE EXCEPTION 'Formulir export harus BPPU atau BPNR.' USING ERRCODE = '22023';
  END IF;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Tidak ada bukti potong untuk di-export.' USING ERRCODE = '22023';
  END IF;
  IF p_slip_versions IS NULL OR cardinality(p_slip_versions) <> cardinality(p_slip_ids) THEN
    RAISE EXCEPTION 'Versi bukti potong harus dikirim untuk setiap id.' USING ERRCODE = '22023';
  END IF;
  IF p_period_month NOT BETWEEN 1 AND 12 OR p_period_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Masa pajak tidak valid.' USING ERRCODE = '22023';
  END IF;

  -- Serialise exports per entity so the sequence number is unique and slips
  -- cannot be claimed by two batches.
  PERFORM 1 FROM public.tax_withholding_entities
    WHERE id = p_entity_id AND workspace_id = p_workspace_id AND is_active
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemotong tidak ditemukan atau nonaktif.' USING ERRCODE = 'P0002';
  END IF;

  -- Lock the rows first, then compare them with the versions the caller saw.
  SELECT count(*), coalesce(sum(s.gross_amount), 0), coalesce(sum(s.withholding_amount), 0),
         count(*) FILTER (WHERE s.updated_at = v.version)
    INTO v_count, v_gross, v_withholding, v_current
  FROM (
    SELECT id, gross_amount, withholding_amount, updated_at
    FROM public.tax_withholding_slips
    WHERE id = ANY (v_ids)
      AND workspace_id = p_workspace_id
      AND entity_id = p_entity_id
      AND period_year = p_period_year
      AND period_month = p_period_month
      AND status = 'ready'
      AND export_batch_id IS NULL
      AND ((pph_article = 'pph26') = (p_form = 'BPNR'))
    FOR UPDATE
  ) s
  JOIN (SELECT DISTINCT ON (id) id, version FROM unnest(p_slip_ids, p_slip_versions) AS u(id, version)) v ON v.id = s.id;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Sebagian bukti potong sudah berubah atau bukan status siap (% dari % cocok); muat ulang pratinjau.', v_count, cardinality(v_ids)
      USING ERRCODE = 'P0003';
  END IF;
  IF v_current <> v_count THEN
    RAISE EXCEPTION 'Sebagian bukti potong diubah setelah pratinjau (% dari % masih sama); muat ulang pratinjau.', v_current, v_count
      USING ERRCODE = 'P0003';
  END IF;

  SELECT coalesce(max(b.sequence), 0) + 1 INTO v_sequence
  FROM public.tax_export_batches b
  WHERE b.workspace_id = p_workspace_id AND b.entity_id = p_entity_id AND b.form = p_form
    AND b.period_year = p_period_year AND b.period_month = p_period_month;
  v_file_name := p_file_name_prefix || lpad(v_sequence::text, 2, '0') || '.xml';

  INSERT INTO public.tax_export_batches (
    workspace_id, entity_id, form, period_month, period_year, sequence, file_name, schema_version,
    slip_count, total_gross, total_withholding, xml_sha256, xml_content, created_by
  ) VALUES (
    p_workspace_id, p_entity_id, p_form, p_period_month, p_period_year, v_sequence, v_file_name, p_schema_version,
    v_count, v_gross, v_withholding, p_xml_sha256, p_xml_content, p_created_by
  ) RETURNING id INTO v_batch_id;

  UPDATE public.tax_withholding_slips
    SET status = 'exported', export_batch_id = v_batch_id
    WHERE id = ANY (v_ids);

  RETURN QUERY SELECT v_batch_id, v_sequence, v_file_name;
END $$;

REVOKE ALL ON FUNCTION public.tax_create_export_batch(UUID, BIGINT, TEXT, INT, INT, BIGINT[], TIMESTAMPTZ[], TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tax_create_export_batch(UUID, BIGINT, TEXT, INT, INT, BIGINT[], TIMESTAMPTZ[], TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

COMMIT;
