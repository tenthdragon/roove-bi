# Roove BI MCP Server

Server MCP ini memberi Claude/Codex akses read-only ke konteks bisnis Roove BI:

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
```

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

Contoh pertanyaan:

- "Ambil `business_snapshot` untuk 2026-05-01 sampai 2026-05-26, lalu cari 3 insight yang tidak obvious."
- "Lihat `roove_dataset_catalog`, lalu cek channel mana yang margin `net_after_mkt`-nya paling tertekan minggu ini."
- "Bandingkan brand mix bulan ini vs bulan lalu dari `daily_product`."
- "Ambil `marketing_spend_summary` untuk bulan ini dan jelaskan cost per marketing channel."
- "Ambil `meta_ads_spend_by_account` untuk MTD, sertakan daily trend, lalu cari account yang CPM/spend-nya anomali."

## Catatan Keamanan

Tool general hanya membaca dataset allowlist dan tidak menyediakan operasi tulis. Dataset customer yang dibuka bersifat agregat, bukan data individual/PII.
