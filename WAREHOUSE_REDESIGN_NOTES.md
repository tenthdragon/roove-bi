# Warehouse Redesign — Requirements & Context

## Background

Saat ini warehouse management dilakukan manual via Google Sheets oleh 2 orang:
- **Jati (PPIC)** — pintu gerbang masuk. Terima barang dari vendor, hitung, input.
- **Fikry (WH Manager)** — pintu gerbang keluar. Catat barang keluar harian.

ScaleV seharusnya handle warehousing tapi fiturnya broken (klien minoritas, tidak diprioritaskan).

## Current State

### Kartu Stock (Fikry) — per warehouse per bulan
File: `KARTU STOCK RTI BTN - APRIL 2026.xlsx`
- **Summary sheet**: 74 produk, kolom: first_day, IN, OUT, last_day, expired_date, price_list, sub_total_value + 60 daily columns (30 hari × IN/OUT)
- **Daily sheets**: 1 sheet per hari kerja (e.g., "1 - RABU", "2 - KAMIS"). Per produk per batch: stok awal, IN, OUT, stok akhir, exp date
- **Sheet Selisih**: Stock opname variance (sebelum SO, sesudah SO, selisih)
- **Mingguan**: Weekly stock opname events

### Summary PPIC (Jati) — multi-tahun planning
File: `summary feb 2026.xlsx`
- **SUMMARY 2026**: Per bulan per produk: kebutuhan awal, pengajuan, actual produksi/pembelian, daily out, % forecast accuracy
- **ITO 2026**: Inventory Turn Over: actual produksi, actual keluar, rata-rata inventory, ITO ratio
- **Pembelian**: Total qty dan harga per produk per tahun
- **Transfer antar gudang**: Log perpindahan stock antar lokasi (historis)

## Physical Setup

- **1 lokasi gudang**: BTN (Banten)
- **4 business entities**: RTI, RLB, JHN, RLT (stock terpisah per entity di gudang yang sama)

## Stock IN Sources (Jati input manual)
1. **Vendor packaging** — kemasan, box, dll
2. **Vendor produk** — finished goods dari produksi
3. **Inter-company transfer masuk** — dari entity lain
4. **RTS (Return to Sender)** — retur marketplace yang kembali ke gudang

## Stock OUT Destinations
1. **Shipped order** → **OTOMATIS dari ScaleV** (ini key automation)
2. **Inter-company transfer keluar** → manual input
3. **Dispose/expired** → manual input

## Key Design Decisions

### Fikry's daily sheet bisa dihapus
Jika app otomatis mengurangi stok saat ScaleV shipped, ~90% stock OUT tidak perlu manual. Daily sheet Fikry diganti app. Yang tersisa manual: transfer dan dispose.

### ScaleV Integration
- Webhook `scalev_orders` sudah ada — saat order status = shipped/completed, stok harus berkurang
- `scalev_order_lines` punya `product_name`, `product_type`, `quantity` — perlu mapping ke warehouse SKU
- Perlu mapping: `product_name` (ScaleV) → `warehouse_product` (gudang). Nama bisa beda (e.g., "Roove Blueberry - 20 Sc" di ScaleV vs "ROOVE BLUEBERI 20" di gudang)

### Product Granularity
Gudang tracking lebih granular dari ScaleV:
- Per batch/expired date (e.g., "DRHYUN HIGH FIBER 30 SC" batch "20/02/26 - 23/01/26")
- Bonus items tracked terpisah (Shaker, Baby Gold, Jam Tangan)
- Packaging materials (kemasan, cube, goddie bag)
- FG (Finished Goods) vs sachet mentah

### PPIC Planning Features
Jati butuh:
- **Kebutuhan awal bulan** = projected demand
- **Pengajuan ke vendor** = PO quantity
- **Actual pembelian** = received quantity
- **Daily out average** = burn rate
- **% forecast accuracy** = actual vs forecast
- **ITO** = inventory turnover ratio
- **Reorder alert** = ketika stok < threshold

## Existing Database Schema (from migration 019)

Tables sudah ada tapi terlalu simple:
- `warehouse_stock_summary` — monthly summary (no batch/expiry tracking)
- `warehouse_daily_stock` — daily IN/OUT (no batch)
- `warehouse_stock_opname` — SO events
- `warehouse_sheet_connections` — Google Sheets sync config

## What Needs to Change

### New/Modified Tables Needed
1. **`warehouse_products`** — master product list with SKU mapping to ScaleV
2. **`warehouse_stock_ledger`** — every stock movement as a ledger entry (IN/OUT/ADJUST/TRANSFER/DISPOSE)
3. **`warehouse_batches`** — track stock per batch + expiry date
4. **`warehouse_purchase_orders`** — PO from PPIC to vendor
5. **`warehouse_transfers`** — inter-company transfer log
6. **Modify existing triggers** — on `scalev_order_lines` shipped → auto-create stock OUT entry

### Automation Flow
```
ScaleV Webhook (order shipped)
  → scalev_order_lines
  → map product_name to warehouse_product
  → deduct from warehouse_stock_ledger (FIFO by expiry date)
  → update running balance

Jati (manual input in app)
  → Stock IN: vendor delivery received
  → Stock IN: RTS received
  → Transfer: inter-company
  → Dispose: expired items
  → PO: create purchase order
  → SO: stock opname reconciliation
```

### Dashboard Features
- **Real-time stock balance** per product per batch per entity
- **Daily movement log** (auto from ScaleV + manual)
- **Expiry monitor** (existing, but enhanced with batch data)
- **Stock opname** (existing)
- **PPIC planning**: demand forecast, PO tracking, ITO calculation
- **Reorder alerts**: configurable threshold per product
- **Transfer log**: inter-company movements

## Files Referenced
- `/app/dashboard/warehouse/page.tsx` — current warehouse page (695 lines)
- `/lib/warehouse-actions.ts` — server actions (298 lines)
- `/lib/warehouse-parser.ts` — Google Sheets parser (435 lines)
- `/supabase/migrations/019_warehouse_tables.sql` — current schema
- `/app/api/warehouse-sync/route.ts` — sync API
- `/components/WarehouseSheetManager.tsx` — admin connection manager
- Sample files: `KARTU STOCK RTI BTN - APRIL 2026.xlsx`, `summary feb 2026.xlsx`
