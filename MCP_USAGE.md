# Roove BI MCP Server

Server MCP ini memberi Claude/Codex akses read-only ke satu workspace bisnis:

- snapshot KPI lintas sales, margin, marketing, customer, dan finance
- katalog dataset aman untuk drilldown
- query dataset read-only berbasis allowlist
- tool PPIC dan customer analysis yang sudah ada

## Build

```bash
npm --prefix mcp-server install
npm --prefix mcp-server run build
```

Server membaca kredensial dari `.env.local` di root repo:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
MCP_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
```

`MCP_WORKSPACE_ID` wajib diisi. Jalankan instance MCP terpisah untuk setiap
workspace yang ingin diakses; server tidak memiliki fallback ke Roove.

## Claude Desktop

Tambahkan ke konfigurasi Claude Desktop MCP:

```json
{
  "mcpServers": {
    "roove-bi": {
      "command": "node",
      "args": [
        "/Users/armyalghifari/Documents/Github/roove-bi/mcp-server/dist/index.js"
      ]
    }
  }
}
```

Restart Claude Desktop setelah konfigurasi disimpan.

## Codex

Gunakan command yang sama saat mendaftarkan MCP server lokal:

```bash
node /Users/armyalghifari/Documents/Github/roove-bi/mcp-server/dist/index.js
```

## Tool Utama

- `roove_mcp_guide`: orientasi cepat untuk LLM.
- `business_snapshot`: ringkasan eksekutif berdasarkan rentang tanggal.
- `roove_dataset_catalog`: daftar dataset aman dan kolom yang boleh dibaca.
- `roove_read_dataset`: drilldown read-only dengan filter sederhana.
- `marketing_spend_summary`: total marketing spend dengan filter kanonis `brand_id` / `business_code`; breakdown kanal, brand, business, label historis, dan data source.
- `meta_ads_spend_by_account`: breakdown Meta Ads spend per ad account.
- `meta_ad_funnel_catalog`: katalog workspace, business, brand, toko operasional, relasi owner/seller/operator dan alias; juga funnel/akun/revisi. `dimensions_only:true` menghindari payload konfigurasi funnel saat hanya butuh identitas.
- `meta_ad_funnel_report`: report granular dari RPC `get_meta_ad_report`, sama dengan dashboard Meta Ad Funnel. Mendukung `group_by=ad|landing_page`, filter `cep`, `intention`, `objective`, serta `view=overview|daily|trends|creatives`.

### Meta Ad Funnel

Tool funnel hanya membaca data hasil sinkronisasi yang sudah ada; tidak memicu sync
atau mengubah konfigurasi. Scope workspace berasal dari konfigurasi server.
Tanggal `from`/`to` menggunakan WIB, maksimal 93 hari, dan dibatasi sampai kemarin
seperti dashboard. Respons menyertakan rentang aktual yang digunakan.

Mulai dengan `meta_ad_funnel_catalog`, lalu panggil `meta_ad_funnel_report`:

```json
{
  "from": "2026-10-01",
  "to": "2026-10-15",
  "group_by": "ad",
  "view": "overview",
  "filters": { "cep": "joint", "intention": "conv" },
  "limit": 50,
  "offset": 0
}
```

Tanpa `funnel_id`, report memilih funnel landing-page pertama seperti dashboard;
jika belum ada, semua akun aktif digunakan tanpa filter nama. `brand_id` menerima
ID brand dari katalog atau `__unmapped__`. Untuk detail creative atau riwayat satu
grup, gunakan `group_key` dari respons overview dengan filter/agregasi yang sama.
`period=week|month` berlaku untuk trends. `offset`/`limit` memaginasi groups,
history, atau creatives; total overview tetap mencakup seluruh pilihan.

`report.summary` dan `report.previous` berisi total event mentah; hitung rasio
dari total pembilang/penyebut, bukan rata-rata rasio iklan. Penyebut nol berarti
rasio tidak tersedia. `coverage_gaps` hanya tersedia pada overview; daily/trends
menggunakan `complete`, `partial`, dan `historyComplete` dari RPC. Data belum
lengkap tidak boleh dianggap sebagai performa nol. Beberapa mata uang dalam
satu report ditolak. Revisi menunjukkan perubahan data, bukan waktu sync sukses.

Contoh pertanyaan:

- "Ambil `business_snapshot` untuk 2026-05-01 sampai 2026-05-26, lalu cari 3 insight yang tidak obvious."
- "Lihat `roove_dataset_catalog`, lalu cek channel mana yang margin `net_after_mkt`-nya paling tertekan minggu ini."
- "Bandingkan brand mix bulan ini vs bulan lalu dari `daily_product`."
- "Ambil `marketing_spend_summary` untuk bulan ini dan jelaskan cost per marketing channel."
- "Ambil `meta_ads_spend_by_account` untuk MTD, sertakan daily trend, lalu cari account yang CPM/spend-nya anomali."

## Catatan Keamanan

Tool general hanya membaca dataset allowlist dan tidak menyediakan operasi
tulis. Semua query dan RPC dikunci ke `MCP_WORKSPACE_ID`. Dataset customer yang
dibuka bersifat agregat, bukan data individual/PII.

## Cloudflare Worker (mode HTTP, cakupan marketing)

Tool yang sama bisa dijalankan sebagai Cloudflare Worker, supaya bisa dipanggil dari
luar laptop (misalnya agent Basecamp). Definisi tool ada di
`mcp-server/src/server.ts` dan dipakai bersama oleh mode stdio (`index.ts`) dan
Worker (`worker.ts`).

Worker ini **tidak memakai service role key**. Ia masuk ke database sebagai role
read-only `mcp_marketing_reader` (migrasi `237_mcp_marketing_reader.sql`), yang
hanya bisa membaca skema `mcp_marketing`: view Meta Ads/marketing spend, metadata
dimensi non-secret (migrasi `238_mcp_marketing_dimensions.sql`), dan
satu pembungkus `get_meta_ad_report`, semuanya terkunci ke `workspace_id` yang ada
di dalam token. Tidak ada akses ke tabel finance, gudang, PPIC, atau data pelanggan.

Tool yang tersedia di Worker: `roove_mcp_guide`, `meta_ad_funnel_catalog`,
`meta_ad_funnel_report`, `marketing_spend_summary`, `meta_ads_spend_by_account`.
Tool lain hanya ada di mode stdio lokal.

Kontrak dimensi v2, perubahan kompatibilitas, status atribusi, dan urutan rilis:
[MCP dimension scopes](docs/runbooks/mcp-dimension-scopes.md).

Endpoint `POST /mcp` wajib memakai header `Authorization: Bearer <MCP_AUTH_TOKEN>`.
Satu deployment = satu workspace.

### Setup pertama kali

1. Terapkan migrasi 237 lalu 238 ke database (hanya yang belum terpasang, lewat alur rilis migrasi yang biasa).
   Uji dulu di stack lokal: `npm run test:mcp-reader-db`.
2. Dashboard Supabase → Settings → API → **Exposed schemas**: tambahkan
   `mcp_marketing`. Tanpa ini PostgREST menolak skema tersebut.
3. Buat token database untuk Worker. Ambil **JWT Secret** (Settings → API → JWT
   Settings; secret HS256 legacy harus masih aktif), lalu dari folder repo:

   ```bash
   SUPABASE_JWT_SECRET='...' node mcp-server/scripts/mint-mcp-jwt.mjs \
     --workspace <MCP_WORKSPACE_ID> --days 365
   ```

   Secret hanya dibaca dari environment dan tidak disimpan di mana pun. Token
   yang tercetak berisi `role: mcp_marketing_reader` dan `workspace_id`.
4. Simpan semua binding Worker sebagai secret. Tiga nilai pertama tidak sensitif,
   tetapi tetap disimpan sebagai secret agar deployment berikutnya tidak bisa
   menimpa konfigurasi produksi dengan placeholder dari source code:

   ```bash
   npm --prefix mcp-server install
   cd mcp-server
   npx wrangler login
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_ANON_KEY    # anon/publishable key
   npx wrangler secret put MCP_WORKSPACE_ID
   npx wrangler secret put SUPABASE_MCP_JWT     # tempel token dari langkah 3
   openssl rand -hex 32                         # token untuk pemanggil, simpan di password manager
   npx wrangler secret put MCP_AUTH_TOKEN
   npm run deploy
   ```

Cek: `curl https://roove-bi-mcp.<subdomain>.workers.dev/health` harus mengembalikan
`{"ok":true,"scope":"marketing"}`. `/health` juga menolak JWT yang role atau
workspace-nya tidak cocok dengan konfigurasi, atau yang sudah kedaluwarsa.

