# Bukti Potong PPh (Coretax BPPU) — Rancangan Teknis

Status: **Fase 1 diimplementasikan** (migration `247_tax_withholding.sql`, tab
`tax-withholding`, master pemotong & lawan transaksi, impor master). Fase 2 ke atas
masih rancangan. Dokumen ini menjadi acuan implementasi bertahap fitur bukti
potong/pungut unifikasi (BPPU) di Roove BI.

## 1. Tujuan

Menggantikan dua workbook yang hari ini dipakai tim finance RTI:

| Workbook | Peran hari ini | Diganti oleh |
| --- | --- | --- |
| `REKAP POTPUT ID BILLING NTPN PAJAK TAHUN {tahun} - PT {PT}.xlsm` | Buku besar bukti potong, satu baris per transaksi, rumus tarif/SKB/PPN, master lawan transaksi, format impor e-Bupot lama | Tabel `tax_withholding_slips`, `tax_counterparties`, rule engine |
| `BPPU Excel to XML v.3 {PT} - {MM} {YYYY} - {seq}.xlsx` | Template DJP ber-XML-Map; sheet DATA diketik ulang dari REKAPAN lalu di-export ke XML Coretax | Generator XML server-side + log batch |

Hasil akhir yang diinginkan per masa pajak per PT:

1. Daftar bukti potong lengkap dengan DPP, tarif, PPh, dan fasilitas yang sudah
   terhitung otomatis dari master.
2. File XML `BpuBulk` yang lolos validasi dan siap unggah ke Coretax e-Bupot.
3. Rekap PPh terutang per pasal untuk pembuatan ID Billing.
4. Pencatatan balik nomor bupot, ID Billing, NTPN, tanggal bayar dan lapor.

Yang **tidak** termasuk: unggah otomatis ke Coretax (tidak ada API publik),
pembuatan ID Billing, PPh 21 karyawan, SPT Masa.

## 2. Proses saat ini dan aturan bisnis yang direplikasi

Alur manual: pengajuan pembayaran di Trello → dicatat ke sheet REKAPAN →
rumus menghitung tarif/PPh/PPN → per masa disalin ke template BPPU → export XML
di Excel → unggah Coretax → nomor bupot dicatat balik ke REKAPAN.

Aturan yang tertanam di rumus REKAPAN dan wajib dipertahankan oleh rule engine:

| Aturan | Sumber di workbook |
| --- | --- |
| NPWP/NIK, status PKP, negara, fasilitas diambil dari master lawan transaksi berdasarkan nama vendor | `VLOOKUP(... M_LWN_TRK ...)` |
| PPh pasal dan tarif dasar diambil dari referensi kode objek pajak | sheet `Ref Daftar Kode Bukti Potong.` |
| Tarif **dikali 2** jika penerima hanya punya NIK (tanpa NPWP), untuk PPh 23, 22, 15 | kolom `TARIF` |
| Tarif **0** jika vendor punya SKB/fasilitas yang masih berlaku pada tanggal transaksi | kolom `SKB`, `TGL BERLAKU SKD/SKB/PP23` |
| DPP sering dimasukkan sebagai total bayar ÷ 1,11 (strip PPN), menghasilkan desimal panjang | kolom `PENGHASILAN BRUTO` (`=7600/1.11`) |
| PPN 11% dihitung hanya jika vendor PKP; 1,1% untuk jasa ekspedisi kode 24-104-56 | kolom `PPN` |
| PPh dipotong = ROUND(DPP × tarif, 0) | kolom `PAJAK YANG DI POTONG` |
| PPh 26 (vendor asing) tarif 20% kecuali ada SKD; identitas berupa TIN negara asal | sheet `NR`, kolom AI..BF |
| Nama file bupot: `BUKPOT {pasal} - {MM YYYY} - {vendor} - {no bupot} - NO.INV {inv}` | kolom `BUKPOT` |
| Satu masa bisa di-export lebih dari satu batch (`- 01`, `- 02`) | nama file BPPU/XML |

Format impor e-Bupot lama (sheet `42152223`, `NR`, `Dasar Pemotongan`, `GAB`,
makro `Button80_Click`) **tidak** direplikasi; sudah digantikan BPPU XML.

## 3. Skema XML Coretax (kontrak keluaran)

Diambil dari XML Map yang tertanam di template (`xl/xmlMaps.xml`). Urutan elemen
wajib persis seperti ini.

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<BpuBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <TIN>1234567890123456</TIN>                       <!-- NPWP pemotong, [0-9]{15,16} -->
  <ListOfBpu>
    <Bpu>
      <TaxPeriodMonth>10</TaxPeriodMonth>           <!-- integer 1..12 -->
      <TaxPeriodYear>2026</TaxPeriodYear>
      <CounterpartTin>0987654321098765</CounterpartTin>          <!-- NPWP/NIK 16 digit, nillable -->
      <IDPlaceOfBusinessActivityOfIncomeRecipient>0987654321098765000000</IDPlaceOfBusinessActivityOfIncomeRecipient> <!-- TKU = NPWP + 000000 -->
      <TaxCertificate>N/A</TaxCertificate>          <!-- enum: N/A TaxExAr22 TaxExAr23 TaxExIntDep TaxExIntPhtb DTP PP23 ETC -->
      <TaxObjectCode>24-104-24</TaxObjectCode>
      <TaxBase>2702.7027027027025</TaxBase>         <!-- decimal > 0, tidak dibulatkan -->
      <Rate>2</Rate>                                 <!-- decimal >= 0, dalam persen -->
      <Document>CommercialInvoice</Document>         <!-- enum, lihat §6.3 -->
      <DocumentNumber>INV/2026/10/0001</DocumentNumber>
      <DocumentDate>2026-10-27</DocumentDate>        <!-- YYYY-MM-DD, nillable -->
      <IDPlaceOfBusinessActivity>1234567890123456000000</IDPlaceOfBusinessActivity> <!-- TKU pemotong -->
      <GovTreasurerOpt>N/A</GovTreasurerOpt>         <!-- enum: N/A Imprest Direct -->
      <SP2DNumber xsi:nil="true"/>                   <!-- kosong → xsi:nil -->
      <WithholdingDate>2026-10-27</WithholdingDate>
    </Bpu>
  </ListOfBpu>
