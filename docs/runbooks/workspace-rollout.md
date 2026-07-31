# Workspace rollout: Roove dan Apurva

Implementasi ini menambahkan tenant `workspace` tanpa memindahkan atau
menghapus data lama:

- Seluruh user dan data existing dibackfill ke **Roove Workspace**.
- **Apurva Workspace** dibuat aktif dalam keadaan kosong.
- Data bisnis, integrasi, tim, biaya, dan inventory selalu membawa
  `workspace_id`.
- Matriks role/permission disalin sebagai template awal lalu dikelola terpisah
  untuk setiap workspace.
- Gudang fisik `BTN` dapat dipakai bersama, tetapi produk dan pergerakan stok
  tetap dimiliki serta difilter per workspace.
- Akun `workspace_owner` memiliki kontrol penuh hanya di workspace tempat ia
  menjadi anggota. Role ini tidak menjadikannya platform owner.

## Urutan deployment

Jalankan migration berikut secara berurutan pada environment tujuan:

1. `163_workspace_foundation.sql`
2. `164_workspace_data_ownership.sql`
3. `165_workspace_read_models.sql`
4. `166_workspace_fixed_costs.sql`
5. `167_workspace_inventory_ledger.sql`
6. `168_workspace_summary_pipeline.sql`
7. `169_activate_apurva_workspace.sql`
8. `170_profiles_login_access_hotfix.sql`

Deploy aplikasi hanya setelah seluruh migration berhasil. Jangan menjalankan
aplikasi workspace-aware di atas schema lama.

Jika migration 163 sudah diterapkan pada aplikasi existing dan user non-owner
tidak dapat melewati bootstrap dashboard, migration 170 boleh dan sebaiknya
dijalankan segera sebelum melanjutkan 168–169. Migration ini hanya bergantung
pada foundation dari 163.

### Jika migration 164 timeout

Versi migration 164 di repository menggunakan constant default PostgreSQL agar
data lama menjadi milik Roove tanpa menjalankan `UPDATE` penuh pada setiap
tabel. Foreign key historis juga dibuat `NOT VALID`; aturan tersebut langsung
berlaku untuk write baru, sedangkan validasi data lama dapat dijalankan terpisah
setelah rollout.

Jika SQL Editor pernah menampilkan `upstream timeout`, pastikan transaksi lama
rollback sebelum mencoba ulang:

```sql
select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'scalev_orders'
    and column_name = 'workspace_id'
) as migration_164_committed;
```

Hasil `false` berarti aman menjalankan ulang file 164 versi terbaru. Hasil
`true` berarti jangan langsung mengulang; jalankan bagian verifikasi di bawah
untuk memastikan migration sudah commit seluruhnya.

## Konfigurasi Apurva

Sediakan credential server-side berikut di environment aplikasi:

- `APURVA_META_ACCESS_TOKEN`
- `APURVA_META_BUSINESS_ID`
- `APURVA_WHATSAPP_ACCESS_TOKEN`

Koneksi ScaleV, Shopee, rekening bank, brand, dan sumber data lainnya dibuat
dari dalam Apurva Workspace. Jangan menggunakan credential atau account ID
Roove.

## Membuat akun CEO Apurva

1. Login sebagai platform owner.
2. Pilih **Apurva Workspace** dari workspace switcher.
3. Buka **Admin → Users**.
4. Invite email baru CEO dengan role **Owner Workspace / CEO**.
5. Bagikan link set password yang dihasilkan.

Untuk memastikan akun CEO hanya melihat Apurva, gunakan alamat email yang belum
menjadi user Roove. User baru tersebut hanya mendapat satu membership:
Apurva Workspace.

## Fixed cost

Apurva memakai halaman **Fixed & Recurring Costs**. Setiap pengeluaran memiliki
nominal per unit, jumlah unit, frekuensi, interval, tanggal berlaku, jatuh tempo,
dan kategori. Dashboard mengubah rincian aktif menjadi ekuivalen biaya bulanan.

Roove tetap memakai nilai `monthly_overhead` lama sampai setidaknya satu rincian
fixed cost dibuat di Roove. Dengan demikian perilaku existing tidak berubah.

## Batas rollout awal

Pada Apurva, fitur berikut sementara disembunyikan dan ditolak pula pada
server-side karena modul legacy-nya belum seluruhnya tenant-aware:

- PPIC
- Warehouse Settings
- Marketplace Intake
- Upload CSV order legacy (gunakan koneksi ScaleV workspace)
- Shopee setup yang masih bergantung pada mapping Marketplace Intake
- Customers
- Brand Analysis
- Sales Channel Analysis

Warehouse Apurva sudah dapat memakai master produk dan pencatatan stok manual
yang terisolasi. Produk Apurva menggunakan entity `APV` di gudang fisik `BTN`.
Pemotongan stok otomatis dari ScaleV belum diaktifkan untuk Apurva; webhook
Apurva tidak akan menjalankan resolver FIFO legacy milik Roove.

## Verifikasi setelah migration

Jalankan query read-only berikut dari SQL editor:

```sql
select id, slug, name, status
from public.workspaces
order by slug;

select
  w.slug,
  count(distinct wm.user_id) as members
from public.workspaces w
left join public.workspace_memberships wm
  on wm.workspace_id = w.id
 and wm.status = 'active'
group by w.slug
order by w.slug;

select
  w.slug,
  count(distinct b.id) as brands,
  count(distinct so.id) as scalev_orders,
  count(distinct wp.id) as warehouse_products
from public.workspaces w
left join public.brands b on b.workspace_id = w.id
left join public.scalev_orders so on so.workspace_id = w.id
left join public.warehouse_products wp on wp.owner_workspace_id = w.id
group by w.slug
order by w.slug;
```

Sebelum input Apurva dimulai, hasil yang diharapkan adalah data existing berada
di `roove`, sedangkan hitungan data bisnis `apurva` masih nol.
