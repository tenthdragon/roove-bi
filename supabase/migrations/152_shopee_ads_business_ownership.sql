-- ============================================================
-- Shopee Ads Business Ownership
-- ============================================================
-- Shopee shop connections now map only to commerce source.
-- Ads spend ownership follows the source business, while
-- brand/store parsing remains a downstream commerce concern.

ALTER TABLE public.daily_ads_spend
  ADD COLUMN IF NOT EXISTS business_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'daily_ads_spend_business_code_fkey'
  ) THEN
    ALTER TABLE public.daily_ads_spend
      ADD CONSTRAINT daily_ads_spend_business_code_fkey
      FOREIGN KEY (business_code)
      REFERENCES public.scalev_webhook_businesses(business_code)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_ads_spend_business_code_date
  ON public.daily_ads_spend (business_code, date DESC);

COMMENT ON COLUMN public.daily_ads_spend.business_code IS
  'Owning business for the ad spend row. Shopee API rows derive this from the connected commerce source, not from brand/store mapping.';

UPDATE public.shopee_shop_spend_streams
SET default_source = CASE stream_key
  WHEN 'shopee_live' THEN 'Shopee Live'
  ELSE 'Shopee Ads'
END,
updated_at = NOW()
WHERE default_source IS DISTINCT FROM CASE stream_key
  WHEN 'shopee_live' THEN 'Shopee Live'
  ELSE 'Shopee Ads'
END;

UPDATE public.shopee_shops
SET
  account_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE NULL
  END,
  viewer_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE NULL
  END,
  revenue_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE NULL
  END,
  default_owner_business_code = NULL,
  default_processor_business_code = NULL,
  store = NULL,
  updated_at = NOW()
WHERE marketplace_source_key IN ('shopee_rlt', 'shopee_jhn');

UPDATE public.shopee_ads_daily_metrics
SET
  account_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE account_business_code
  END,
  viewer_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE viewer_business_code
  END,
  revenue_business_code = CASE marketplace_source_key
    WHEN 'shopee_rlt' THEN 'RLT'
    WHEN 'shopee_jhn' THEN 'JHN'
    ELSE revenue_business_code
  END,
  default_owner_business_code = NULL,
  default_processor_business_code = NULL,
  store = NULL,
  updated_at = NOW()
WHERE marketplace_source_key IN ('shopee_rlt', 'shopee_jhn');

WITH shopee_business_map AS (
  SELECT
    streams.default_source,
    streams.default_advertiser,
    COALESCE(
      NULLIF(shop.revenue_business_code, ''),
      NULLIF(shop.viewer_business_code, ''),
      NULLIF(shop.account_business_code, ''),
      CASE shop.marketplace_source_key
        WHEN 'shopee_rlt' THEN 'RLT'
        WHEN 'shopee_jhn' THEN 'JHN'
        ELSE NULL
      END
    ) AS business_code
  FROM public.shopee_shop_spend_streams AS streams
  JOIN public.shopee_shops AS shop
    ON shop.id = streams.shop_config_id
)
UPDATE public.daily_ads_spend AS spend
SET business_code = shopee_business_map.business_code
FROM shopee_business_map
WHERE spend.data_source IN ('google_sheets', 'xlsx_upload', 'shopee_ads_api', 'shopee_live_api')
  AND NULLIF(spend.business_code, '') IS NULL
  AND spend.source = shopee_business_map.default_source
  AND spend.advertiser = shopee_business_map.default_advertiser;
