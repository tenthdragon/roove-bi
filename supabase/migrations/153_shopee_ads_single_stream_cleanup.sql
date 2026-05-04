-- ============================================================
-- Shopee Ads Single Stream Cleanup
-- ============================================================
-- The current Shopee API integration only keeps the CPC Ads stream.
-- Livestream metrics exist in the docs, but no live-spend endpoint is
-- used in this app yet, so the shop config is reduced to one stream.

DELETE FROM public.shopee_shop_spend_streams
WHERE stream_key = 'shopee_live';

DELETE FROM public.daily_ads_spend
WHERE data_source = 'shopee_live_api';

DELETE FROM public.shopee_ads_daily_metrics
WHERE spend_stream_key = 'shopee_live';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shopee_shop_spend_streams_stream_key_check'
  ) THEN
    ALTER TABLE public.shopee_shop_spend_streams
      DROP CONSTRAINT shopee_shop_spend_streams_stream_key_check;
  END IF;

  ALTER TABLE public.shopee_shop_spend_streams
    ADD CONSTRAINT shopee_shop_spend_streams_stream_key_check
    CHECK (stream_key IN ('shopee_ads'));
END $$;

COMMENT ON TABLE public.shopee_shop_spend_streams IS
  'Per-shop Shopee Ads stream config for the current Open Platform integration.';

COMMENT ON COLUMN public.shopee_shop_spend_streams.stream_key IS
  'Logical Shopee spend stream currently supported by this app. At the moment only shopee_ads is active.';

COMMENT ON COLUMN public.shopee_ads_daily_metrics.spend_stream_key IS
  'Spend stream that produced the row. Currently limited to shopee_ads in this app.';
