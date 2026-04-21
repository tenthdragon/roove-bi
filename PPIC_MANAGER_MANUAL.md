# Manual Singkat Menu PPIC

Dokumen ini adalah panduan ringkas untuk PPIC Manager dalam mengoperasikan seluruh menu `Product Planning & Inventory Control` pada dashboard.

Menu PPIC saat ini terdiri dari 4 halaman:

1. `Inventory Turn Over`
2. `Reorder Point`
3. `Demand Planning`
4. `Purchase Orders`

## 1. Gambaran Umum Alur Kerja

Secara praktis, menu PPIC dipakai dengan urutan seperti ini:

1. Mulai dari `Inventory Turn Over` untuk melihat kesehatan perputaran stok.
2. Lanjut ke `Reorder Point` untuk menentukan prioritas replenishment.
3. Gunakan `Demand Planning` untuk memantau target demand dan pencapaian bulan berjalan.
4. Eksekusi kebutuhan pembelian melalui `Purchase Orders`.

Jika dipakai rutin, keempat halaman ini saling melengkapi:

1. `ITO` membantu membaca efisiensi stok.
2. `ROP` membantu memutuskan kapan harus reorder.
3. `Demand Planning` membantu membaca arah demand.
4. `Purchase Orders` membantu menjalankan tindak lanjut pembelian.

## 2. Inventory Turn Over

### Tujuan

Halaman ini dipakai untuk membaca:

1. Produk mana yang stoknya berputar cepat.
2. Produk mana yang stoknya lambat bergerak.
3. Produk mana yang cenderung menjadi dead stock.
4. Nilai stok yang sedang tertahan di gudang.

### Kontrol yang tersedia

1. Pilihan horizon `3 Bulan`, `6 Bulan`, `12 Bulan`
2. `Cari produk...`
3. Filter `Semua Entity`
4. Filter stok:
   `Aktif (ada movement)`
   `Ada stok`
   `Dead stock`
   `Semua produk`
5. Toggle sumber:
   `Warehouse PoV`
   `Scalev PoV`

### Arti tampilan

Ringkasan atas menampilkan:

1. `SKU`
2. `Nilai Stok (HPP)`
3. `Nilai Stok (Harga Jual)`

Kolom tabel utama:

1. `Produk`
2. `Entity`
3. `Stock`
4. `Avg Out/Hari`
5. `Hari Stok`
6. Kolom ITO per bulan

### Cara membaca angka

1. `ITO`
   Rumus di sistem: `ITO = (Monthly Out x 12) / Current Stock`
2. `Hari Stok`
   Rumus di sistem: `Stock / Avg Out per Hari`

Interpretasi warna:

1. ITO hijau: `>= 6`
2. ITO kuning: `3 - 6`
3. ITO merah: `< 3`
4. Hari stok hijau: `> 7`
5. Hari stok kuning: `3 - 7`
6. Hari stok merah: `< 3`

### Cara pakai yang disarankan

1. Gunakan `Aktif (ada movement)` untuk evaluasi SKU yang benar-benar bergerak.
2. Gunakan `Dead stock` untuk mencari stok yang masih ada tetapi tidak bergerak.
3. Gunakan `Scalev PoV` sebagai pembacaan demand keluar berbasis transaksi Scalev.
4. Gunakan `Warehouse PoV` bila ingin membandingkan dari sudut data warehouse.
5. Urutkan kolom `Hari Stok`, `Stock`, atau `Avg Out/Hari` untuk mempercepat analisis.

### Kapan halaman ini paling berguna

1. Saat evaluasi stok lambat bergerak.
2. Saat rapat bulanan mengenai efisiensi inventory.
3. Saat ingin menentukan mana produk yang sehat, lambat, atau berisiko menumpuk.

## 3. Reorder Point

### Tujuan

Halaman ini dipakai untuk menentukan apakah stok saat ini:

1. Masih aman
2. Sudah perlu direorder
3. Sudah masuk kondisi kritis

### Kontrol yang tersedia

1. Horizon demand `30 Hari`, `60 Hari`, `90 Hari`
2. `Cari produk...`
3. Filter `Semua Entity`
4. `Sembunyikan demand = 0`

### KPI utama

1. `Critical`
   Stock di bawah safety stock
2. `Perlu Reorder`
   Stock di bawah ROP
3. `OK`
   Stock masih cukup

### Arti kolom penting

1. `Stock`
   Stok saat ini
2. `Avg/Day`
   Rata-rata demand harian
3. `Lead Time`
   Waktu tunggu pasokan
4. `Safety Days`
   Buffer hari pengaman
5. `Safety Qty`
   Jumlah stok buffer
6. `ROP`
   Titik reorder
7. `Days Left`
   Perkiraan berapa hari stok masih cukup
8. `Status`
   Prioritas tindak lanjut

Rumus sistem:

