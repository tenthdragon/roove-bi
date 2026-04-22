-- ============================================================
-- Marketplace intake source order date
-- ============================================================
-- Distinguishes the marketplace order date carried by the file
-- from the later time the batch was uploaded into Roove BI.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS source_order_date DATE;

WITH inferred_dates AS (
  SELECT
    o.batch_id,
    MIN(((o.raw_meta ->> 'createdAt')::timestamptz AT TIME ZONE 'Asia/Jakarta')::date) AS source_order_date
  FROM marketplace_intake_orders o
  WHERE COALESCE(o.raw_meta ->> 'createdAt', '') <> ''
  GROUP BY o.batch_id
)
UPDATE marketplace_intake_batches b
SET source_order_date = inferred_dates.source_order_date
FROM inferred_dates
WHERE b.id = inferred_dates.batch_id
  AND b.source_order_date IS NULL;

UPDATE marketplace_intake_batches
SET source_order_date = (confirmed_at AT TIME ZONE 'Asia/Jakarta')::date
WHERE source_order_date IS NULL;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ALTER COLUMN source_order_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_source_order_date
  ON marketplace_intake_batches (source_order_date, confirmed_at, id);

COMMENT ON COLUMN marketplace_intake_batches.source_order_date IS
  'Marketplace order date represented by the uploaded file, separate from the later upload timestamp.';