</BpuBulk>
```

Validasi tambahan dari sheet BPPU (bukan dari XSD, tetapi ditegakkan Coretax):

- `TIN` harus sama dengan NPWP akun yang login di Coretax.
- Jika `Document = TaxInvoice`, nomor dan tanggal dokumen harus cocok dengan faktur pajak.
- `WithholdingDate` tidak boleh lebih awal dari masa/tahun pajak.
- `GovTreasurerOpt` selain `N/A` dan `SP2DNumber` hanya untuk instansi pemerintah; untuk Roove selalu `N/A` dan nil.

## 4. Penempatan di aplikasi

- **Tab**: `tax-withholding`, label **Bukti Potong (PPh)**, anak dari `financial-report`
  di `ALL_TABS` (`lib/utils.ts`), ikon `FileCheck`. Permission key `tab:tax-withholding`
  ditambahkan ke `PERMISSION_GROUPS` di bawah `tab:fixed-costs`.
- **Role default**: `owner`, `direktur_finance`, `staf_finance`. Role lain lewat
  matriks permission workspace seperti biasa.
- **Route**: `app/dashboard/tax-withholding/page.tsx` (client) memanggil server
  actions di `lib/tax-withholding-actions.ts`. Komponen besar di `components/TaxWithholding*.tsx`.
- **Tenancy**: semua tabel punya `workspace_id`; setiap action memakai
  `requireDashboardTabAccess('tax-withholding', 'Bukti Potong')` dan
  memfilter `workspace_id` dari konteks, mengikuti pola `lib/fixed-cost-actions.ts`.
- **Entitas pemotong** merujuk ke `scalev_webhook_businesses` (RTI, RLB, RLT, JHN,
  RLBPP) lewat `(workspace_id, business_id)`, mengikuti pola `business_brand_roles`.

## 5. Model data

Migration baru satu berkas, nomor berikutnya setelah `246_` (saat ini `247_tax_withholding.sql`).
Semua tabel `ENABLE ROW LEVEL SECURITY` dengan policy `workspace_can_access(workspace_id)`
untuk SELECT dan service-role untuk tulis (server actions memakai `createServiceSupabase`).

### 5.1 `tax_withholding_entities` — identitas pemotong per PT

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| id | BIGINT identity PK | |
| workspace_id | UUID FK workspaces | |
| business_id | INT | FK `(workspace_id, business_id)` → `scalev_webhook_businesses(workspace_id, id)` |
| legal_name | TEXT | `PT. ROOVE TIJARA INTERNASIONAL` |
| npwp | CHAR(16) | hanya digit, CHECK `~ '^[0-9]{15,16}$'` |
| tku_id | CHAR(22) | default `npwp || '000000'`, bisa dioverride |
| city | TEXT | |
| signer_name, signer_title, signer_npwp | TEXT | direktur penandatangan (sheet PERUSAHAAN) |
| is_active | BOOLEAN | |
| UNIQUE | (workspace_id, business_id) | |

### 5.2 `tax_counterparties` — master lawan transaksi

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| id | BIGINT identity PK | |
| workspace_id | UUID | |
| name | TEXT | nama tampil, unik per workspace (case-insensitive) |
| identity_type | TEXT | CHECK IN (`npwp`, `nik`, `foreign_tin`) |
| identity_number | TEXT | digit saja untuk npwp/nik (16); bebas untuk foreign_tin |
| is_pkp | BOOLEAN | menentukan PPN |
| country_code | CHAR(3) | ISO-3, default `IDN`; selain IDN → kandidat PPh 26 |
| address, phone, notes | TEXT | |
| is_active | BOOLEAN | |
| UNIQUE | (workspace_id, identity_type, identity_number) WHERE identity_type <> 'foreign_tin' | |

### 5.3 `tax_counterparty_facilities` — SKB / PP23 / DTP / SKD dengan masa berlaku

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| id | BIGINT identity PK | |
| counterparty_id | BIGINT FK | ON DELETE CASCADE |
| facility_code | TEXT | enum TaxCertificate: `TaxExAr22` `TaxExAr23` `TaxExIntDep` `TaxExIntPhtb` `DTP` `PP23` `ETC`; `SKD` disimpan sebagai `ETC` + `applies_to = pph26` |
| document_number | TEXT | nomor SKB/suket/SKD |
| applies_to | TEXT[] | subset dari `pph22 pph23 pph4_2 pph15 pph26` |
| rate_override | NUMERIC(6,3) | NULL = 0% (bebas); isi untuk PP23 0,5% atau tarif SKD |
| valid_from, valid_to | DATE | fasilitas aktif jika `valid_from <= tgl transaksi <= COALESCE(valid_to, 'infinity')` |

Riwayat tersimpan; tidak ada overwrite ketika SKB diperbarui tahun berikutnya.

### 5.4 `tax_object_codes` — referensi global (bukan per workspace)

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| code | TEXT PK | `24-104-24` |
| name | TEXT | |
| pph_article | TEXT | `pph22` `pph23` `pph4_2` `pph15` `pph26` `pph21` |
| rate_percent | NUMERIC(6,3) | tarif dasar |
| kap, kjs | TEXT | kode akun pajak & jenis setoran untuk ID Billing (dari sheet Ref) |
| is_active | BOOLEAN | |

Diseed dari sheet `REF` template BPPU (198 kode) digabung kolom KAP/KJS dari
`Ref Daftar Kode Bukti Potong.`; seed dimasukkan di migration yang sama.
Tiga enum lain (fasilitas, jenis dokumen, opsi IP) cukup sebagai konstanta TypeScript.

### 5.5 `tax_withholding_slips` — bukti potong (inti)

| Kolom | Tipe | Catatan |
| --- | --- | --- |
| id | BIGINT identity PK | |
| workspace_id | UUID | |
| entity_id | BIGINT FK tax_withholding_entities | pemotong |
| counterparty_id | BIGINT FK tax_counterparties | |
| counterparty_name, counterparty_identity_type, counterparty_identity_number | snapshot | dibekukan saat status ≥ `exported` agar XML lama dapat direproduksi |
| period_month SMALLINT, period_year SMALLINT | | default dari `invoice_date` |
| invoice_date | DATE | `PERIODE INVOICE` |
| invoice_number | TEXT | `NO INVOICE`; boleh beberapa nomor dipisah koma |
| description | TEXT | `KETERANGAN TRANSAKSI` |
| object_code | TEXT FK tax_object_codes | |
| pph_article | TEXT | denormalisasi dari object_code saat simpan |
| gross_amount | NUMERIC(20,6) | DPP / `TaxBase`; disimpan apa adanya, tidak dibulatkan |
| gross_input_mode | TEXT | `dpp` atau `total_incl_vat` (lihat §6.1) |
| rate_percent | NUMERIC(6,3) | hasil rule engine, bisa dioverride dengan alasan |
| rate_override_reason | TEXT | wajib jika rate berbeda dari hasil engine |
| facility_code | TEXT | enum TaxCertificate, default `N/A` |
| facility_document_number | TEXT | |
| withholding_amount | NUMERIC(18,0) | ROUND(gross × rate/100) |
| vat_rate_percent, vat_amount | NUMERIC | 0 jika bukan PKP |
| additional_cost | NUMERIC(18,2) | `BIAYA TAMBAHAN` |
| total_amount | NUMERIC(20,6) | gross + additional + vat |
| document_type | TEXT | enum Document, default `CommercialInvoice` |
| document_date | DATE | default = invoice_date |
| withholding_date | DATE | default = invoice_date |
| status | TEXT | `draft` → `ready` → `exported` → `reported` → `paid`, lihat §7 |
| export_batch_id | BIGINT FK tax_export_batches | NULL sampai di-export |
| coretax_slip_number | TEXT | nomor bupot dari Coretax (`26000UK7L`); unik per pemotong untuk nilai berpola `^[0-9A-Z]+$` (migration 253) |
| coretax_recorded_at, coretax_recorded_by | TIMESTAMPTZ, UUID | kapan dan oleh siapa nomor dicatat (fase 4) |
| account_code, account_name | TEXT | `NO AKUN` + nama akun (`(6-60221) Administrasi`) |
| trello_url | TEXT | |
| notes | TEXT | |
| source | TEXT | `manual`, `import_rekapan` |
| created_by, created_at, updated_at | | |

Index: `(workspace_id, entity_id, period_year, period_month, status)`,
`(workspace_id, counterparty_id)`, `(export_batch_id)`.

CHECK: `gross_amount > 0`, `rate_percent >= 0`, `period_month BETWEEN 1 AND 12`,
`withholding_date >= make_date(period_year, period_month, 1)`.

### 5.6 `tax_export_batches` — log file XML

| Kolom | Catatan |
| --- | --- |
| id, workspace_id, entity_id, period_month, period_year | |
| sequence SMALLINT | `01`, `02` per entity+masa, dihitung server |
| file_name TEXT | `BPPU - EBUPOT - {kode PT} - {MM} {YYYY} - {seq}.xml` |
| slip_count INT, total_gross NUMERIC, total_withholding NUMERIC | |
| xml_sha256 TEXT | |
| xml_content TEXT | disimpan untuk unduh ulang; ukuran puluhan KB per batch |
| created_by, created_at | |

Batch bersifat immutable. Jika ada koreksi setelah export, bupot di-"void"
dari batch (lihat §7) dan diikutkan ke batch berikutnya.

### 5.7 `tax_payment_records` — ID Billing & NTPN (fase 5, migration 254)

Satu ID Billing menutup seluruh PPh satu pasal (KAP+KJS) dalam satu masa, bukan
per bupot. Tabel terpisah dengan kolom `(workspace_id, entity_id, period_month,
period_year, pph_article, kap, kjs, billing_id ^\d{15}$, billing_amount,
billing_created_at, billing_valid_until, ntpn ^[0-9A-Z]{16}$, paid_at, paid_amount,
notes, created_by, paid_recorded_by, created_at, updated_at)`. `billing_id` unik per
pemotong, `ntpn` unik per pemotong (indeks parsial); CHECK `ntpn`, `paid_at`,
`paid_amount` terisi bersama. Boleh lebih dari satu catatan per kelompok (setoran
dipecah/pembetulan). Fungsi `tax_record_payment_ntpn()` menyimpan NTPN dan mengubah bupot
`reported` kelompok itu menjadi `paid`; `tax_clear_payment_ntpn()` membalikkannya bila tidak
ada catatan lain yang masih ber-NTPN. Catatan: di workbook 2026 kolom ID Billing dan NTPN
kosong untuk seluruh baris, jadi tabel ini mulai kosong dan diisi dari Rekap Setor.

## 6. Rule engine (`lib/tax-withholding-rules.ts`)

Fungsi murni tanpa akses database agar mudah diuji unit. Semua angka uang
memakai string desimal atau `Big`-like helper, bukan `number` float, kecuali
pada layer presentasi.

### 6.1 Resolusi DPP

```
input: { amount, mode: 'dpp' | 'total_incl_vat', vatRate }
mode dpp            → gross = amount
mode total_incl_vat → gross = amount / (1 + vatRate/100)   // replika =7600/1.11
```

Hasil disimpan dengan presisi 6 desimal. XML memakai representasi desimal penuh
tanpa pembulatan ke rupiah agar sama dengan perilaku Excel yang sudah diterima
Coretax. Opsi pembulatan ke 2 desimal disediakan sebagai setelan workspace jika
nanti dikonfirmasi lebih aman.

### 6.2 Resolusi tarif dan fasilitas

```
resolveRate({ objectCode, pphArticle, counterparty, facilities, txDate }):
  base = objectCode.rate_percent
  activeFacility = facilities.find(f => f.applies_to ∋ pphArticle
                                       && f.valid_from <= txDate <= f.valid_to)
  if activeFacility:
      rate = activeFacility.rate_override ?? 0
      certificate = activeFacility.facility_code
  else:
      certificate = 'N/A'
      rate = base
      if counterparty.identity_type == 'nik' && pphArticle ∈ {pph23, pph22, pph15}:
          rate = base * 2
  if pphArticle == 'pph26' && !activeFacility: rate = 20
  return { rate, certificate, facilityDocumentNumber }
