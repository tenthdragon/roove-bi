-- Store the purchase value and ROAS reported by the source advertising platform.
-- NULL means the platform did not return the metric or the row predates this sync format.

ALTER TABLE public.daily_ads_spend
  ADD COLUMN IF NOT EXISTS platform_attributed_revenue NUMERIC,
  ADD COLUMN IF NOT EXISTS platform_reported_roas NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_attribution JSONB;

COMMENT ON COLUMN public.daily_ads_spend.platform_attributed_revenue IS
  'Purchase value attributed by the source ad platform; not realized/net sales.';

COMMENT ON COLUMN public.daily_ads_spend.platform_reported_roas IS
  'Purchase ROAS reported by the source ad platform using its attribution settings.';

COMMENT ON COLUMN public.daily_ads_spend.raw_attribution IS
  'Raw source attribution arrays and the selected purchase action type for auditability.';
