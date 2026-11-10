-- ============================================================================
-- 247: Bukti Potong PPh (Coretax BPPU) — fase 1
-- ============================================================================
-- Master data for withholding-tax slips: withholding entities per business,
-- counterparties with facility history, and the global tax object-code
-- reference. Slips, export batches and payment records follow in later phases.
-- All writes go through server actions (service role); authenticated users
-- only read rows of workspaces they can access.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Reference: tax object codes (global, seeded from Coretax BPPU template v.3
-- plus legacy e-Bupot reference for KAP/KJS and PPh 26 codes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_object_codes (
  code TEXT PRIMARY KEY CHECK (code ~ '^[0-9]{2}-[0-9]{3}-[0-9]{2}$'),
  name TEXT NOT NULL,
  pph_article TEXT NOT NULL
    CHECK (pph_article IN ('pph22', 'pph23', 'pph4_2', 'pph15', 'pph26')),
  rate_percent NUMERIC(6, 3) NOT NULL CHECK (rate_percent >= 0),
  kap TEXT CHECK (kap IS NULL OR kap ~ '^[0-9]{6}$'),
  kjs TEXT CHECK (kjs IS NULL OR kjs ~ '^[0-9]{3}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tax_object_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_object_codes FROM PUBLIC, anon;
GRANT SELECT ON public.tax_object_codes TO authenticated;
GRANT ALL ON public.tax_object_codes TO service_role;

DROP POLICY IF EXISTS tax_object_codes_read ON public.tax_object_codes;
CREATE POLICY tax_object_codes_read ON public.tax_object_codes
  FOR SELECT TO authenticated USING (TRUE);

INSERT INTO public.tax_object_codes (code, name, pph_article, rate_percent, kap, kjs)
VALUES
  ('22-100-07', 'Penjualan Hasil Produksi Kepada Distributor di Dalam Negeri oleh Badan Usaha/Industri Tertentu (Industri Semen)', 'pph22', 0.25, '411122', '100'),
  ('22-100-08', 'Penjualan Hasil Produksi Kepada Distributor di Dalam Negeri oleh Badan Usaha/Industri Tertentu (Industri Baja)', 'pph22', 0.3, '411122', '100'),
  ('22-100-09', 'Penjualan Hasil Produksi Kepada Distributor di Dalam Negeri oleh Badan Usaha/Industri Tertentu (Industri Otomotif)', 'pph22', 0.45, '411122', '100'),
  ('22-100-10', 'Penjualan Hasil Produksi Kepada Distributor di Dalam Negeri oleh Badan Usaha/Industri Tertentu (Industri Farmasi)', 'pph22', 0.3, '411122', '100'),
  ('22-100-11', 'Penjualan Hasil Produksi Kepada Distributor di Dalam Negeri oleh Badan Usaha/Industri Tertentu (industri Kertas)', 'pph22', 0.1, '411122', '100'),
  ('22-100-12', 'Penjualan Kendaraan Bermotor di Dalam Negeri oleh ATPM, APM dan Importir Umum Kendaraan Bermotor', 'pph22', 0.45, '411122', '100'),
  ('22-100-13', 'Pembelian oleh Badan Usaha Berupa Komoditas Tambang Batubara, Mineral Logam dan Mineral Bukan Logam dari Badan atau Orang Pribadi Pemegang IUP', 'pph22', 1.5, '411122', '100'),
  ('22-100-14', 'Penjualan Emas Batangan di Dalam Negeri oleh Badan Usaha', 'pph22', 0.45, '411122', '100'),
  ('22-100-15', 'Pembelian Bahan Hasil Kehutanan yang Belum Melalui Proses Industri Manufaktur, untuk Keperluan Industrinya/Ekspornya oleh Badan Usaha Industri/Eksportir', 'pph22', 0.25, '411122', '100'),
  ('22-100-16', 'Pembelian Bahan Hasil Perkebunan yang Belum Melalui Proses Industri Manufaktur, untuk Keperluan Industrinya/Ekspornya Oleh Badan Usaha Industri/Eksportir', 'pph22', 0.25, '411122', '100'),
  ('22-100-17', 'Pembelian Bahan Hasil Pertanian yang Belum Melalui Proses Industri Manufaktur, untuk Keperluan Industrinya/Ekspornya Oleh Badan Usaha Industri/Eksportir', 'pph22', 0.25, '411122', '100'),
  ('22-100-18', 'Pembelian Bahan Hasil Peternakan yang Belum Melalui Proses Industri Manufaktur, untuk Keperluan Industrinya/Ekspornya Oleh Badan Usaha Industri/Eksportir', 'pph22', 0.25, '411122', '100'),
  ('22-100-19', 'Pembelian Bahan Hasil Perikanan yang Belum Melalui Proses Industri Manufaktur, untuk Keperluan Industrinya/Ekspornya Oleh Badan Usaha Industri/Eksportir', 'pph22', 0.25, '411122', '100'),
  ('22-100-20', 'Penjualan BBM oleh Pertamina atau Anak Perusahaan Pertamina Kepada Selain SPBU/Agen/Penyalur (Tidak Final)', 'pph22', 0.3, '411122', '100'),
  ('22-100-21', 'Penjualan BBM oleh Badan Usaha Selain Pertamina atau Anak Perusahaan Pertamina Kepada Selain SPBU/Agen/Penyalur (Tidak Final)', 'pph22', 0.3, '411122', '100'),
  ('22-100-22', 'Penjualan Pelumas oleh Importir/Produsen', 'pph22', 0.3, '411122', '100'),
  ('22-100-23', 'Penjualan Pulsa dan Kartu Perdana oleh Penyelenggara Distribusi Tingkat Kedua yang Merupakan Pemungut PPh Pasal 22', 'pph22', 0.5, '411122', '100'),
  ('22-100-24', 'Penjualan BBG oleh Produsen/Importir Kepada Selain SPBU/Agen/Penyalur (Tidak Final)', 'pph22', 0.3, '411122', '100'),
  ('22-100-25', 'Penjualan Emas Batangan di Dalam Negeri oleh Pengusaha Emas Perhiasan dan/atau Emas Batangan', 'pph22', 0.25, '411122', '100'),
  ('22-100-26', 'Penjualan Emas Perhiasan di Dalam Negeri oleh Pengusaha Emas Perhiasan dan/atau Emas Batangan', 'pph22', 0.25, '411122', '100'),
  ('22-100-27', 'Penjualan Perhiasan Selain dari Emas dan/atau Batu Permata dan/atau Batu Lainnya yang Sejenis oleh Pengusaha Emas Perhiasan dan/atau Emas Batangan', 'pph22', 0.25, '411122', '100'),
  ('22-100-28', 'Pembelian emas batangan oleh Lembaga Jasa Keuangan penyelenggara Kegiatan Usaha Bulion', 'pph22', 0.25, '411122', '100'),
  ('22-101-01', 'Penghasilan Sehubungan dengan Transaksi Penjualan Barang, Penyerahan Jasa, dan/atau Persewaan serta Penghasilan Lain Sehubungan dengan Penggunaan Harta yang Dilakukan Melalui Pihak Lain dalam Sistem Informasi Pengadaan Pemerintah (Tidak Final)', 'pph22', 0.5, '411122', '101'),
  ('22-101-02', 'Penghasilan Sehubungan dengan Transaksi Penjualan Barang, Penyerahan Jasa, dan/atau Persewaan serta Penghasilan Lain Sehubungan dengan Penggunaan Harta yang Dilakukan Melalui Pihak Lain dalam Sistem Informasi Pengadaan Pemerintah (Final)', 'pph22', 0.5, '411122', '101'),
  ('22-102-01', 'Penghasilan yang Diterima atau Diperoleh Pedagang Dalam Negeri Penjualan Barang, Penyerahan Jasa, dan/atau Persewaan serta Penghasilan Lain Sehubungan dengan Penggunaan Harta yang Dilakukan Melalui Perdagangan Melalui Sistem Elektronik (Tidak Final)', 'pph22', 0.5, '411122', '102'),
  ('22-102-02', 'Penghasilan yang Diterima atau Diperoleh Pedagang Dalam Negeri Atas Penjualan Barang, Penyerahan Jasa, dan/atau Persewaan serta Penghasilan Lain Sehubungan dengan Penggunaan Harta yang Dilakukan Melalui Perdagangan Melalui Sistem Elektronik (Final)', 'pph22', 0.5, '411122', '102'),
  ('22-401-01', 'Penjualan BBM oleh Pertamina atau Anak Perusahaan Pertamina Kepada SPBU (Final)', 'pph22', 0.25, '411122', '401'),
  ('22-401-02', 'Penjualan BBM oleh Badan Usaha Selain Pertamina atau Anak Perusahaan Pertamina Kepada SPBU/Agen/Penyalur (Final)', 'pph22', 0.3, '411122', '401'),
  ('22-401-03', 'Penjualan BBG oleh produsen/importir Kepada SPBU/Agen/Penyalur (Final)', 'pph22', 0.3, '411122', '401'),
  ('22-401-04', 'Penjualan BBM oleh Pertamina atau Anak Perusahaan Pertamina kepada Agen/Penyalur selain SPBU (Final)', 'pph22', 0.3, '411122', '401'),
  ('22-401-05', 'Penjualan BBM oleh Badan Usaha Selain Pertamina atau Anak Perusahaan Pertamina Kepada SPBU/Agen/Penyalur (Final) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph22', 0.3, '411122', '401'),
  ('22-403-01', 'Penjualan Barang yang Tergolong Sangat Mewah Selain Rumah Beserta Tanahnya, Apartemen, Kondominium dan Sejenisnya', 'pph22', 5, '411122', '403'),
  ('22-403-02', 'Penjualan Barang yang Tergolong Sangat Mewah Untuk Rumah Beserta Tanahnya, Apartemen, Kondominium dan Sejenisnya', 'pph22', 1, '411122', '403'),
  ('22-404-01', 'Ekspor Komoditas Tambang Batubara, Mineral Logam, dan Mineral Bukan Logam yang Dilakukan Oleh Eksportir, Kecuali WP yang Terikat dalam PKP2B dan KK', 'pph22', 1.5, '411122', '404'),
  ('22-405-01', 'Penghasilan Sehubungan dengan Aset Kripto yang dipungut oleh Penyelenggara Perdagangan Melalui Sistem Elektronik yang Merupakan Pedagang Fisik Aset Kripto', 'pph22', 0.1, '411122', '405'),
  ('22-405-02', 'Penghasilan Sehubungan dengan Aset Kripto yang dipungut oleh Penyelenggara Perdagangan Melalui Sistem Elektronik yang Bukan Merupakan Pedagang Fisik Aset Kripto', 'pph22', 0.2, '411122', '405'),
  ('22-405-04', 'Penghasilan Sehubungan dengan Aset Kripto yang dipungut oleh Penyelenggara Perdagangan Melalui Sistem Elektronik Dalam Negeri yang Merupakan Pedagang Aset Keuangan Digital', 'pph22', 0.21, '411122', '405'),
  ('22-405-05', 'Penghasilan Sehubungan dengan Aset Kripto yang dipungut oleh Penyelenggara Perdagangan Melalui Sistem Elektronik Luar Negeri yang Merupakan Pemungut Pajak Penghasilan', 'pph22', 1, '411122', '405'),
  ('22-406-01', 'PPh pasal 22 yang terutang atas penghasilan Kontraktor Utama sehubungan pelaksanaan proyek pemerintah yang dibiayai Hibah atau Pinjaman Luar Negeri', 'pph22', 0, '411122', '406'),
  ('22-900-01', 'Pembayaran atas Pembelian Barang dan/atau Bahan untuk Kegiatan Usahanya oleh BUMN/Badan Usaha Tertentu', 'pph22', 1.5, '411122', '900'),
  ('22-910-01', 'Pemungutan oleh Bendaharawan', 'pph22', 1.5, '411122', '910'),
  ('24-100-01', 'Hadiah, Penghargaan, Bonus dan Lainnya Selain yang Telah Dipotong PPh Pasal 21 Ayat (1) Huruf E UU PPh', 'pph23', 15, '411124', '100'),
  ('24-100-02', 'Sewa dan Penghasilan Lain Sehubungan Dengan Penggunaan Harta Kecuali Sewa Tanah dan/atau Bangunan yang Telah Dikenai PPh Pasal 4 Ayat (2) UU PPh.', 'pph23', 2, '411124', '100'),
  ('24-101-01', 'Dividen', 'pph23', 15, '411124', '101'),
  ('24-102-01', 'Bunga Selain yang Dikenakan PPh Pasal 4 ayat (2)', 'pph23', 15, '411124', '102'),
  ('24-103-01', 'Royalti', 'pph23', 15, '411124', '103'),
  ('24-103-02', 'Royalti yang diterima atau diperoleh Wajib Pajak orang pribadi dalam negeri yang menerapkan penghitungan Pajak Penghasilan menggunakan Norma Penghitungan Penghasilan Neto', 'pph23', 6, '411124', '103'),
  ('24-104-01', 'Jasa Teknik', 'pph23', 2, '411124', '104'),
  ('24-104-02', 'Jasa Manajemen', 'pph23', 2, '411124', '104'),
  ('24-104-03', 'Jasa Konsultan', 'pph23', 2, '411124', '104'),
  ('24-104-04', 'Jasa Penilai (Appraisal)', 'pph23', 2, '411124', '104'),
  ('24-104-05', 'Jasa Aktuaris', 'pph23', 2, '411124', '104'),
  ('24-104-06', 'Jasa Akuntansi, Pembukuan, dan Atestasi Laporan Keuangan', 'pph23', 2, '411124', '104'),
  ('24-104-07', 'Jasa Hukum', 'pph23', 2, '411124', '104'),
  ('24-104-08', 'Jasa Arsitektur', 'pph23', 2, '411124', '104'),
  ('24-104-09', 'Jasa Perencanaan Kota dan Arsitektur Landscape;', 'pph23', 2, '411124', '104'),
  ('24-104-10', 'Jasa Perancang (Design)', 'pph23', 2, '411124', '104'),
  ('24-104-11', 'Jasa Pengeboran (Drilling) di Bidang Penambangan Minyak dan Gas Bumi (Migas) Kecuali yang Dilakukan oleh Badan Usaha Tetap (BUT)', 'pph23', 2, '411124', '104'),
  ('24-104-12', 'Jasa Penunjang di Bidang Usaha Panas Bumi dan Penambangan Minyak dan Gas Bumi (Migas)', 'pph23', 2, '411124', '104'),
  ('24-104-13', 'Jasa Penambangan dan Jasa Penunjang Selain di Bidang Usaha Panas Bumi dan Penambangan Minyak dan Gas Bumi (Migas)', 'pph23', 2, '411124', '104'),
  ('24-104-14', 'Jasa Penunjang di Bidang Penerbangan dan Bandar Udara', 'pph23', 2, '411124', '104'),
  ('24-104-15', 'Jasa Penebangan Hutan', 'pph23', 2, '411124', '104'),
  ('24-104-16', 'Jasa Pengolahan Limbah', 'pph23', 2, '411124', '104'),
  ('24-104-17', 'Jasa Penyedia Tenaga Kerja dan/atau Tenaga Ahli (Outsourcing Services)', 'pph23', 2, '411124', '104'),
  ('24-104-18', 'Jasa Perantara dan/atau Keagenan', 'pph23', 2, '411124', '104'),
  ('24-104-19', 'Jasa Bidang Perdagangan Surat-Surat Berharga, Kecuali yang Dilakukan Bursa Efek, Kustodian Sentral Efek Indonesia (KSEI) dan Kliring Penjaminan Efek Indonesia (KPEI)', 'pph23', 2, '411124', '104'),
  ('24-104-20', 'Jasa Kustodian/Penyimpanan/Penitipan, Kecuali yang Dilakukan Oleh KSEI', 'pph23', 2, '411124', '104'),
  ('24-104-21', 'Jasa Pengisian Suara (Dubbing) dan/atau Sulih Suara', 'pph23', 2, '411124', '104'),
  ('24-104-22', 'Jasa Mixing Film', 'pph23', 2, '411124', '104'),
  ('24-104-23', 'Jasa Pembuatan Sarana Promosi Film, Iklan, Poster, Foto, Slide, Klise, Banner, Pamphlet, Baliho dan Folder', 'pph23', 2, '411124', '104'),
  ('24-104-24', 'Jasa Sehubungan Dengan Software Atau Hardware Atau Sistem Komputer, Termasuk Perawatan, Pemeliharaan dan Perbaikan.', 'pph23', 2, '411124', '104'),
  ('24-104-25', 'Jasa Pembuatan dan/atau Pengelolaan Website', 'pph23', 2, '411124', '104'),
  ('24-104-26', 'Jasa Internet Termasuk Sambungannya', 'pph23', 2, '411124', '104'),
  ('24-104-27', 'Jasa Penyimpanan, Pengolahan dan/atau Penyaluran Data, Informasi, dan/atau Program', 'pph23', 2, '411124', '104'),
  ('24-104-28', 'Jasa Instalasi/Pemasangan Mesin, Peralatan, Listrik, Telepon, Air, Gas, Ac dan/atau Tv Kabel, Selain Yang Dilakukan Oleh Wajib Pajak Yang Ruang Lingkupnya Di Bidang Konstruksi dan Mempunyai Izin dan/atau Sertifikasi Sebagai Pengusaha Konstruksi;', 'pph23', 2, '411124', '104'),
  ('24-104-29', 'Jasa Perawatan/Perbaikan/Pemeliharaan Mesin, Peralatan, Listrik, Telepon, Air, Gas, Ac dan/atau Tv Kabel, Selain Yang Dilakukan Oleh Wajib Pajak Yang Ruang Lingkupnya di Bidang Konstruksi dan Mempunyai Izin dan/atau Sertifikasi Sebagai Pengusaha Konstruksi', 'pph23', 2, '411124', '104'),
  ('24-104-30', 'Jasa Perawatan Kendaraan dan/atau Alat Transportasi Darat, Laut dan Udara', 'pph23', 2, '411124', '104'),
  ('24-104-31', 'Jasa Maklon', 'pph23', 2, '411124', '104'),
  ('24-104-32', 'Jasa Penyelidikan dan Keamanan', 'pph23', 2, '411124', '104'),
  ('24-104-33', 'Jasa Penyelenggara Kegiatan Atau Event Organizer', 'pph23', 2, '411124', '104'),
  ('24-104-34', 'Jasa Penyediaan Tempat dan/atau Waktu Dalam Media Massa, Media Luar Ruang Atau Media Lain Untuk Penyampaian Informasi, dan/atau Jasa Periklanan', 'pph23', 2, '411124', '104'),
  ('24-104-35', 'Jasa Pembasmian Hama', 'pph23', 2, '411124', '104'),
  ('24-104-36', 'Jasa Kebersihan Atau Cleaning Service', 'pph23', 2, '411124', '104'),
  ('24-104-37', 'Jasa Sedot Septic Tank', 'pph23', 2, '411124', '104'),
  ('24-104-38', 'Jasa Pemeliharaan Kolam', 'pph23', 2, '411124', '104'),
  ('24-104-39', 'Jasa Katering Atau Tata Boga', 'pph23', 2, '411124', '104'),
  ('24-104-40', 'Jasa Freight Forwarding', 'pph23', 2, '411124', '104'),
  ('24-104-41', 'Jasa Logistik', 'pph23', 2, '411124', '104'),
  ('24-104-42', 'Jasa Pengurusan Dokumen', 'pph23', 2, '411124', '104'),
  ('24-104-43', 'Jasa Pengepakan', 'pph23', 2, '411124', '104'),
  ('24-104-44', 'Jasa Loading dan Unloading', 'pph23', 2, '411124', '104'),
  ('24-104-45', 'Jasa Laboratorium dan/atau Pengujian Kecuali yang Dilakukan oleh Lembaga atau Institusi Pendidikan Dalam Rangka Penelitian Akademis', 'pph23', 2, '411124', '104'),
  ('24-104-46', 'Jasa Pengelolaan Parkir', 'pph23', 2, '411124', '104'),
  ('24-104-47', 'Jasa Penyondiran Tanah', 'pph23', 2, '411124', '104'),
  ('24-104-48', 'Jasa Penyiapan dan/atau Pengolahan Lahan', 'pph23', 2, '411124', '104'),
  ('24-104-49', 'Jasa Pembibitan dan/atau Penanaman Bibit', 'pph23', 2, '411124', '104'),
  ('24-104-50', 'Jasa Pemeliharaan Tanaman', 'pph23', 2, '411124', '104'),
  ('24-104-51', 'Jasa Pemanenan', 'pph23', 2, '411124', '104'),
  ('24-104-52', 'Jasa Pengolahan Hasil Pertanian, Perkebunan, Perikanan, Peternakan dan/atau Perhutanan', 'pph23', 2, '411124', '104'),
  ('24-104-53', 'Jasa Dekorasi', 'pph23', 2, '411124', '104'),
  ('24-104-54', 'Jasa Pencetakan/Penerbitan', 'pph23', 2, '411124', '104'),
  ('24-104-55', 'Jasa Penerjemahan', 'pph23', 2, '411124', '104'),
  ('24-104-56', 'Jasa Pengangkutan/Ekspedisi Kecuali Yang Telah Diatur Dalam Pasal 15 Undang-Undang Pajak Penghasilan', 'pph23', 2, '411124', '104'),
  ('24-104-57', 'Jasa Pelayanan Pelabuhan', 'pph23', 2, '411124', '104'),
  ('24-104-58', 'Jasa Pengangkutan Melalui Jalur Pipa', 'pph23', 2, '411124', '104'),
  ('24-104-59', 'Jasa Pengelolaan Penitipan Anak', 'pph23', 2, '411124', '104'),
  ('24-104-60', 'Jasa Pelatihan dan/atau Kursus', 'pph23', 2, '411124', '104'),
  ('24-104-61', 'Jasa Pengiriman dan Pengisian Uang Ke Atm', 'pph23', 2, '411124', '104'),
  ('24-104-62', 'Jasa Sertifikasi', 'pph23', 2, '411124', '104'),
  ('24-104-63', 'Jasa Survey', 'pph23', 2, '411124', '104'),
  ('24-104-64', 'Jasa Tester', 'pph23', 2, '411124', '104'),
  ('24-104-65', 'Jasa Selain Jasa-Jasa Tersebut di Atas yang Pembayarannya Dibebankan pada APBN (Anggaran Pendapatan dan Belanja Negara) Atau APBD (Anggaran Pendapatan dan Belanja Daerah).', 'pph23', 2, '411124', '104'),
  ('24-104-66', 'Jasa Penyelenggaraan Layanan Transaksi Pembayaran Terkait dengan Distribusi Token Oleh Penyelenggara Distribusi', 'pph23', 2, '411124', '104'),
  ('24-104-67', 'Jasa Pemasaran dengan Media Voucer Oleh Penyelenggara Voucer', 'pph23', 2, '411124', '104'),
  ('24-104-68', 'Jasa Penyelenggaraan Layanan Transaksi Pembayaran Terkait dengan Distribusi Voucer Oleh Penyelenggara Voucer dan Penyelenggara Distribusi', 'pph23', 2, '411124', '104'),
  ('24-104-69', 'Jasa Penyelenggaraan Program Loyalitas dan Penghargaan Pelanggan (Consumer Loyalty/Reward Program) Oleh Penyelenggara Voucer', 'pph23', 2, '411124', '104'),
  ('24-105-01', 'Bunga Pinjaman yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap Melalui Layanan Pinjam Meminjam Uang Berbasis Teknologi Informasi', 'pph23', 15, '411124', '105'),
  ('24-106-01', 'PPh pasal 23 yang terutang atas penghasilan Kontraktor Utama sehubungan pelaksanaan proyek pemerintah yang dibiayai Hibah atau Pinjaman Luar Negeri', 'pph23', 0, '411124', '106'),
  ('27-100-01', 'Sewa dan Penghasilan Lain Sehubungan dengan Penggunaan Harta (PPh Pasal 26)', 'pph26', 20, '411127', '100'),
  ('27-100-02', 'Hadiah dan Penghargaan (PPh Pasal 26)', 'pph26', 20, '411127', '100'),
  ('27-100-03', 'Pensiun dan Pembayaran Berkala Lainnya', 'pph26', 20, '411127', '100'),
  ('27-100-04', 'Keuntungan Karena Pembebasan Utang (PPh Pasal 26)', 'pph26', 20, '411127', '100'),
  ('27-100-05', 'Penghasilan Dari Penjualan atau Pengalihan Harta di Indonesia (PPh Pasal 26)', 'pph26', 20, '411127', '100'),
  ('27-100-06', 'Premi Asuransi/Reasuransi (PPh Pasal 26)', 'pph26', 20, '411127', '100'),
  ('27-101-01', 'Dividen (PPh Pasal 26)', 'pph26', 20, '411127', '101'),
  ('27-102-01', 'Bunga Selain Bunga Obligasi (PPh Pasal 26)', 'pph26', 20, '411127', '102'),
  ('27-102-02', 'Premi Swap dan Transaksi Lindung Nilai Lainnya (PPh Pasal 26)', 'pph26', 20, '411127', '102'),
  ('27-103-01', 'Royalti (PPh Pasal 26)', 'pph26', 20, '411127', '103'),
  ('27-104-01', 'Imbalan Sehubungan dengan Jasa, Pekerjaan dan Kegiatan (PPh Pasal 26)', 'pph26', 20, '411127', '104'),
  ('27-105-01', 'Penghasilan Kena Pajak BUT Setelah Pajak (PPh Pasal 26)', 'pph26', 20, '411127', '105'),
  ('28-401-01', 'Bunga Obligasi, Surat Utang Negara, atau Obligasi Daerah yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap.', 'pph4_2', 15, '411128', '401'),
  ('28-401-03', 'Bunga Obligasi yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap yang diadministrasikan oleh BI', 'pph4_2', 10, '411128', '401'),
  ('28-401-04', 'Diskonto Surat Perbendaharaan Negara yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap', 'pph4_2', 20, '411128', '401'),
  ('28-401-05', 'Diskonto Surat Perbendaharaan Negara yang Diterima Wajib Pajak Penduduk/Berkedudukan di Luar Negeri', 'pph4_2', 20, '411128', '401'),
  ('28-401-06', 'Bunga Obligasi yang Diterima Wajib Pajak Dalam Negeri dan Bentuk Usaha Tetap', 'pph4_2', 10, '411128', '401'),
  ('28-402-01', 'Pengalihan Hak atas Tanah dan/atau Bangunan', 'pph4_2', 2.5, '411128', '402'),
  ('28-402-02', 'Pengalihan Rumah Sederhana dan Rumah Susun Sederhana yang Dilakukan oleh WP yang Usaha Pokoknya Mengalihkan Hak atas Tanah dan/atau Bangunan', 'pph4_2', 1, '411128', '402'),
  ('28-402-03', 'Pengalihan Hak atas Tanah dan/atau Bangunan kepada Pemerintah, BUMN yang Mendapat Penugasan Khusus dari Pemerintah, atau BUMD yang Mendapat Penugasan Khusus dari Kepala Daerah, sesuai UU mengenai Pengadaan Tanah bagi Pembangunan untuk Kepentingan Umum', 'pph4_2', 0, '411128', '402'),
  ('28-402-04', 'Pengalihan Hak atas Tanah dan/atau Bangunan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 2.5, '411128', '402'),
  ('28-403-02', 'Persewaan Tanah dan/atau Bangunan', 'pph4_2', 10, '411128', '403'),
  ('28-403-04', 'Persewaan Tanah dan/atau Bangunan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 10, '411128', '403'),
  ('28-404-01', 'Bunga Tabungan dan Bunga Deposito yang Ditempatkan di Dalam Negeri yang Dananya Bersumber Selain dari Devisa Hasil Ekspor (DHE)', 'pph4_2', 20, '411128', '404'),
  ('28-404-02', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang IDR bersumber dari DHE tenor 1 bulan)', 'pph4_2', 7.5, '411128', '404'),
  ('28-404-03', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang IDR bersumber dari DHE tenor 3 bulan)', 'pph4_2', 5, '411128', '404'),
  ('28-404-04', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang IDR bersumber dari DHE tenor 6 bulan atau lebih)', 'pph4_2', 0, '411128', '404'),
  ('28-404-05', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang USD bersumber dari DHE tenor 1 bulan)', 'pph4_2', 10, '411128', '404'),
  ('28-404-06', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang USD bersumber dari DHE tenor 3 bulan)', 'pph4_2', 7.5, '411128', '404'),
  ('28-404-07', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang USD bersumber dari DHE tenor 6 bulan)', 'pph4_2', 2.5, '411128', '404'),
  ('28-404-08', 'Bunga Deposito yang Ditempatkan di Dalam Negeri (mata uang USD bersumber dari DHE tenor lebih 6 bulan)', 'pph4_2', 0, '411128', '404'),
  ('28-404-09', 'Bunga Deposito/Tabungan yang Ditempatkan di Luar Negeri Melalui Bank yang Didirikan atau Bertempat Kedudukan di Indonesia atau Cabang Bank Luar Negeri di Indonesia', 'pph4_2', 20, '411128', '404'),
  ('28-404-10', 'Diskonto Sertifikat Bank Indonesia', 'pph4_2', 20, '411128', '404'),
  ('28-404-11', 'Jasa Giro', 'pph4_2', 20, '411128', '404'),
  ('28-404-12', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang VALAS Bersumber dari DHE SDA Tenor Lebih Dari 6 Bulan)', 'pph4_2', 0, '411128', '404'),
  ('28-404-13', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang VALAS Bersumber dari DHE SDA Tenor 6 Bulan)', 'pph4_2', 2.5, '411128', '404'),
  ('28-404-14', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang VALAS Bersumber dari DHE SDA Tenor Lebih Dari 3 Bulan sampai dengan Kurang Dari 6 Bulan)', 'pph4_2', 7.5, '411128', '404'),
  ('28-404-15', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang VALAS Bersumber dari DHE SDA Tenor 1 Bulan sampai dengan Kurang Dari 3 Bulan)', 'pph4_2', 10, '411128', '404'),
  ('28-404-16', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang IDR Bersumber dari DHE SDA Tenor 6 Bulan atau Lebih Dari 6 Bulan)', 'pph4_2', 0, '411128', '404'),
  ('28-404-17', 'Penghasilan dari Instrumen Moneter dan/atau Instrumen Keuangan Tertentu di Indonesia (Mata Uang VALAS Bersumber dari DHE SDA Tenor 3 Bulan sampai dengan Kurang Dari 6 Bulan)', 'pph4_2', 2.5, '411128', '404'),
  ('28-404-18', 'Penghasilan dari instrumen moneter dan/atau instrumen keuangan tertentu di Indonesia (mata uang IDR bersumber dari DHE SDA tenor 1 bulan sampai dengan kurang dari 3 bulan)', 'pph4_2', 5, '411128', '404'),
  ('28-405-01', 'Hadiah Undian', 'pph4_2', 25, '411128', '405'),
  ('28-406-01', 'Transaksi Penjualan Saham di Bursa Efek (Bukan Saham Pendiri)', 'pph4_2', 0.1, '411128', '406'),
  ('28-407-01', 'Transaksi Penjualan Saham di Bursa Efek (Saham Pendiri)', 'pph4_2', 0.5, '411128', '407'),
  ('28-408-01', 'Transaksi Penjualan Saham Milik Perusahaan Modal Ventura Tidak di Bursa Efek', 'pph4_2', 0.1, '411128', '408'),
  ('28-409-22', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha Kualifikasi Kecil atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan', 'pph4_2', 1.75, '411128', '409'),
  ('28-409-23', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha Atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan', 'pph4_2', 4, '411128', '409'),
  ('28-409-24', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Selain Sertifikat Badan Usaha Kualifikasi Kecil atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan', 'pph4_2', 2.65, '411128', '409'),
  ('28-409-25', 'Pekerjaan Konstruksi Terintegrasi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha', 'pph4_2', 2.65, '411128', '409'),
  ('28-409-26', 'Pekerjaan Konstruksi Terintegrasi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha', 'pph4_2', 4, '411128', '409'),
  ('28-409-27', 'Jasa Konsultansi Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan', 'pph4_2', 3.5, '411128', '409'),
  ('28-409-28', 'Jasa Konsultansi Konstruksi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan', 'pph4_2', 6, '411128', '409'),
  ('28-409-43', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha Kualifikasi Kecil atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 1.75, '411128', '409'),
  ('28-409-44', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha Atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 4, '411128', '409'),
  ('28-409-45', 'Pekerjaan Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Selain Sertifikat Badan Usaha Kualifikasi Kecil atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 2.65, '411128', '409'),
  ('28-409-46', 'Pekerjaan Konstruksi Terintegrasi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 2.65, '411128', '409'),
  ('28-409-47', 'Pekerjaan Konstruksi Terintegrasi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 4, '411128', '409'),
  ('28-409-48', 'Jasa Konsultansi Konstruksi yang Dilakukan oleh Penyedia Jasa yang Memiliki Sertifikat Badan Usaha atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 3.5, '411128', '409'),
  ('28-409-49', 'Jasa Konsultansi Konstruksi yang Dilakukan oleh Penyedia Jasa yang Tidak Memiliki Sertifikat Badan Usaha atau Sertifikat Kompetensi Kerja untuk Usaha Orang Perseorangan sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 6, '411128', '409'),
  ('28-409-50', 'Jasa Konstruksi Berupa Jasa Perencanaan Konstruksi (Dengan Kualifikasi Usaha) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 4, '411128', '409'),
  ('28-409-51', 'Jasa Konstruksi Berupa Jasa Perencanaan Konstruksi (Tanpa Kualifikasi Usaha) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 6, '411128', '409'),
  ('28-409-52', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Kualifikasi Usaha Kecil) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 2, '411128', '409'),
  ('28-409-53', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Kualifikasi Usaha Menengah dan Besar) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 3, '411128', '409'),
  ('28-409-54', 'Jasa Konstruksi Berupa Jasa Pelaksanaan Konstruksi (Tanpa Kualifikasi Usaha) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 4, '411128', '409'),
  ('28-409-55', 'Jasa Konstruksi Berupa Jasa Pengawasan Konstruksi (Dengan Kualifikasi Usaha) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 4, '411128', '409'),
  ('28-409-56', 'Jasa Konstruksi Berupa Jasa Pengawasan Konstruksi (Tanpa Kualifikasi Usaha) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph4_2', 6, '411128', '409'),
  ('28-410-01', 'Imbalan yang Diterima/Diperoleh Sehubungan dengan Pengangkutan Orang dan/atau Barang Termasuk Penyewaan Kapal Laut Oleh Perusahaan Pelayaran Dalam Negeri', 'pph15', 1.2, '411128', '410'),
  ('28-410-02', 'Imbalan yang Dibayarkan/Terutang kepada Perusahaan Pelayaran Dalam Negeri', 'pph15', 1.2, '411128', '410'),
  ('28-410-05', 'Imbalan yang Diterima/Diperoleh Sehubungan dengan Pengangkutan Orang dan/atau Barang Termasuk Penyewaan Kapal Laut Oleh Perusahaan Pelayaran Dalam Negeri sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph15', 1.2, '411128', '410'),
  ('28-410-06', 'Imbalan yang Dibayarkan/Terutang kepada Perusahaan Pelayaran Dalam Negeri sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph15', 1.2, '411128', '410'),
  ('28-411-01', 'Imbalan yang Dibayarkan/Terutang kepada Perusahaan Pelayaran dan/atau Penerbangan Luar Negeri Sehubungan dengan Pengangkutan Orang dan/atau Barang (Selain Berdasarkan Perjanjian Charter)', 'pph15', 2.64, '411128', '411'),
  ('28-411-02', 'Imbalan Charter Kapal Laut dan/atau Pesawat Udara yang Dibayarkan/ Terutang kepada Perusahaan Pelayaran dan/atau Penerbangan Luar Negeri melalui BUT di Indonesia', 'pph15', 2.64, '411128', '411'),
  ('28-411-04', 'Imbalan yang Dibayarkan/Terutang kepada Perusahaan Pelayaran dan/atau Penerbangan Luar Negeri Sehubungan dengan Pengangkutan Orang dan/atau Barang (Selain Berdasarkan Perjanjian Charter) sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph15', 2.64, '411128', '411'),
  ('28-411-05', 'Imbalan Charter Kapal Laut dan/atau Pesawat Udara yang Dibayarkan/ Terutang kepada Perusahaan Pelayaran dan/atau Penerbangan Luar Negeri melalui BUT di Indonesia sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph15', 2.64, '411128', '411'),
  ('28-413-01', 'Penghasilan Wajib Pajak Luar Negeri yang Mempunyai Kantor Perwakilan Dagang di Indonesia', 'pph15', 0.44, '411128', '413'),
  ('28-417-01', 'Bunga Simpanan yang Dibayarkan oleh Koperasi kepada Anggota Wajib Pajak Orang Pribadi (bunga sampai dengan Rp240.000,00)', 'pph4_2', 0, '411128', '417'),
  ('28-417-02', 'Bunga Simpanan yang Dibayarkan oleh Koperasi kepada Anggota Wajib Pajak Orang Pribadi (bunga di atas Rp240.000,00)', 'pph4_2', 10, '411128', '417'),
  ('28-419-01', 'Dividen yang Diterima/Diperoleh Wajib Pajak Orang Pribadi Dalam Negeri', 'pph4_2', 10, '411128', '419'),
  ('28-421-01', 'Uplift Hulu Migas', 'pph4_2', 20, '411128', '421'),
  ('28-421-02', 'Participating Interest Eksplorasi Hulu Migas', 'pph4_2', 5, '411128', '421'),
  ('28-421-03', 'Participating Interest Eksploitasi Hulu Migas', 'pph4_2', 7, '411128', '421'),
  ('28-423-01', 'Pemotongan atau pemungutan PPh atas penjualan barang atau penyerahan jasa yang dilakukan oleh Wajib Pajak dengan peredaran bruto tertentu sesuai dengan Peraturan Pemerintah Nomor 23 Tahun 2018 atau Peraturan Pemerintah Nomor 55 Tahun 2022.', 'pph4_2', 0.5, '411128', '423'),
  ('28-423-02', 'Pemotongan atau pemungutan PPh atas transaksi pembelian yang dilakukan oleh Wajib Pajak dengan peredaran bruto tertentu sesuai dengan Peraturan Pemerintah Nomor 55 Tahun 2022.', 'pph4_2', 0.5, '411128', '423'),
  ('28-423-03', 'Pemotongan atau Pemungutan PPh atas transaksi penjualan barang atau penyerahan jasa yang dilakukan oleh Wajib Pajak orang pribadi yang memiliki peredaran bruto tertentu sesuai dengan PP 55 Tahun 2022 dengan peredaran usaha s.d Rp500.000.000,00.', 'pph4_2', 0.5, '411128', '423'),
  ('28-423-12', 'Pemotongan atau Pemungutan PPh atas transaksi penjualan barang atau penyerahan jasa yang dilakukan oleh Wajib Pajak yang memenuhi persyaratan tertentu untuk dikenai PPh yang bersifat final dengan tarif 0% di IKN (PPh UMKM di IKN).', 'pph4_2', 0, '411128', '423'),
  ('28-423-13', 'Pemotongan atau pemungutan PPh atas transaksi pembelian yang dilakukan oleh Wajib Pajak yang memanfaatkan fasilitas PPh final dengan tarif 0% di IKN (PPh UMKM di IKN).', 'pph4_2', 0, '411128', '423'),
  ('28-423-14', 'Pemotongan atau pemungutan PPh atas penjualan barang atau penyerahan jasa yang dilakukan oleh Wajib Pajak dengan peredaran bruto tertentu yang memperoleh penghasilan sehubungan pelaksanaan proyek pemerintah yang dibiayai Hibah atau Pinjaman Luar Negeri', 'pph4_2', 0.5, '411128', '423'),
  ('28-423-15', 'Pemotongan atau Pemungutan PPh atas transaksi penjualan barang atau penyerahan jasa yang dilakukan oleh Wajib Pajak yang memenuhi persyaratan tertentu untuk dikenai PPh yang bersifat final dengan tarif 0% di IKN yang memperoleh penghasilan sehubungan pelaksanaan proyek pemerintah yang dibiayai Hibah atau Pinjaman Luar Negeri', 'pph4_2', 0, '411128', '423'),
  ('28-499-01', 'Penghasilan Wajib Pajak yang Melakukan Kegiatan Usaha Jasa Maklon (Contract Manufacturing) Internasional di Bidang Produksi Mainan Anak-Anak', 'pph15', 2.1, '411128', '499'),
  ('28-499-02', 'Penghasilan yang Diterima atau Diperoleh Sehubungan dengan Kerja Sama dengan Lembaga Pengelola Investasi (LPI)', 'pph4_2', 7.5, '411128', '499'),
  ('29-101-01', 'Imbalan Charter Pesawat Udara yang Dibayarkan/Terutang kepada Perusahaan Penerbangan Dalam Negeri oleh Pemotong Pajak', 'pph15', 1.8, '411129', '101'),
  ('29-101-02', 'Imbalan Charter Pesawat Udara yang Dibayarkan/Terutang kepada Perusahaan Penerbangan Dalam Negeri oleh Pemotong Pajak sehubungan Pelaksanaan Proyek Pemerintah yang Dibiayai dengan Hibah atau Dana Pinjaman Luar Negeri', 'pph15', 1.8, '411128', '101')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    pph_article = EXCLUDED.pph_article,
    rate_percent = EXCLUDED.rate_percent,
    kap = COALESCE(EXCLUDED.kap, public.tax_object_codes.kap),
    kjs = COALESCE(EXCLUDED.kjs, public.tax_object_codes.kjs),
    updated_at = NOW();

-- ----------------------------------------------------------------------------
-- Withholding entities: NPWP/TKU of the business that withholds (one per PT)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_withholding_entities (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_id INT NOT NULL,
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  npwp TEXT NOT NULL CHECK (npwp ~ '^[0-9]{16}$'),
  tku_id TEXT NOT NULL CHECK (tku_id ~ '^[0-9]{22}$'),
  city TEXT,
  signer_name TEXT,
  signer_title TEXT,
  signer_npwp TEXT CHECK (signer_npwp IS NULL OR signer_npwp ~ '^[0-9]{16}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_withholding_entities_business_fkey
    FOREIGN KEY (workspace_id, business_id)
    REFERENCES public.scalev_webhook_businesses(workspace_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  UNIQUE (workspace_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_tax_withholding_entities_workspace
  ON public.tax_withholding_entities (workspace_id, is_active);

ALTER TABLE public.tax_withholding_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_withholding_entities FROM PUBLIC, anon;
GRANT SELECT ON public.tax_withholding_entities TO authenticated;
GRANT ALL ON public.tax_withholding_entities TO service_role;

DROP POLICY IF EXISTS tax_withholding_entities_read ON public.tax_withholding_entities;
CREATE POLICY tax_withholding_entities_read ON public.tax_withholding_entities
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at_tax_withholding_entities ON public.tax_withholding_entities;
CREATE TRIGGER set_updated_at_tax_withholding_entities
  BEFORE UPDATE ON public.tax_withholding_entities
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

-- ----------------------------------------------------------------------------
-- Counterparties (master lawan transaksi)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_counterparties (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  identity_type TEXT NOT NULL CHECK (identity_type IN ('npwp', 'nik', 'foreign_tin', 'unknown')),
  identity_number TEXT NOT NULL CHECK (length(trim(identity_number)) > 0),
  is_pkp BOOLEAN NOT NULL DEFAULT FALSE,
  country_code CHAR(3) NOT NULL DEFAULT 'IDN' CHECK (country_code ~ '^[A-Z]{3}$'),
  address TEXT,
  phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (identity_type IN ('foreign_tin', 'unknown'))
    OR (identity_number ~ '^[0-9]{16}$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_counterparties_workspace_name
  ON public.tax_counterparties (workspace_id, lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_counterparties_workspace_identity
  ON public.tax_counterparties (workspace_id, identity_type, identity_number)
  WHERE identity_type IN ('npwp', 'nik');
CREATE INDEX IF NOT EXISTS idx_tax_counterparties_workspace_active
  ON public.tax_counterparties (workspace_id, is_active, name);

ALTER TABLE public.tax_counterparties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_counterparties FROM PUBLIC, anon;
GRANT SELECT ON public.tax_counterparties TO authenticated;
GRANT ALL ON public.tax_counterparties TO service_role;

DROP POLICY IF EXISTS tax_counterparties_read ON public.tax_counterparties;
CREATE POLICY tax_counterparties_read ON public.tax_counterparties
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at_tax_counterparties ON public.tax_counterparties;
CREATE TRIGGER set_updated_at_tax_counterparties
  BEFORE UPDATE ON public.tax_counterparties
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

-- ----------------------------------------------------------------------------
-- Counterparty facilities (SKB / PP23 / DTP / SKD) with validity history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_counterparty_facilities (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  counterparty_id BIGINT NOT NULL REFERENCES public.tax_counterparties(id) ON DELETE CASCADE,
  facility_code TEXT NOT NULL
    CHECK (facility_code IN ('TaxExAr22', 'TaxExAr23', 'TaxExIntDep', 'TaxExIntPhtb', 'DTP', 'PP23', 'ETC', 'SKD')),
  document_number TEXT,
  applies_to TEXT[] NOT NULL DEFAULT ARRAY['pph23']::TEXT[]
    CHECK (
      cardinality(applies_to) > 0
      AND applies_to <@ ARRAY['pph22', 'pph23', 'pph4_2', 'pph15', 'pph26']::TEXT[]
    ),
  rate_override NUMERIC(6, 3) CHECK (rate_override IS NULL OR rate_override >= 0),
  valid_from DATE,
  valid_to DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_tax_counterparty_facilities_counterparty
  ON public.tax_counterparty_facilities (counterparty_id, valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_tax_counterparty_facilities_workspace
  ON public.tax_counterparty_facilities (workspace_id, valid_to);

ALTER TABLE public.tax_counterparty_facilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tax_counterparty_facilities FROM PUBLIC, anon;
GRANT SELECT ON public.tax_counterparty_facilities TO authenticated;
GRANT ALL ON public.tax_counterparty_facilities TO service_role;

DROP POLICY IF EXISTS tax_counterparty_facilities_read ON public.tax_counterparty_facilities;
CREATE POLICY tax_counterparty_facilities_read ON public.tax_counterparty_facilities
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at_tax_counterparty_facilities ON public.tax_counterparty_facilities;
CREATE TRIGGER set_updated_at_tax_counterparty_facilities
  BEFORE UPDATE ON public.tax_counterparty_facilities
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

-- ----------------------------------------------------------------------------
-- Permissions: tab:tax-withholding for finance roles in every workspace
-- ----------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, permission_key)
VALUES
  ('admin', 'tab:tax-withholding'),
  ('direktur_finance', 'tab:tax-withholding'),
  ('staf_finance', 'tab:tax-withholding')
ON CONFLICT DO NOTHING;

INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
SELECT workspace.id, seed.role, 'tab:tax-withholding'
FROM public.workspaces workspace
CROSS JOIN (VALUES ('admin'), ('direktur_finance'), ('staf_finance')) AS seed(role)
ON CONFLICT DO NOTHING;

COMMIT;
