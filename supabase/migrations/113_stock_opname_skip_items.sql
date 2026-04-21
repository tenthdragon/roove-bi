BEGIN;

ALTER TABLE public.warehouse_stock_opname
  ADD COLUMN IF NOT EXISTS is_skipped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.warehouse_stock_opname.is_skipped IS
  'True when the item is intentionally excluded from the active stock opname session and should not block submit or create an adjustment.';

UPDATE public.warehouse_stock_opname
SET is_skipped = FALSE
WHERE is_skipped IS NULL;

COMMIT;
