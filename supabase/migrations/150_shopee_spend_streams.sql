-- ============================================================
-- Shopee Spend Streams
-- ============================================================
-- Separates one Shopee shop connection from its spend channels.
-- A shop can later feed commerce/revenue replacement, while spend
-- channels remain distinct as Shopee Ads vs Shopee Live.

CREATE TABLE IF NOT EXISTS public.shopee_shop_spend_streams (
  id BIGSERIAL PRIMARY KEY,
  shop_config_id INT NOT NULL REFERENCES public.shopee_shops(id) ON DELETE CASCADE,
  stream_key TEXT NOT NULL CHECK (stream_key IN ('shopee_ads', 'shopee_live')),
  default_source TEXT NOT NULL,
  default_advertiser TEXT NOT NULL,
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('api', 'manual')),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_config_id, stream_key)
);

COMMENT ON TABLE public.shopee_shop_spend_streams IS
  'Per-shop spend streams so Shopee Ads and Shopee Live can be managed separately.';

COMMENT ON COLUMN public.shopee_shop_spend_streams.stream_key IS
  'Logical spend stream under the shop connection, e.g. shopee_ads or shopee_live.';

COMMENT ON COLUMN public.shopee_shop_spend_streams.sync_mode IS
  'api = synced via Shopee API, manual = still fed from spreadsheet/admin upload.';

INSERT INTO public.shopee_shop_spend_streams (
  shop_config_id,
  stream_key,
  default_source,
  default_advertiser,
  sync_mode,
  is_enabled
)
SELECT
  s.id,
  stream.stream_key,
  stream.default_source,
  stream.default_advertiser,
  stream.sync_mode,
  stream.is_enabled
FROM public.shopee_shops s
CROSS JOIN LATERAL (
  VALUES
    (
      'shopee_ads'::TEXT,
      COALESCE(NULLIF(TRIM(s.default_source), ''), 'Shopee Ads'),
      COALESCE(NULLIF(TRIM(s.default_advertiser), ''), NULLIF(TRIM(s.shop_name), ''), 'Shopee Shop'),
      'api'::TEXT,
      TRUE
    ),
    (
      'shopee_live'::TEXT,
      'Shopee Live'::TEXT,
      COALESCE(NULLIF(TRIM(s.default_advertiser), ''), NULLIF(TRIM(s.shop_name), ''), 'Shopee Shop'),
      'manual'::TEXT,
      FALSE
    )
) AS stream(stream_key, default_source, default_advertiser, sync_mode, is_enabled)
ON CONFLICT (shop_config_id, stream_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_shopee_shop_spend_streams_shop
  ON public.shopee_shop_spend_streams (shop_config_id);

CREATE INDEX IF NOT EXISTS idx_shopee_shop_spend_streams_mode_enabled
  ON public.shopee_shop_spend_streams (sync_mode, is_enabled);

ALTER TABLE public.shopee_ads_daily_metrics
  ADD COLUMN IF NOT EXISTS spend_stream_key TEXT;

UPDATE public.shopee_ads_daily_metrics
SET spend_stream_key = 'shopee_ads'
WHERE NULLIF(spend_stream_key, '') IS NULL;

ALTER TABLE public.shopee_ads_daily_metrics
  ALTER COLUMN spend_stream_key SET DEFAULT 'shopee_ads';

ALTER TABLE public.shopee_ads_daily_metrics
  ALTER COLUMN spend_stream_key SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shopee_ads_daily_metrics_shop_config_id_metric_date_key'
  ) THEN
    ALTER TABLE public.shopee_ads_daily_metrics
      DROP CONSTRAINT shopee_ads_daily_metrics_shop_config_id_metric_date_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_ads_daily_metrics_shop_stream_date
  ON public.shopee_ads_daily_metrics (shop_config_id, spend_stream_key, metric_date);

COMMENT ON COLUMN public.shopee_ads_daily_metrics.spend_stream_key IS
  'Spend stream that produced the row, e.g. shopee_ads or shopee_live.';

ALTER TABLE public.shopee_shop_spend_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Write shopee_shop_spend_streams via admin:meta" ON public.shopee_shop_spend_streams;
CREATE POLICY "Write shopee_shop_spend_streams via admin:meta" ON public.shopee_shop_spend_streams
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));