`ROP = (Avg Daily x Lead Time) + Safety Stock`

### Arti status

1. `CRITICAL`
   Harus diprioritaskan segera
2. `REORDER`
   Sudah waktunya diproses replenishment
3. `OK`
   Belum perlu tindakan segera

### Cara mengubah parameter

`Lead Time` dan `Safety Days` bisa diubah langsung dari tabel:

1. Klik angka pada kolom `Lead Time` atau `Safety Days`
2. Masukkan angka baru
3. Tekan `Enter` atau klik area lain untuk menyimpan

Gunakan perubahan ini hanya jika ada alasan operasional nyata, misalnya:

1. Supplier lebih lambat dari biasanya
2. Buffer stok perlu dinaikkan
3. Risiko keterlambatan pengiriman sedang meningkat

### Cara pakai yang disarankan

1. Fokus dulu ke item `CRITICAL`
2. Lanjutkan ke item `REORDER`
3. Pakai filter entity agar keputusan pembelian lebih fokus
4. Gunakan horizon `90 Hari` untuk pembacaan lebih stabil
5. Gunakan `30 Hari` bila ingin melihat respons jangka pendek

## 4. Demand Planning

### Tujuan

Halaman ini dipakai untuk memantau demand plan dan realisasi barang keluar.

Halaman ini menjawab pertanyaan seperti:

1. Apakah demand bulan berjalan masih sesuai target?
2. Produk mana yang tertinggal dari pace?
3. Produk mana yang perlu override demand manual?

### Kontrol yang tersedia

1. Mode tampilan:
   `Mingguan`
   `Bulanan`
2. Pilihan `bulan`
3. Pilihan `tahun`
4. `Cari produk...`
5. Filter `Semua Entity`
6. `Sembunyikan demand = 0`
7. Tombol `Inisialisasi dari Scalev`

### Kapan klik Inisialisasi dari Scalev

Gunakan tombol ini bila:

1. Data demand planning untuk bulan yang dipilih belum muncul
2. Bulan baru baru saja dimulai
3. Anda ingin membuat baseline demand otomatis dari data Scalev

Jika data bulan belum tersedia, sistem memang akan meminta user untuk klik tombol ini.

### Mode Mingguan

Mode ini dipakai untuk memantau progres per minggu.

Kolom utama:

1. `Produk`
2. `Entity`
3. `Target/BLN`
4. `W1` sampai `W4`
5. Setiap minggu menampilkan `Target` dan `Actual`

Catatan penting:

1. Pada minggu berjalan, target diprorata sesuai hari yang sudah lewat
2. Warna hijau berarti pace masih sehat
3. Warna kuning berarti mulai tertinggal
4. Warna merah berarti tertinggal jauh

### Mode Bulanan

Mode ini dipakai untuk pembacaan performa bulan berjalan secara ringkas.

Kolom utama:

1. `Demand`
   Demand otomatis hasil sistem
2. `Override`
   Demand manual bila ingin mengganti demand otomatis
3. `Effective`
   Nilai demand yang dipakai sistem
4. `Actual In`
   Barang masuk
5. `Actual Out`
   Barang keluar
6. `Prorated Target`
   Target yang seharusnya sudah tercapai sampai hari ini
7. `Variance`
   Selisih antara target berjalan dan actual out
8. `Projected`
   Proyeksi pencapaian hingga akhir bulan
9. `Pace`
   Status performa demand bulan berjalan

### Arti Pace

1. `On Track`
   Proyeksi masih sehat
2. `Behind`
   Mulai tertinggal
3. `Far Behind`
   Tertinggal cukup jauh dan perlu perhatian

### Rumus penting yang dipakai sistem

1. `Effective = Override` bila override diisi
2. `Effective = Demand` bila override kosong
3. `Prorated Target = Effective x (hari berjalan / total hari bulan)`
4. `Projected = Actual Out x (total hari bulan / hari berjalan)`

### Cara mengubah Override

1. Buka mode `Bulanan`
2. Klik angka pada kolom `Override`
3. Masukkan angka baru
4. Tekan `Enter` atau klik area lain untuk menyimpan

Jika ingin kembali ke demand otomatis:

1. Klik kolom `Override`
2. Hapus isinya sampai kosong
3. Simpan kembali

Setelah dikosongkan, sistem akan kembali memakai demand otomatis.

### Cara pakai yang disarankan

1. Di awal bulan, lakukan inisialisasi bila data belum ada
2. Review produk dengan `Far Behind` dan `Behind`
3. Override hanya untuk produk yang memang perlu intervensi manual
4. Gunakan mode `Mingguan` untuk monitoring ritme
5. Gunakan mode `Bulanan` untuk keputusan demand plan yang lebih ringkas

## 5. Purchase Orders

### Tujuan

Halaman ini dipakai untuk:

1. Membuat draft PO
2. Submit PO
3. Memantau status PO
4. Menerima barang dari PO
5. Membatalkan PO bila diperlukan