Untuk menguji dari Claude Desktop, gunakan `mcp-remote` dengan header token:

```json
{
  "mcpServers": {
    "roove-bi-remote": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://roove-bi-mcp.<subdomain>.workers.dev/mcp",
        "--header", "Authorization: Bearer ${MCP_AUTH_TOKEN}"
      ],
      "env": { "MCP_AUTH_TOKEN": "<token>" }
    }
  }
}
```

### Mencabut atau memperluas akses

- Mencabut token: `DROP ROLE` tidak perlu; cukup `REVOKE mcp_marketing_reader FROM
  authenticator` (PostgREST tidak bisa lagi memakai role itu), lalu terbitkan token
  baru setelah dipulihkan. Mengganti JWT secret juga membatalkan semua token.
- Agent lain dengan cakupan berbeda (misalnya finance) dibuat sebagai role, skema,
  dan Worker **terpisah**, bukan dengan menambah izin ke `mcp_marketing_reader`.

### Catatan keamanan yang masih terbuka

Secara default PostgreSQL memberi hak EXECUTE pada semua fungsi di skema `public`
kepada PUBLIC. Role reader tidak punya hak SELECT pada tabel `public`, sehingga
fungsi biasa akan gagal, tetapi fungsi `SECURITY DEFINER` yang tidak memeriksa
`auth.uid()` secara teori masih bisa dipanggil jika token bocor dan pemanggil
memakai `Content-Profile: public`. Penutupan menyeluruh (`REVOKE EXECUTE ON ALL
FUNCTIONS IN SCHEMA public FROM PUBLIC` plus default privileges) memengaruhi seluruh
API, jadi dikerjakan sebagai perubahan terpisah yang diuji di stack lokal.
