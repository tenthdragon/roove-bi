-- ============================================================
-- 038: Fix DD/MM ↔ MM/DD date swap from CSV upload
-- ============================================================
-- Bug: csv-actions.ts passed raw DD/MM/YYYY timestamps to PostgreSQL
-- without normalization. PG's MDY datestyle interpreted "03/02/2026"
-- (Feb 3) as March 2. Affected ~200 orders from a CSV upload on
-- 2026-03-06 by gina@roove.co.id ("SHIPPED DATE 1-23 FEB 2026 RTI KOLOM.csv").
--
-- Fix: Restore correct timestamps from raw_data (webhook source of truth).
-- Only orders with order_id starting '260203' (Feb 3 prefix) that have
-- shipped_time on Mar 2 but raw_data.shipped_time on Feb 3.
--
-- The code fix is in lib/csv-actions.ts (ts() now converts DD/MM/YYYY → ISO).
-- ============================================================

-- Fix scalev_orders timestamps
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260203%'
  AND shipped_time >= '2026-03-02'
  AND shipped_time < '2026-03-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-03%';

-- Fix scalev_order_lines shipped_time for affected orders
UPDATE scalev_order_lines ol
SET shipped_time = o.shipped_time
FROM scalev_orders o
WHERE ol.scalev_order_id = o.id
  AND o.order_id LIKE '260203%'
  AND o.shipped_time >= '2026-02-03'
  AND o.shipped_time < '2026-02-04'
  AND ol.shipped_time >= '2026-03-02'
  AND ol.shipped_time < '2026-03-03';

-- Also check for Feb 1 ↔ Jan 1 swap (01/02 → 02/01) — unlikely but safe
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260201%'
  AND shipped_time >= '2026-01-02'
  AND shipped_time < '2026-01-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-01%';

-- Fix Feb 2 ↔ Feb 2 — no swap possible (same value), skip

-- Check Feb 4 ↔ Apr 2 (04/02 → 02/04) — would cause errors if DD>12
-- but Feb 4 = 04/02 → PG reads as April 2. Check:
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260204%'
  AND shipped_time >= '2026-04-02'
  AND shipped_time < '2026-04-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-04%';

-- Feb 5 ↔ May 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260205%'
  AND shipped_time >= '2026-05-02'
  AND shipped_time < '2026-05-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-05%';

-- Feb 6 ↔ Jun 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260206%'
  AND shipped_time >= '2026-06-02'
  AND shipped_time < '2026-06-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-06%';

-- Feb 7 ↔ Jul 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260207%'
  AND shipped_time >= '2026-07-02'
  AND shipped_time < '2026-07-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-07%';

-- Feb 8 ↔ Aug 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260208%'
  AND shipped_time >= '2026-08-02'
  AND shipped_time < '2026-08-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-08%';

-- Feb 9 ↔ Sep 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260209%'
  AND shipped_time >= '2026-09-02'
  AND shipped_time < '2026-09-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-09%';

-- Feb 10 ↔ Oct 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260210%'
  AND shipped_time >= '2026-10-02'
  AND shipped_time < '2026-10-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-10%';

-- Feb 11 ↔ Nov 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260211%'
  AND shipped_time >= '2026-11-02'
  AND shipped_time < '2026-11-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-11%';

-- Feb 12 ↔ Dec 2
UPDATE scalev_orders
SET
  shipped_time   = raw_data->>'shipped_time',
  draft_time     = COALESCE(raw_data->>'draft_time', draft_time::text),
  completed_time = COALESCE(raw_data->>'completed_time', completed_time::text),
  synced_at      = NOW()
WHERE order_id LIKE '260212%'
  AND shipped_time >= '2026-12-02'
  AND shipped_time < '2026-12-03'
  AND raw_data->>'shipped_time' LIKE '2026-02-12%';

-- Feb 13+ have DD>12 so PG would reject those → no silent swap possible

-- ── Fix order_lines for ALL affected orders (run after orders are fixed) ──
UPDATE scalev_order_lines ol
SET shipped_time = o.shipped_time
FROM scalev_orders o
WHERE ol.scalev_order_id = o.id
  AND o.order_id LIKE '2602%'
  AND o.raw_data->>'shipped_time' IS NOT NULL
  AND o.shipped_time::date = (o.raw_data->>'shipped_time')::date
  AND ol.shipped_time::date != o.shipped_time::date;

-- ── Refresh materialized views ──
SELECT refresh_order_views();