```

### 6.3 PPh, PPN, total

```
withholding = ROUND_HALF_UP(gross * rate / 100, 0)
vatRate     = counterparty.is_pkp ? (objectCode == '24-104-56' ? 1.1 : 11) : 0
vat         = ROUND_HALF_UP(gross * vatRate / 100, 0)
total       = gross + additionalCost + vat
```

Konstanta enum (`TAX_CERTIFICATES`, `DOCUMENT_TYPES`, `GOV_TREASURER_OPTS`)
dan daftar `Document` yang dipakai Roove (`CommercialInvoice`, `TaxInvoice`,
`Contract`, `PaymentProof`, `StatementLetter`) didefinisikan di modul ini.

### 6.4 Validasi pra-export (`validateSlipForXml`)

Mengembalikan daftar error per bupot. Bupot dengan error tidak boleh masuk batch;
UI menampilkan error di baris, bukan memblokir seluruh masa.

- NPWP/NIK 15–16 digit angka; untuk `foreign_tin` CounterpartTin diisi TIN asal dan ditandai perlu review manual.
- `object_code` aktif; `facility_code` ∈ enum; `document_type` ∈ enum.
- `gross_amount > 0`; `rate_percent >= 0`; `withholding_date >= awal masa`.
- `document_number` tidak kosong; jika `TaxInvoice` harus 16 digit angka.
- Periode bupot sama dengan periode batch.

## 7. Siklus status bukti potong

```
draft ──(lengkap & valid)──> ready ──(masuk batch XML)──> exported
exported ──(nomor bupot diisi)──> reported ──(NTPN tercatat, fase 2)──> paid
exported ──(void dari batch, alasan wajib)──> draft   // kembali ke antrean batch berikutnya
```

- Edit bebas hanya pada `draft`/`ready`.
- `exported` membekukan snapshot lawan transaksi dan angka; perubahan hanya lewat void.
- Pengisian nomor bupot massal: UI menerima tempelan dua kolom (nomor dokumen → nomor bupot) atau CSV hasil unduhan Coretax, dicocokkan per `invoice_number` dalam batch.

## 8. Server actions (`lib/tax-withholding-actions.ts`)

| Action | Keterangan |
| --- | --- |
| `getTaxWithholdingBootstrap()` | entities, object codes aktif, counterparties ringkas, setelan |
| `listTaxSlips({ entityId, year, month, status?, search?, page })` | daftar + total per pasal |
| `saveTaxSlip(input)` | create/update; memanggil rule engine di server, menolak override tanpa alasan |
| `deleteTaxSlip(id)` | hanya `draft`/`ready` |
| `voidTaxSlipFromBatch(id, reason)` | kembali ke `draft` |
| `listCounterparties`, `saveCounterparty`, `saveCounterpartyFacility`, `deactivateCounterparty` | master |
| `saveWithholdingEntity(input)` | identitas pemotong per business |
| `previewTaxExport({ entityId, year, month })` | daftar bupot `ready` + hasil validasi + total; tidak menulis |
| `createTaxExportBatch({ entityId, year, month, slipIds })` | validasi ulang, buat batch, set status `exported`, kembalikan `{ batchId, fileName, xml }` |
| `getTaxExportBatchXml(batchId)` | unduh ulang |
| `previewCoretaxRecording(formData)` | bupot `exported`/`reported` satu masa (opsional satu batch) + usulan nomor dari tempelan/unduhan Coretax; tidak menulis |
| `recordCoretaxNumbers({ entityId, year, month, assignments[], allowReplace })` | fungsi DB `tax_record_coretax_numbers()`: set `coretax_slip_number`, status `reported`, cek versi dan keunikan |
| `clearCoretaxNumber({ slipId })` | hapus nomor, kembali ke `exported` (hanya bupot yang punya batch) |
| `getTaxYearSummary({ entityId, year })` | DPP & PPh per masa dan per pasal + KAP + KJS, dasar ID Billing |
| `listTaxPaymentRecords({ entityId, year })`, `saveTaxPaymentRecord(input)`, `deleteTaxPaymentRecord` | catatan ID Billing per kelompok rekap (edit/hapus hanya tanpa NTPN, cek versi) |
| `recordTaxPaymentNtpn({ id, version, ntpn, paidAt, paidAmount })`, `clearTaxPaymentNtpn` | fungsi DB: NTPN + status `paid`/`reported` bupot kelompok |
| `importRekapanWorkbook(file)` | impor awal, lihat §10 |

Unduhan: action mengembalikan string XML; klien membuat `Blob` dan memicu
unduhan, pola yang sama dengan MP Data Parser (tidak perlu route API baru).

## 9. Antarmuka

Satu halaman dengan sub-tab, memakai konvensi tema `--tone-*`/`toneText`:

1. **Bukti Potong** (default). Pemilih PT dan masa (bulan/tahun) di atas, kartu
   ringkas: jumlah bupot per status, total DPP, total PPh per pasal. Tabel baris
   per bupot dengan kolom: tanggal, no invoice, keterangan, lawan transaksi,
   kode objek, DPP, tarif, PPh, fasilitas, status, nomor bupot. Baris bermasalah
   diberi penanda error validasi. Tombol **Tambah** membuka form.
2. **Form bukti potong** (drawer). Urutan isian meniru REKAPAN: tanggal, no
   invoice, keterangan, lawan transaksi (pencarian), kode objek (pencarian nama
   atau kode), nominal + mode (DPP / total termasuk PPN). Tarif, fasilitas, PPh,
   PPN, total dihitung langsung dan ditampilkan; tarif bisa dioverride dengan alasan.
3. **Export XML**. Pratinjau daftar `ready` + validasi, lalu tombol buat batch
   dan unduh. Riwayat batch masa tersebut dengan tombol unduh ulang dan void.
4. **Pencatatan Coretax** (dialog di tab Bukti Potong). Tempel dua kolom atau unggah unduhan Coretax,
   atau ketik per baris; status berubah `reported`. Per bupot: catat / ubah / hapus nomor.
4b. **Rekap Setor** (sub-tab). Per masa dan total tahun: pasal, KAP, KJS, jumlah bupot, DPP, PPh,
   PPh yang belum dilaporkan, status, dan kolom Setoran (ID Billing, NTPN, tanggal/jumlah setor;
   buat/ubah/hapus ID Billing, catat/hapus NTPN); unduh CSV.
4c. **Pengingat fasilitas**. Banner di Bukti Potong dan Rekap Setor bila ada fasilitas aktif yang habis
   ≤ 30 hari atau baru berakhir ≤ 30 hari, dengan tombol ke Lawan Transaksi.
5. **Lawan Transaksi**. CRUD master + fasilitas dengan masa berlaku; penanda
   fasilitas yang akan habis dalam 30 hari.
6. **Pemotong** (owner). NPWP, TKU, penandatangan per PT.

Nilai NPWP ditampilkan dengan format `94.042.441.9-429.000` di UI, disimpan digit
murni. Tidak ada NPWP yang dikirim ke layanan luar atau log.

## 10. Impor awal dari workbook yang ada

Server action satu arah yang menerima `.xlsm/.xlsx` dan membaca dengan `xlsx`
(sudah dipakai di `lib/excel-parser.ts`):

- **MASTER LAWAN TRANSAKSI** → `tax_counterparties` + `tax_counterparty_facilities`.
  Kolom: nama (C), NPWP (D), KTP (E), PKP (H), kode negara (K), jenis fasilitas (L/O),
  no SKB/SKD (M), aturan DTP (N), suket PP23 (P), tgl berlaku (Q). NPWP dinormalisasi
  dengan membuang titik dan strip; NPWP 15 digit lama dipadankan ke 16 digit dengan
  awalan `0` (sesuai praktik Coretax, perlu konfirmasi per vendor).
- **REKAPAN** → `tax_withholding_slips` status `reported` jika kolom BUPOT terisi,
  `draft` jika kosong. Kolom: B tanggal, D no invoice, F keterangan, G kode objek
  (ambil pola `NN-NNN-NN` dari teks), H nama vendor, K DPP, L tarif, M PPh, N biaya
  tambahan, O PPN, Q BUPOT, W link Trello, BN/BO akun. Baris tanpa tanggal dilewati.
  Vendor yang tidak ditemukan di master dilaporkan, tidak dibuat diam-diam.
- Impor idempoten per `(entity, invoice_number, invoice_date, counterparty, object_code)`.
- Laporan impor menampilkan selisih antara PPh di workbook dan hasil rule engine,
  sebagai uji regresi aturan sebelum fitur dipakai untuk masa berjalan.

Dua workbook per PT (RTI dan PT lain) diimpor terpisah; `entity` dipilih di UI.

## 10a. Keputusan implementasi Fase 1

- Kode fasilitas internal menambah `SKD` di luar enum Coretax; pemetaan ke
  `TaxCertificate` dilakukan generator XML (fase 3). Legacy `SKB` → `TaxExAr23`.
- Fasilitas hanya punya `valid_from` dari kolom `TGL BERLAKU`; `valid_to` kosong
  sampai diisi manual. `rate_override` NULL berarti 0% (dibebaskan).
- Vendor luar negeri: identitas `foreign_tin` memakai kolom TIN; NPWP placeholder
  `999000000999000` tidak dianggap NPWP. Vendor asing yang punya NPWP PMSE
  (mis. Meta Ireland) tetap diimpor sebagai `npwp`.
- Jenis identitas `unknown` menampung vendor tanpa NPWP/NIK (di master lama diisi
  placeholder `999000000999000` atau kosong). Vendor seperti ini tersimpan dan
  terlihat di UI, tetapi fase 2 akan menolaknya masuk ke bukti potong sampai
  identitasnya dilengkapi.
- Tanggal dari Excel dibaca sebagai serial, bukan `Date`, karena konversi `xlsx`
  bergeser beberapa detik sebelum tengah malam pada zona waktu WIB.
- NPWP 15 digit dipadankan ke 16 digit dengan awalan `0` (pertanyaan §11 no. 4 tetap
  terbuka; konversi ditandai sebagai peringatan impor).
- Tabel master hanya bisa ditulis lewat server action (service role). Pembacaan
  langsung lewat API database dibatasi RLS (`workspace_has_tax_access`, migration
  248): platform owner, workspace owner, atau role yang punya `tab:tax-withholding`
  di workspace baris itu. Diuji oleh `npm run test:tax-withholding-db` (juga di CI).
  Peran yang boleh mengubah: owner, admin, direktur_finance, staf_finance.
- Identitas fasilitas ditegakkan di database (migration 249): unik per
  `(counterparty_id, facility_code, document_number, valid_from)` dengan NULLS NOT
  DISTINCT, sehingga impor bersamaan tidak menggandakan sertifikat tetapi
  perpanjangan dengan periode baru tetap tersimpan sebagai riwayat.
  Cleanup hanya merangkum payload yang setara; konflik pasal, tarif, tanggal akhir
  atau catatan membatalkan migrasi secara atomik untuk rekonsiliasi manual.
- Pratinjau dan impor final sama-sama mengirim `workspaceId` halaman; server
  menolak bila workspace aktif sudah berganti sebelum salah satu permintaan
  (cookie workspace dibagi antar tab). Konfirmasi menyebut workspace tujuan.
- Nama sama dengan dua identitas dikenal yang berbeda ditolak per baris, baik
  pada pratinjau maupun impor final: tidak mengubah PKP/alamat/catatan maupun
  fasilitas. Konflik tetap muncul di hasil impor untuk diperbaiki dan diulang.
- Kode negara kosong memakai IDN; nilai nonkosong selain tiga huruf menolak
  baris dengan pesan berisi nilai asli, tanpa menebak negara atau jenis identitas.
- Tanggal berlaku fasilitas yang tidak valid tidak diimpor (vendor tetap masuk,
  nilai asli disimpan di catatan). Workbook sistem tanggal 1904 dibaca dengan
  epoch yang benar. Overflow tanggal numerik juga dilaporkan per baris tanpa
  membatalkan pembacaan vendor lain.
- Kode objek diseed global dari sheet REF template (198 kode) ditambah 12 kode
  PPh 26 (`27-xxx`) dari referensi e-Bupot lama; KAP/KJS dilengkapi dari pasal dan
  segmen tengah kode bila tidak ada di referensi lama.

## 10b. Keputusan implementasi Fase 2

- Uang dihitung sebagai BigInt mikro-rupiah (6 desimal) agar DPP hasil `total/1,11`
  tersimpan persis; PPh dan PPN dibulatkan half-up ke rupiah seperti `ROUND` Excel.
- Bupot menyimpan input (`gross_input_mode`, `gross_input_amount`) dan hasil engine
  (`rate_source`, `facility_code`, jumlah) sehingga bisa dihitung ulang dan diaudit;
  identitas lawan transaksi di-snapshot per bupot.
- Status: `draft` jika identitas vendor belum lengkap, `ready` jika lengkap, `reported`
  bila nomor bupot Coretax sudah ada (impor REKAPAN). `exported`/`paid` dipakai fase 3+.
- Impor REKAPAN mencocokkan vendor berdasarkan nama lalu NPWP/NIK, menghitung ulang
  PPh, dan menampilkan selisih terhadap angka workbook. Pengguna memilih menyimpan angka
  engine (default) atau angka workbook (ditandai sebagai tarif manual). Baris yang
  vendornya belum ada di master diblokir, bukan dibuat diam-diam.
- Idempoten lewat indeks unik `(workspace, pemotong, vendor, kode objek, invoice, tanggal, DPP)`.

## 10c. Keputusan implementasi Fase 3

- Generator XML murni di `lib/tax-withholding-xml.ts` (`buildBpuBulkXml`, `validateSlipForXml`,
  `validateEntityForXml`, `exportFileNamePrefix`); urutan elemen, enum dan `xsi:nil` pada
  `SP2DNumber` mengikuti §3. `TaxBase` ditulis dari `gross_amount` tersimpan (6 desimal, tanpa nol
  di belakang), bukan 15 digit float Excel; `Rate` dari `rate_percent` (3 desimal).
- Hanya bupot `ready` dengan identitas `npwp`/`nik` 16 digit yang masuk BpuBulk. `foreign_tin` dan
  `unknown` ditolak validasi dengan pesan jelas; bupot non-residen menunggu Fase 5 (§11 no. 5).
  Fasilitas `SKD` bukan enum BPPU dan ikut ditolak. `TaxInvoice` mewajibkan nomor 16 digit.
- Satu batch = semua bupot siap yang lolos validasi di satu masa; baris terblokir tetap di luar dan
  bisa masuk batch berikutnya setelah diperbaiki. Nama file `BPPU - EBUPOT - {kode PT} - {MM} {YYYY} - {seq}.xml`;
  kode PT = inisial nama badan tanpa PT/CV (`PT. ROOVE TIJARA INTERNASIONAL` → `RTI`).
- Migration `252_tax_export_batches.sql`: tabel `tax_export_batches` (menyimpan `xml_content` dan
  `xml_sha256`), kolom `export_batch_id`, `voided_from_batch_id`, `void_reason` pada bupot, CHECK
  `exported` ⇔ ada batch. Fungsi `tax_create_export_batch()` (service role saja) mengunci pemotong,
  memverifikasi ulang bupot masih `ready` dan belum masuk batch, menomori batch per masa, menyimpan
  XML dan mengubah status dalam satu transaksi.
- Void mengembalikan bupot ke `draft`, memindahkan penunjuk ke `voided_from_batch_id` dan menyimpan
  alasan; file batch tidak berubah (immutable), pengguna diingatkan untuk membatalkan di Coretax.
- Unduhan dilakukan di klien dari string XML yang dikembalikan action (Blob), tanpa route API baru.
- Kolom `tax_invoice_number` menyimpan nomor faktur pajak terpisah dari `invoice_number` (identitas
  impor). Untuk `document_type = TaxInvoice`, nomor faktur itulah `<DocumentNumber>` dan wajib 16 digit;
  impor REKAPAN mengisinya dari kolom FAKTUR PAJAK, baris lama di-backfill dari `notes` oleh migration 252.
- Hasil review: fungsi batch memverifikasi `updated_at` setiap bupot di bawah lock; UPDATE/DELETE bupot
  hanya menyentuh baris yang masih draft/ready tanpa batch dan memeriksa jumlah baris; satu batch
  maksimal 2.000 bupot (sisanya menunggu batch berikutnya); hitungan bupot per batch dipaginasi.

## 10d. Keputusan implementasi Fase 4

- Nomor Coretax disimpan apa adanya setelah trim + huruf besar; validasi `^(?=.*\d)[0-9A-Z]{6,20}$`
  (longgar terhadap perubahan format), peringatan non-blokir bila bukan 9 karakter. Nilai lama hasil impor
  (`SUDAH DIUPLOAD`, dua nomor dalam satu sel) tetap tersimpan tetapi berada di luar indeks unik dan harus
  dikoreksi lewat "Ubah nomor".
- Pencatatan lewat fungsi DB `tax_record_coretax_numbers()` (service role): mengunci pemotong aktif,
  memverifikasi status `exported` (atau `reported` bila `p_allow_replace`), `updated_at` setiap bupot, dan
  nomor belum dipakai bupot lain di pemotong yang sama; penulisan dua tahap (placeholder `~nomor`) agar dua
  nomor bisa ditukar dalam satu panggilan. Maksimal 2.000 bupot per pencatatan.
- Pencocokan sumber Coretax: kunci utama nomor dokumen yang ditulis di XML (`xmlDocumentNumber`: faktur
  pajak untuk `TaxInvoice`, selain itu nomor invoice), lalu nomor invoice polos, dipersempit dengan NPWP dan
  DPP bila sumber memuatnya; cadangan NPWP + DPP tanpa nomor dokumen. Baris ambigu/tidak cocok dilaporkan
  dan nomornya bisa diketik langsung di baris yang benar. Format unduhan Coretax dideteksi dari judul kolom
  (sinonim "Nomor Bukti Potong", "Nomor Dokumen", "NPWP", "DPP"); tanpa judul, kolom yang nilainya berpola
  nomor Coretax dianggap kolom nomor.
- Hapus nomor mengembalikan status ke `exported` dan hanya untuk bupot yang punya `export_batch_id`
  (CHECK `exported` ⇔ ada batch); bupot impor yang `reported` tanpa batch hanya bisa diubah nomornya.
- Rekap Setor dihitung di server dari seluruh bupot satu tahun per pemotong (dipaginasi), dikelompokkan per
  masa dan per `(pph_article, kap, kjs)` dari `tax_object_codes`; kolom "belum dilaporkan" = PPh bupot
  `draft`/`ready`/`exported`. CSV dipisah `;` dibuat di klien.

## 10e. Keputusan implementasi Fase 5 (bagian 1: setoran dan pengingat)

- Setoran dicatat per kelompok rekap (pemotong, masa, pasal, KAP, KJS) di `tax_payment_records`; jumlah
  ID Billing diisi dari PPh terutang kelompok dan boleh diubah (setoran dipecah/pembetulan). Validasi
  kode billing 15 digit, NTPN 16 huruf besar/angka, jumlah rupiah bulat; KAP/KJS harus ada di
  `tax_object_codes` untuk pasal itu.
- NTPN dicatat lewat fungsi DB dengan cek versi (`updated_at` catatan) dan keunikan per pemotong; bupot
  `reported` kelompok itu menjadi `paid` dalam transaksi yang sama. Menghapus NTPN mengembalikan bupot ke
  `reported` hanya bila tidak ada catatan lain di kelompok yang masih ber-NTPN. Catatan ber-NTPN tidak bisa
  diedit/dihapus; hapus NTPN dulu.
- Kolom "PPh disetor (NTPN)" dan status kelompok (belum ada billing / belum disetor / disetor / kurang)
  dihitung di klien dari catatan tahun berjalan; CSV rekap memuat ID Billing, NTPN, tanggal dan jumlah setor.
- Pengingat fasilitas (`listExpiringFacilities`): fasilitas vendor aktif dengan `valid_to` ≤ 30 hari ke
  depan atau berakhir ≤ 30 hari lalu, diurutkan dari yang paling dekat; engine sudah memakai tarif normal
  setelah `valid_to`, banner hanya mengingatkan untuk memperbarui dokumen.
- Bupot non-residen (PPh 26, `foreign_tin`) menunggu template XML Coretax untuk bukti potong non-residen
  (BPNR); skema elemennya berbeda dari BpuBulk dan belum ada di `~/Documents/File Pajak/`.

## 11. Pertanyaan terbuka (perlu jawaban sebelum fase terkait)

1. **ID Billing dan NTPN**: di workbook 2026 kolom ini kosong di semua baris. Fase 5a membangun
   `tax_payment_records` per kelompok KAP/KJS (praktik DJP); bila tim finance ternyata mencatatnya per
   bupot di tempat lain, catatan lama bisa diimpor per kelompok.
2. **PT lain**: apakah RLB, RLT, JHN, RLBPP juga memotong PPh dan punya workbook
   serupa? Mempengaruhi prioritas multi-entity di UI.
3. **Presisi DPP**: tetap desimal panjang (perilaku sekarang) atau dibulatkan 2 desimal?
4. **NPWP 15 digit lama** di master: konfirmasi aturan konversi ke 16 digit.
5. **PPh 26 di BPPU**: bagaimana vendor asing (TIN non-NPWP) diisi di Coretax
   unifikasi saat ini? Menentukan apakah `foreign_tin` ikut XML atau tetap manual.
6. **Jenis dokumen**: apakah selalu `CommercialInvoice`, atau `TaxInvoice` dipakai
   bila vendor menerbitkan faktur pajak?
7. **Trello**: cukup tautan teks, atau perlu integrasi?

## 12. Tahapan implementasi

| Fase | Isi | Keluaran yang bisa diverifikasi |
| --- | --- | --- |
| 1 ✅ | Migration `247_tax_withholding.sql` (4 tabel master + seed 210 kode objek), tab & permission `tab:tax-withholding`, halaman `app/dashboard/tax-withholding`, CRUD pemotong dan lawan transaksi, impor master (`lib/tax-withholding-import.ts`), unit test `npm run test:tax-withholding` | Master 500 vendor terimpor, NPWP tervalidasi |
| 2 ✅ | Migration `251_tax_withholding_slips.sql`, rule engine `lib/tax-withholding-rules.ts` (BigInt mikro-rupiah, unit test), parser `lib/tax-withholding-rekapan-import.ts`, server action `lib/tax-withholding-slip-actions.ts`, UI `components/TaxWithholdingSlips.tsx` (daftar per pemotong/masa, form dengan perhitungan langsung, impor REKAPAN dengan laporan selisih engine vs workbook) | PPh hasil engine = PPh workbook untuk 830 baris 2026 (diverifikasi saat impor di produksi) |
| 3 ✅ | Migration `252_tax_export_batches.sql`, generator XML `lib/tax-withholding-xml.ts`, action `lib/tax-withholding-export-actions.ts` (pratinjau, buat batch, unduh ulang, void), dialog Export XML di tab Bukti Potong, unit test generator dan DB test batch | Elemen XML sama dengan template Excel; `TaxBase` memakai presisi 6 desimal yang tersimpan |
| 4 ✅ | Migration `253_tax_coretax_recording.sql` (fungsi `tax_record_coretax_numbers()`, indeks unik nomor per pemotong, kolom audit), parser/pencocok `lib/tax-withholding-coretax.ts`, action `lib/tax-withholding-coretax-actions.ts` (pratinjau, catat, hapus, rekap tahunan), dialog `components/TaxWithholdingCoretax.tsx`, tab Rekap Setor `components/TaxWithholdingRecap.tsx` | Total PPh per masa di Rekap Setor = jumlah kolom PPh REKAPAN per masa (2026 di produksi) |
| 5a ✅ | Migration `254_tax_payment_records.sql` (tabel + fungsi NTPN), helper `lib/tax-withholding-payment.ts`, action `lib/tax-withholding-payment-actions.ts`, kolom Setoran di Rekap Setor (`components/TaxWithholdingPayment.tsx`), banner fasilitas kedaluwarsa | NTPN tercatat → bupot kelompok `paid`; hapus NTPN → kembali `reported`; DB test |
| 5b | Export bukti potong non-residen (PPh 26) | menunggu template XML BPNR Coretax |

Setiap fase: `npm run typecheck:app`, `npm run lint`, `npm run build`, dan unit
test rule engine/generator XML. Migration hanya dijalankan di lokal sampai
diminta rilis, sesuai `docs/runbooks/development-staging-production.md`.

## 13. Risiko

- **Perubahan skema Coretax**: XSD tertanam di template v.3. Generator harus
  memakai konstanta versi skema dan menyimpan `xml_content` agar batch lama
  tetap bisa diaudit bila format berubah.
- **Data sensitif**: NPWP dan NIK adalah data pribadi. Akses dibatasi role
  finance, tidak masuk log aplikasi, tidak dikirim ke layanan luar.
- **Kesalahan tarif**: aturan NIK ×2 dan fasilitas kedaluwarsa adalah sumber
  salah potong paling sering. Laporan selisih impor (§10) menjadi uji regresi.
- **Duplikasi bupot**: dicegah dengan constraint unik lunak per
  `(entity, invoice_number, counterparty, object_code)` plus peringatan di UI,
  bukan hard constraint, karena satu invoice sah bisa memuat dua objek pajak.
