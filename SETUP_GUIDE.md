# 🚀 Panduan Setup: Roove BI Dashboard

## Langkah-langkah dari NOL sampai LIVE

---

## STEP 1: Buat Akun GitHub (5 menit)

1. Buka https://github.com
2. Klik **Sign Up**
3. Isi email, password, dan username
4. Verifikasi email Anda

---

## STEP 2: Upload Kode ke GitHub (5 menit)

1. Login ke GitHub
2. Klik tombol **+** di pojok kanan atas → **New repository**
3. Nama repository: `roove-bi`
4. Pilih **Private** (agar kode tidak publik)
5. Klik **Create repository**
6. Anda akan melihat halaman setup. **Jangan tutup halaman ini.**

### Upload file project:

**Cara termudah (tanpa Git command line):**
1. Di halaman repository yang baru dibuat, klik **"uploading an existing file"**
2. Extract file `roove-bi.zip` yang sudah Anda download
3. Drag & drop **SEMUA file dan folder** dari dalam folder `roove-bi/` ke area upload
4. Scroll ke bawah, klik **Commit changes**
5. Tunggu sampai selesai upload

> **Penting:** Pastikan struktur foldernya benar — file `package.json` harus ada di root (level teratas), BUKAN di dalam subfolder.

---

## STEP 3: Buat Project Supabase (10 menit)

1. Buka https://supabase.com
2. Klik **Start your project** → Login dengan GitHub
3. Klik **New Project**
4. Isi:
   - **Name:** `roove-bi`
   - **Database Password:** Buat password yang kuat (SIMPAN password ini!)
   - **Region:** Southeast Asia (Singapore)
5. Klik **Create new project** — tunggu 2-3 menit

### Setup Database Schema:

1. Di Supabase dashboard, klik **SQL Editor** (menu kiri)
2. Klik **New query**
3. Buka file `supabase/migrations/001_initial_schema.sql` dari project
4. Copy-paste SELURUH isi file ke SQL Editor
5. Klik **Run** (atau Ctrl+Enter)
6. Harus muncul "Success. No rows returned" — ini artinya berhasil

### Catat API Keys:

1. Klik **Settings** (icon gear, menu kiri bawah)
2. Klik **API** di submenu
3. Catat 3 hal ini:

```
Project URL:        https://xxxxx.supabase.co
anon (public) key:  eyJhbG...  (yang panjang)
service_role key:   eyJhbG...  (yang lebih panjang, JANGAN share ini ke siapapun)
```

---

## STEP 4: Deploy ke Vercel (10 menit)

1. Buka https://vercel.com
2. Klik **Sign Up** → **Continue with GitHub**
3. Authorize Vercel untuk mengakses GitHub Anda
4. Klik **Add New...** → **Project**
5. Anda akan melihat repository `roove-bi` — klik **Import**
6. Di bagian **Environment Variables**, tambahkan 3 variabel:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase Anda (https://xxxxx.supabase.co) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key dari Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key dari Supabase |

7. Klik **Deploy**
8. Tunggu 2-5 menit. Jika berhasil, Anda akan mendapat URL seperti: `https://roove-bi.vercel.app`

---

## STEP 5: Daftar Akun Pertama (2 menit)

1. Buka URL Vercel Anda (misal: https://roove-bi.vercel.app)
2. Klik tab **Daftar**
3. Masukkan email dan password Anda
4. **Akun pertama otomatis menjadi Owner** (bisa upload data & manage user)

> Jika tidak bisa signup, kembali ke Supabase → Authentication → Settings → pastikan "Enable email confirmations" dimatikan (untuk development)

---

## STEP 6: Upload Data Pertama (5 menit)

1. Login ke dashboard
2. Klik tab **Admin** (hanya muncul untuk Owner)
3. Di bagian "Upload Data Excel", drag & drop file `.xlsx` dari Google Sheet Anda
4. File otomatis diparse, dan data masuk ke database
5. Kembali ke **Overview** — Anda akan melihat data muncul!

### Upload data bulan-bulan sebelumnya:
- Download/export setiap file Google Sheet bulanan sebagai `.xlsx`
- Upload satu per satu di halaman Admin
- Setiap upload akan menambah data (bukan menimpa), kecuali jika periode bulannya sama

---

## STEP 7: Invite Tim (Opsional)

1. Bagikan URL dashboard ke anggota tim
2. Mereka mendaftar sendiri di halaman login
3. Anda (sebagai Owner) masuk ke **Admin** → scroll ke **Kelola User**
4. Ubah role mereka:
   - **Manager**: Akses semua tab (read-only)
   - **Brand Manager**: Hanya bisa akses tab tertentu (misal: Marketing saja)

---

## Cara Kerja Sehari-hari

### Update data harian:
1. Karyawan update Google Sheet seperti biasa
2. Secara periodik (misal tiap hari/minggu), export Sheet sebagai .xlsx
3. Upload ke Admin dashboard → data langsung update

### Ganti bulan:
1. Karyawan buat file Google Sheet baru untuk bulan baru
2. Export sebagai .xlsx
3. Upload ke Admin dashboard → data bulan baru ditambahkan
4. Data bulan lama **tetap tersimpan** dan bisa diakses

### Melihat data historis:
- Gunakan **Date Range Picker** (icon kalender) di setiap halaman
- Pilih rentang tanggal yang diinginkan
- Data otomatis di-filter

---

## Fitur Dashboard

| Tab | Isi | Siapa yang Akses |
|-----|-----|-----------------|
| **Overview** | KPI utama, tren harian, tabel produk | Semua |
| **Produk** | Card per produk, perbandingan bar chart | Semua |
| **Channel** | Pie chart revenue share, detail channel | Semua |
| **Marketing** | Ad spend harian, ROAS, efisiensi per produk | Sesuai role |
| **Admin** | Upload data, kelola user | Owner saja |

---

## Troubleshooting

### "Belum Ada Data" muncul di dashboard
→ Anda belum upload file Excel. Pergi ke Admin → Upload.

### Upload gagal
→ Pastikan file berformat .xlsx (bukan .csv atau .xls)
→ Pastikan struktur file sama dengan template yang digunakan sekarang

### Tidak bisa login
→ Cek Supabase → Authentication → Users, pastikan akun terdaftar
→ Matikan email confirmation di Supabase → Auth → Settings

### Halaman error / blank
→ Cek Vercel deployment logs
→ Pastikan 3 environment variables sudah benar

---

## Phase Selanjutnya (Coming Soon)

- [ ] Google Sheets auto-sync (tanpa perlu manual export)
- [ ] Alert otomatis (misal: marketing ratio > 40%)
- [ ] Cash flow projection
- [ ] Channel profitability deep dive
- [ ] Custom domain (misal: bi.roove.co.id)

---

*Dashboard ini dibangun dengan Next.js + Supabase + Recharts. Semua data tersimpan persistent di PostgreSQL database.*
