-- 256: tax object codes become maintainable from the application.
--
-- 1. `description` holds the scope notes finance needs when classifying a
--    transaction (definitions from PMK 141/2015, the regulation that added the
--    code, exclusions). `legal_basis` names the regulation the code comes from.
-- 2. `updated_at` is maintained by trigger so edits made from the Kode Objek
--    screen are auditable, like the other tax master tables.
-- 3. Thirteen PPh 26 / non-resident codes that the Coretax BPNR template lists
--    but the BPPU seed in migration 247 lacked. Names are the template's REF
--    sheet wording; KAP/KJS follow the sibling codes already seeded.
--
-- 4. The BPNR template also lists PPh 4(2) codes for non-resident recipients
--    (28-405-02, 28-409-08..14), so the export guard routes by pasal OR by the
--    snapshotted foreign TIN instead of by pasal alone, matching
--    exportFormForSlip() in lib/tax-withholding-bpnr.ts. Same signature and
--    grants as migration 255; the 11-argument BPPU wrapper is unchanged.
--
-- Writes keep going through service-role server actions; no client grant changes.
BEGIN;

ALTER TABLE public.tax_object_codes
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS legal_basis TEXT;

DROP TRIGGER IF EXISTS set_updated_at_tax_object_codes ON public.tax_object_codes;
CREATE TRIGGER set_updated_at_tax_object_codes
  BEFORE UPDATE ON public.tax_object_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

INSERT INTO public.tax_object_codes (code, name, pph_article, rate_percent, kap, kjs, legal_basis)
VALUES
  ('27-100-07', 'Penghasilan dari Penjualan/Pengalihan Saham (PPh Pasal 26)', 'pph26', 20, '411127', '100', 'Template Coretax BPNR (REF)'),
  ('27-100-08', 'Penghasilan dari Penjualan/Pengalihan Saham tidak di Bursa Efek (PPh Pasal 26)', 'pph26', 5, '411127', '100', 'Template Coretax BPNR (REF); norma 25% x tarif 20%'),
  ('27-100-09', 'Penjualan atau Pengalihan Saham Perusahaan Antara (Conduit Company atau Special Purpose Company)(PPh Pasal 26)', 'pph26', 5, '411127', '100', 'Template Coretax BPNR (REF); norma 25% x tarif 20%'),
  ('27-102-03', 'Bunga Obligasi (PPh Pasal 26)', 'pph26', 10, '411127', '102', 'Template Coretax BPNR (REF)'),
  ('27-107-01', 'Bunga Pinjaman yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap Melalui Layanan Pinjam Meminjam Uang Berbasis Teknologi Informasi (PPh Pasal 26)', 'pph26', 20, '411127', '107', 'Template Coretax BPNR (REF)'),
  ('28-405-02', 'Hadiah Undian', 'pph4_2', 25, '411128', '405', 'Template Coretax BPNR (REF)'),
  ('28-409-08', 'Jasa Konstruksi Berupa Jasa Perencanaan Konstruksi (Dengan Kualifikasi Usaha)', 'pph4_2', 4, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-09', 'Jasa Konstruksi Berupa Jasa Perencanaan Konstruksi (Tanpa Kualifikasi Usaha)', 'pph4_2', 6, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-10', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Kualifikasi Usaha Kecil)', 'pph4_2', 2, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-11', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Kualifikasi Usaha Menengah dan Besar)', 'pph4_2', 3, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-12', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Tanpa Kualifikasi Usaha)', 'pph4_2', 4, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-13', 'Jasa Konstruksi Berupa Jasa Pengawasan Konstruksi (Dengan Kualifikasi Usaha)', 'pph4_2', 4, '411128', '409', 'Template Coretax BPNR (REF)'),
  ('28-409-14', 'Jasa Konstruksi Berupa Jasa Pengawasan Konstruksi (Tanpa Kualifikasi Usaha)', 'pph4_2', 6, '411128', '409', 'Template Coretax BPNR (REF)')
ON CONFLICT (code) DO NOTHING;

-- Export routing: BPNR takes PPh 26 or foreign-TIN slips, BPPU the rest.
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
      AND (CASE WHEN p_form = 'BPNR'
                THEN pph_article = 'pph26' OR counterparty_identity_type = 'foreign_tin'
                ELSE pph_article <> 'pph26' AND counterparty_identity_type <> 'foreign_tin' END)
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

COMMIT;
