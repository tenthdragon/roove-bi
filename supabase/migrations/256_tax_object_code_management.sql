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

COMMIT;
