# Meta Funnel: snapshot Sorotan → pratinjau kartu (fase 1)

Status: preview-only. Tidak ada pengiriman ke Basecamp, endpoint feed, tujuan,
notifikasi, scheduler, secret baru, AI, atau perubahan Worker/MCP. Tidak ada
migrasi database. Snapshot belum menjadi arsip server yang persisten.

## Menggunakan

1. Buka Meta Ads Funnel → detail brand → Tujuan/Ad, pilih periode dan filter.
2. Buka Sorotan **Kebocoran tahap** pada baris atau rasio tahap.
3. Pilih **Pratinjau kartu Basecamp**. Tombol hanya tersedia jika bukti mentah
   cocok dengan temuan dari laporan yang sama.
4. Periksa cakupan, pembanding, angka mentah, kualitas data, dan usulan pemeriksaan.
5. **Unduh snapshot JSON** menyimpan bukti dan teks kartu ke perangkat Anda.
   Tidak ada tombol Kirim. File memuat data bisnis yang sudah dapat Anda lihat;
   simpan sesuai kebijakan akses workspace, jangan commit ke repo.

Pratinjau adalah format isi yang diusulkan, bukan tangkapan layar UI Basecamp.
Belum ada project/Card Table/kolom, assignee, deadline, atau penerima notifikasi.
Snapshot tidak berubah mengikuti UI setelah dibuka; perubahan scope/revisi
menutup pratinjau lama. Tutup/unduh sebelum berpindah konteks.

## Sumber dan akses

`getMetaBrandDetail` menjalankan `reportContext` yang sudah memverifikasi user,
workspace, permission Meta, dan akses brand/akun. Snapshot dibuat **di server**
dari hasil detail tersebut, tanpa query baru dan tanpa menerima angka dari klien.
Gunakan semua Sorotan detail, bukan ringkasan top-3 atau `meta_funnel_alerts`
(Notifikasi memakai window/aturan berbeda).

Workspace/brand memakai identitas kanonis. Template, group, akun laporan,
ad IDs kelompok, periode WIB, dan filter tervalidasi ikut disimpan.
Business/store bernilai `null`: laporan ini tidak membuktikan atribusi ke sana.
Nama akun, URL, dan template tidak digunakan untuk menebak brand/store.

## Kontrak snapshot v1

- `schema_version`: `meta-funnel.leak-snapshot/v1`; `mode`: `preview_only`.
- `finding_id`: SHA-256 dari workspace, brand, world, section/group, formula,
  basis pembanding, kedua periode, filter, dan cakupan ID akun laporan.
- `snapshot_id`: SHA-256 dari isi bukti/metadata versi, **tanpa** `generated_at`.
  Recapture identik stabil; revisi data/aturan/nama mengubah snapshot, bukan
  identitas temuan. Ini bukan tanda tangan, izin akses, atau bukti pengiriman.
- `generated_at`: waktu capture server, bukan waktu sync atau jaminan freshness.
- `source.revision`: revisi cache laporan, bukan versi deployment.
- `rule`: aturan Kebocoran tahap yang juga digunakan dashboard. Bump versi
  aturan ketika semantik berubah. Rasio dan perubahan dihitung dari nilai mentah;
  pembulatan hanya untuk tampilan. Spend bukan estimasi kerugian.
- `quality`: periode selesai dalam WIB, coverage kedua periode, mata uang
  tunggal, cakupan kanonis, dan kesiapan template. Data valid tetapi parsial/
  periode berjalan tetap bisa dipratinjau dengan status `blocked`. Bukti null,
  non-finite, sampel terlalu kecil, formula/group tidak cocok tidak diberi preview.
- `ready_for_review` hanya lolos pemeriksaan dasar, **bukan siap publish** atau
  jaminan bahwa Meta tidak akan merevisi data. Catatan pemetaan tetap disertakan.
- `source.snapshot_url`: `null`. `report_path` hanya navigasi halaman laporan,
  **tidak** memulihkan tanggal/filter atau bukti historis. Jangan menampilkannya
  sebagai tautan permanen ke snapshot. File JSON adalah salinan beku fase ini.
- `card`: versi template, judul, dan `body_format: plain_text`. UI merender
  string sebagai teks React, bukan HTML/Markdown dari nama iklan. Publisher
  mendatang harus melakukan escaping/konversi rich text secara eksplisit.

Snapshot JSON yang diunduh dapat diedit pemilik file: jangan menjadikannya
payload tepercaya pada endpoint publisher mendatang. Fase berikutnya memerlukan
autentikasi server-ke-server, mapping tujuan yang disetujui, gate kualitas yang
dievaluasi ulang, ledger persisten, deduplikasi, dan rekonsiliasi hasil ambigu.
Jangan mengklaim exactly-once dari ID atau retry saja.

## Pengujian

`npm run test:meta-highlight-preview` mencakup bukti/rounding, identitas/revisi,
scope/filter, coverage/WIB, data invalid, teks tidak tepercaya, pembukaan/penutupan,
unduh JSON lokal, dan invalidasi modal. CI menjalankannya bersama
`test:meta-funnels`; tes detail memastikan semua temuan dan batas workspace tetap berlaku.
Jalankan typecheck, lint, build, serta tes akses sebelum merge. Tidak ada izin
merge atau deploy yang tersirat dari PR ini.