### KPI utama

1. `Total PO`
2. `Submitted`
3. `Partial`
4. `Overdue`

### Filter yang tersedia

1. `Cari PO / Vendor...`
2. Filter `Semua Status`
3. Filter `Semua Entity`
4. Tombol `+ Buat PO`

### Arti status PO

1. `Draft`
   PO sudah dibuat tetapi belum disubmit
2. `Submitted`
   PO sudah dikirim/proses pembelian sudah berjalan
3. `Partial`
   Barang sudah diterima sebagian
4. `Completed`
   Barang sudah diterima penuh
5. `Cancelled`
   PO dibatalkan

### Cara membuat PO

1. Klik `+ Buat PO`
2. Pilih `Vendor`
3. Pilih `Entity`
4. Isi `Tanggal PO`
5. Isi `Exp. Delivery` bila sudah diketahui
6. Isi `Catatan` bila perlu
7. Tambahkan item PO:
   cari produk
   isi qty
   isi harga per unit
8. Isi `Ongkir` dan `Biaya Lain` bila ada
9. Klik `Simpan Draft`

Catatan:

1. Jika vendor berstatus PKP, sistem akan menghitung PPN otomatis
2. Total PO akan menyesuaikan subtotal, ongkir, biaya lain, dan PPN bila berlaku

### Cara review dan submit PO

Dari tabel daftar PO:

1. Klik `Detail` untuk melihat isi PO
2. Jika status masih `Draft`, klik `Submit` dari daftar atau dari halaman detail

Setelah disubmit, PO akan berpindah dari tahap draft ke proses pembelian aktif.

### Cara menerima barang dari PO

PO dengan status `Submitted` atau `Partial` bisa diterima melalui tombol `Terima`.

Langkahnya:

1. Klik `Terima` pada PO yang relevan
2. Cek item yang benar-benar diterima
3. Isi `Qty Diterima`
4. Isi `Batch Code`
5. Isi `Expired Date` bila produk memerlukannya
6. Isi atau koreksi `Ongkir` dan `Biaya Lain` seluruh PO bila perlu
7. Klik `Terima Barang`

Catatan penting:

1. `Batch Code` wajib diisi untuk item yang diterima
2. Qty diterima tidak boleh melebihi sisa qty PO
3. Sistem menampilkan preview HPP per unit bila data harga tersedia

### Cara membatalkan PO

PO yang masih `Draft` atau `Submitted` dapat dibatalkan.

Langkahnya:

1. Klik `Batal` dari daftar PO atau `Batalkan PO` dari detail
2. Konfirmasi pembatalan

Gunakan pembatalan hanya jika memang diputuskan bahwa PO tidak akan dilanjutkan.

### Cara memakai halaman ini dengan efektif

1. Pantau KPI `Overdue` secara rutin
2. Gunakan filter status untuk fokus ke `Submitted` dan `Partial`
3. Pastikan item penting segera diproses receive setelah barang datang
4. Gunakan detail PO untuk audit qty request, qty received, dan nilai pembelian

## 6. Rekomendasi Rutinitas PPIC Manager

### Harian

1. Cek `Reorder Point`
2. Cek `Purchase Orders` untuk PO submitted, partial, dan overdue
3. Pastikan item kritis tidak menuju stockout

### Mingguan

1. Cek `Demand Planning` mode `Mingguan`
2. Cek `Inventory Turn Over` untuk SKU lambat bergerak
3. Review item dengan `Hari Stok` terlalu tinggi atau ITO rendah

### Bulanan

1. Inisialisasi `Demand Planning` untuk bulan baru bila diperlukan
2. Review demand override
3. Evaluasi dead stock lewat `Inventory Turn Over`
4. Review efektivitas reorder dan realisasi pembelian

## 7. Praktik Baik

1. Jangan terlalu sering override demand tanpa alasan bisnis yang jelas
2. Sesuaikan `Lead Time` dan `Safety Days` hanya jika kondisi supply memang berubah
3. Prioritaskan produk `CRITICAL` sebelum `REORDER`
4. Gunakan `Overdue` PO sebagai daftar prioritas follow-up ke vendor
5. Gunakan `Dead stock` di ITO untuk bahan evaluasi promosi, bundling, atau stop pembelian

## 8. Ringkasan Cepat

1. `Inventory Turn Over` untuk membaca kesehatan perputaran stok
2. `Reorder Point` untuk keputusan reorder
3. `Demand Planning` untuk kontrol target demand dan pencapaian
4. `Purchase Orders` untuk eksekusi pembelian dan penerimaan barang

Dokumen ini bisa dipakai sebagai manual kerja singkat. Jika diperlukan, saya bisa bantu ubah lagi menjadi versi SOP formal, versi training 1 halaman, atau versi yang lebih singkat untuk dibagikan ke manajer PPIC.
