ALTER TABLE public.scalev_orders
  ADD COLUMN IF NOT EXISTS marketplace_tracking_number TEXT;

COMMENT ON COLUMN public.scalev_orders.marketplace_tracking_number IS
  'Normalized marketplace shipment tracking number for indexed order matching; null when unavailable.';

-- IMPORTANT:
-- Keep this migration DDL-only.
-- Historical backfill for public.scalev_orders must run separately in small batches,
-- otherwise Supabase SQL Editor can hit upstream timeout on large UPDATE statements.
-- Use:
--   npm run backfill:marketplace-tracking -- --apply

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scalev_orders_business_marketplace_tracking
  ON public.scalev_orders (business_code, marketplace_tracking_number)
  WHERE marketplace_tracking_number IS NOT NULL
    AND source IN ('marketplace_api_upload', 'webhook', 'ops_upload');
