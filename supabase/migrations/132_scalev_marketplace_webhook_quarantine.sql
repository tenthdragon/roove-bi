CREATE TABLE IF NOT EXISTS public.scalev_marketplace_webhook_quarantine (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_id BIGINT NULL,
  business_code TEXT NULL,
  event_type TEXT NULL,
  order_id TEXT NULL,
  external_id TEXT NULL,
  scalev_id TEXT NULL,
  source_class TEXT NULL,
  source_class_reason TEXT NULL,
  matched_scalev_order_id BIGINT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scalev_marketplace_webhook_quarantine_created_at
  ON public.scalev_marketplace_webhook_quarantine (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scalev_marketplace_webhook_quarantine_business
  ON public.scalev_marketplace_webhook_quarantine (business_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scalev_marketplace_webhook_quarantine_order
  ON public.scalev_marketplace_webhook_quarantine (order_id, external_id, created_at DESC);
