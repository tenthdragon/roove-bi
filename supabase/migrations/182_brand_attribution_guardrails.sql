-- Complete canonical compatibility rows and resolve deterministic ad-account
-- aliases. Financial values and original store labels remain unchanged.

BEGIN;

INSERT INTO public.ads_store_brand_mapping (
  workspace_id,
  store_pattern,
  brand,
  brand_id
)
SELECT brand.workspace_id, brand.name, brand.name, brand.id
FROM public.brands brand
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ads_store_brand_mapping mapping
  WHERE mapping.workspace_id = brand.workspace_id
    AND public.normalize_brand_key(mapping.store_pattern) = public.normalize_brand_key(brand.name)
)
ON CONFLICT (workspace_id, store_pattern) DO UPDATE
SET brand = EXCLUDED.brand,
    brand_id = EXCLUDED.brand_id;

-- When an unresolved imported ad account contains exactly one canonical brand
-- name, preserve that exact account label as an alias. Ambiguous labels are
-- deliberately excluded.
WITH unresolved_accounts AS (
  SELECT DISTINCT spend.workspace_id, BTRIM(spend.ad_account) AS ad_account
  FROM public.daily_ads_spend spend
  WHERE spend.brand_id IS NULL
    AND NULLIF(BTRIM(spend.ad_account), '') IS NOT NULL
), matches AS (
  SELECT
    account.workspace_id,
    account.ad_account,
    MIN(brand.id) AS brand_id,
    COUNT(DISTINCT brand.id) AS brand_count
  FROM unresolved_accounts account
  JOIN public.brands brand
    ON brand.workspace_id = account.workspace_id
   AND public.normalize_brand_key(brand.name) NOT IN ('other', 'lainnya')
   AND LENGTH(public.normalize_brand_key(brand.name)) >= 4
   AND POSITION(
     public.normalize_brand_key(brand.name)
     IN public.normalize_brand_key(account.ad_account)
   ) > 0
  GROUP BY account.workspace_id, account.ad_account
)
INSERT INTO public.brand_aliases (
  workspace_id,
  brand_id,
  provider,
  alias_type,
  alias,
  alias_normalized,
  is_active,
  notes
)
SELECT
  workspace_id,
  brand_id,
  'ads_import',
  'campaign',
  ad_account,
  public.normalize_brand_key(ad_account),
  TRUE,
  'Deterministic alias inferred from one canonical brand name'
FROM matches
WHERE brand_count = 1
ON CONFLICT (workspace_id, provider, alias_type, alias_normalized) DO UPDATE
SET brand_id = EXCLUDED.brand_id,
    alias = EXCLUDED.alias,
    is_active = TRUE,
    updated_at = NOW();

UPDATE public.daily_ads_spend spend
SET brand_id = COALESCE(
  public.resolve_workspace_brand_id(spend.workspace_id, spend.store),
  public.resolve_workspace_brand_id(spend.workspace_id, spend.ad_account)
)
WHERE spend.brand_id IS NULL
  AND (
    NULLIF(BTRIM(spend.store), '') IS NOT NULL
    OR NULLIF(BTRIM(spend.ad_account), '') IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.assign_daily_ads_brand()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.brand_id IS NULL THEN
    NEW.brand_id := COALESCE(
      public.resolve_workspace_brand_id(NEW.workspace_id, NEW.store),
      public.resolve_workspace_brand_id(NEW.workspace_id, NEW.ad_account)
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Business relationships explicitly confirmed for the Roove workspace.
INSERT INTO public.business_brand_roles (
  workspace_id,
  brand_id,
  business_id,
  role,
  is_active
)
SELECT
  workspace.id,
  brand.id,
  business.id,
  'seller',
  TRUE
FROM public.workspaces workspace
JOIN public.brands brand
  ON brand.workspace_id = workspace.id
 AND LOWER(brand.name) IN ('pluve', 'calmara', 'purvu')
JOIN public.scalev_webhook_businesses business
  ON business.workspace_id = workspace.id
 AND business.business_code = 'JHN'
WHERE workspace.slug = 'roove'
ON CONFLICT (workspace_id, brand_id, business_id, role) DO UPDATE
SET is_active = TRUE,
    updated_at = NOW();

COMMIT;
