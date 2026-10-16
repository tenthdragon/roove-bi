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
- `marketing_spend_summary`: total marketing spend dan breakdown per source/store/data source.
- `meta_ads_spend_by_account`: breakdown Meta Ads spend per ad account.
- `meta_ad_funnel_catalog`: konfigurasi funnel tersimpan, definisi metrik, akun Meta aktif, brand, dan revisi data. Gunakan untuk menemukan `funnel_id` dan `brand_id`.
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
