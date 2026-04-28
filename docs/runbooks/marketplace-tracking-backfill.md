# Marketplace Tracking Backfill

Tujuan script ini adalah mengisi `scalev_orders.marketplace_tracking_number` dari `raw_data` order marketplace lama agar batch `Marketplace Intake -> Promote App` bisa mengikat row webhook existing lewat tracking.

Lokasi script:
- `scripts/ops/backfill-marketplace-tracking.ts`

Command dasar:

```bash
npm run backfill:marketplace-tracking
```

Mode penting:
- Dry-run penuh:

```bash
npm run backfill:marketplace-tracking -- --batch-size=1000
```

- Apply penuh:

```bash
npm run backfill:marketplace-tracking -- --apply --batch-size=1000 --concurrency=10
```

- Batasi hanya histori sampai tanggal tertentu:

```bash
npm run backfill:marketplace-tracking -- --through-date=2026-04-30
```

- Lanjut dari `scalev_orders.id` tertentu:

```bash
npm run backfill:marketplace-tracking -- --start-id=117046 --apply --batch-size=1000 --concurrency=10
```

Argumen:
- `--apply`: benar-benar update database. Tanpa ini script hanya scan.
- `--batch-size=<n>`: jumlah row per fetch.
- `--concurrency=<n>`: jumlah update paralel per chunk apply.
- `--start-id=<id>`: mulai scan setelah `scalev_orders.id` tertentu.
- `--max-batches=<n>`: batasi jumlah batch scan.
- `--through-date=YYYY-MM-DD`: hanya proses order dengan prefix shipment sampai tanggal itu.

Output summary:
- `scanned`: total row yang discan dengan `marketplace_tracking_number IS NULL`
- `changed`: row yang tracking-nya bisa diekstrak dari `raw_data`
- `updated`: row yang benar-benar ditulis saat mode `--apply`

Catatan:
- Script ini tidak mengubah revenue, shipping, atau marketplace fee.
- Script ini hanya mengisi `marketplace_tracking_number`.
- Nilai tracking dipakai oleh jalur `Promote App` sebagai fallback matching ketika `external_id` tidak cukup.
