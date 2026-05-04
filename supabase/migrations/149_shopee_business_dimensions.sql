-- ============================================================
-- Shopee Business Dimensions
-- ============================================================
-- Adds explicit business mapping to Shopee shop connections so a
-- marketplace account can be tied to the correct seller/revenue
-- business, while keeping optional owner/processor fallbacks for
-- future revenue/order routing.

ALTER TABLE public.shopee_shops
  ADD COLUMN IF NOT EXISTS marketplace_source_key TEXT,
  ADD COLUMN IF NOT EXISTS account_business_code TEXT,
  ADD COLUMN IF NOT EXISTS viewer_business_code TEXT,
  ADD COLUMN IF NOT EXISTS revenue_business_code TEXT,
  ADD COLUMN IF NOT EXISTS default_owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS default_processor_business_code TEXT;

ALTER TABLE public.shopee_ads_daily_metrics
  ADD COLUMN IF NOT EXISTS marketplace_source_key TEXT,
  ADD COLUMN IF NOT EXISTS account_business_code TEXT,
  ADD COLUMN IF NOT EXISTS viewer_business_code TEXT,
  ADD COLUMN IF NOT EXISTS revenue_business_code TEXT,
  ADD COLUMN IF NOT EXISTS default_owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS default_processor_business_code TEXT;

UPDATE public.shopee_shops
SET account_business_code = CASE marketplace_source_key
  WHEN 'shopee_rlt' THEN 'RLT'
  WHEN 'shopee_jhn' THEN 'JHN'
  ELSE account_business_code
END
WHERE NULLIF(account_business_code, '') IS NULL
  AND marketplace_source_key IN ('shopee_rlt', 'shopee_jhn');

UPDATE public.shopee_shops
SET viewer_business_code = COALESCE(
  NULLIF(account_business_code, ''),
  CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE viewer_business_code
  END
)
WHERE NULLIF(viewer_business_code, '') IS NULL
  AND marketplace_source_key IN ('shopee_rlt', 'shopee_jhn');

UPDATE public.shopee_shops
SET revenue_business_code = COALESCE(
  NULLIF(viewer_business_code, ''),
  NULLIF(account_business_code, ''),
  CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE revenue_business_code
  END
)
WHERE NULLIF(revenue_business_code, '') IS NULL
  AND marketplace_source_key IN ('shopee_rlt', 'shopee_jhn');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_shops_account_business_code_fkey'
  ) THEN
    ALTER TABLE public.shopee_shops
      ADD CONSTRAINT shopee_shops_account_business_code_fkey
      FOREIGN KEY (account_business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_shops_viewer_business_code_fkey'
  ) THEN
    ALTER TABLE public.shopee_shops
      ADD CONSTRAINT shopee_shops_viewer_business_code_fkey
      FOREIGN KEY (viewer_business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_shops_revenue_business_code_fkey'
  ) THEN
    ALTER TABLE public.shopee_shops
      ADD CONSTRAINT shopee_shops_revenue_business_code_fkey
      FOREIGN KEY (revenue_business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_shops_default_owner_business_code_fkey'
  ) THEN
    ALTER TABLE public.shopee_shops
      ADD CONSTRAINT shopee_shops_default_owner_business_code_fkey
      FOREIGN KEY (default_owner_business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shopee_shops_default_processor_business_code_fkey'
  ) THEN
    ALTER TABLE public.shopee_shops
      ADD CONSTRAINT shopee_shops_default_processor_business_code_fkey
      FOREIGN KEY (default_processor_business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shopee_shops_marketplace_source_key
  ON public.shopee_shops (marketplace_source_key);

CREATE INDEX IF NOT EXISTS idx_shopee_shops_revenue_business_code
  ON public.shopee_shops (revenue_business_code);

CREATE INDEX IF NOT EXISTS idx_shopee_ads_daily_metrics_revenue_business_code_date
  ON public.shopee_ads_daily_metrics (revenue_business_code, metric_date DESC);

COMMENT ON COLUMN public.shopee_shops.marketplace_source_key IS
  'Marketplace source config key, e.g. shopee_rlt or shopee_jhn.';

COMMENT ON COLUMN public.shopee_shops.account_business_code IS
  'Business that owns the marketplace account / shop login.';

COMMENT ON COLUMN public.shopee_shops.viewer_business_code IS
  'Business whose visible catalog is considered sellable in this shop.';

COMMENT ON COLUMN public.shopee_shops.revenue_business_code IS
  'Business that should receive marketplace revenue attribution for this shop.';

COMMENT ON COLUMN public.shopee_shops.default_owner_business_code IS
  'Fallback stock owner business when item-level owner cannot yet be resolved.';

COMMENT ON COLUMN public.shopee_shops.default_processor_business_code IS
  'Fallback fulfillment/processor business when item-level processor cannot yet be resolved.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.marketplace_source_key IS
  'Historical snapshot of the marketplace source key used by this shop on sync day.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.account_business_code IS
  'Historical snapshot of the shop account owner business.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.viewer_business_code IS
  'Historical snapshot of the viewer/seller catalog business.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.revenue_business_code IS
  'Historical snapshot of the revenue attribution business.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.default_owner_business_code IS
  'Historical snapshot of the fallback stock owner business.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.default_processor_business_code IS
  'Historical snapshot of the fallback fulfillment business.';
