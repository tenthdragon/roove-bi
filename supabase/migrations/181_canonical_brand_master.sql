-- Canonical workspace brand model.
--
-- This migration is intentionally additive. Existing store labels and
-- ads_store_brand_mapping rows stay in place so historical reports retain the
-- same attribution while new integrations can reference brands by ID.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_brand_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT LOWER(BTRIM(REGEXP_REPLACE(COALESCE(p_value, ''), '\s+', ' ', 'g')));
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_workspace_identity
  ON public.brands (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scalev_businesses_workspace_identity
  ON public.scalev_webhook_businesses (workspace_id, id);

CREATE TABLE IF NOT EXISTS public.business_brand_roles (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  brand_id INT NOT NULL,
  business_id INT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'seller', 'operator')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT business_brand_roles_workspace_brand_fkey
    FOREIGN KEY (workspace_id, brand_id)
    REFERENCES public.brands(workspace_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT business_brand_roles_workspace_business_fkey
    FOREIGN KEY (workspace_id, business_id)
    REFERENCES public.scalev_webhook_businesses(workspace_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT business_brand_roles_workspace_role_key
    UNIQUE (workspace_id, brand_id, business_id, role)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_brand_one_owner
  ON public.business_brand_roles (workspace_id, brand_id)
  WHERE role = 'owner' AND is_active;
CREATE INDEX IF NOT EXISTS idx_business_brand_business
  ON public.business_brand_roles (workspace_id, business_id, role)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS public.brand_aliases (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  brand_id INT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'generic',
  alias_type TEXT NOT NULL DEFAULT 'store'
    CHECK (alias_type IN ('brand', 'store', 'product', 'campaign', 'other')),
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT brand_aliases_workspace_brand_fkey
    FOREIGN KEY (workspace_id, brand_id)
    REFERENCES public.brands(workspace_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_alias_workspace_key
  ON public.brand_aliases (workspace_id, provider, alias_type, alias_normalized);
CREATE INDEX IF NOT EXISTS idx_brand_alias_resolution
  ON public.brand_aliases (workspace_id, alias_normalized, brand_id)
  WHERE is_active;

ALTER TABLE public.ads_store_brand_mapping
  ADD COLUMN IF NOT EXISTS brand_id INT;
ALTER TABLE public.meta_ad_accounts
  ADD COLUMN IF NOT EXISTS default_brand_id INT;
ALTER TABLE public.waba_accounts
  ADD COLUMN IF NOT EXISTS default_brand_id INT;
ALTER TABLE public.daily_ads_spend
  ADD COLUMN IF NOT EXISTS brand_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ads_store_brand_mapping'::regclass
      AND conname = 'ads_store_brand_workspace_brand_fkey'
  ) THEN
    ALTER TABLE public.ads_store_brand_mapping
      ADD CONSTRAINT ads_store_brand_workspace_brand_fkey
      FOREIGN KEY (workspace_id, brand_id)
      REFERENCES public.brands(workspace_id, id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.meta_ad_accounts'::regclass
      AND conname = 'meta_accounts_workspace_brand_fkey'
  ) THEN
    ALTER TABLE public.meta_ad_accounts
      ADD CONSTRAINT meta_accounts_workspace_brand_fkey
      FOREIGN KEY (workspace_id, default_brand_id)
      REFERENCES public.brands(workspace_id, id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.waba_accounts'::regclass
      AND conname = 'waba_accounts_workspace_brand_fkey'
  ) THEN
    ALTER TABLE public.waba_accounts
      ADD CONSTRAINT waba_accounts_workspace_brand_fkey
      FOREIGN KEY (workspace_id, default_brand_id)
      REFERENCES public.brands(workspace_id, id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.daily_ads_spend'::regclass
      AND conname = 'daily_ads_spend_workspace_brand_fkey'
  ) THEN
    ALTER TABLE public.daily_ads_spend
      ADD CONSTRAINT daily_ads_spend_workspace_brand_fkey
      FOREIGN KEY (workspace_id, brand_id)
      REFERENCES public.brands(workspace_id, id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ads_store_mapping_workspace_brand
  ON public.ads_store_brand_mapping (workspace_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_meta_accounts_workspace_brand
  ON public.meta_ad_accounts (workspace_id, default_brand_id);
CREATE INDEX IF NOT EXISTS idx_waba_accounts_workspace_brand
  ON public.waba_accounts (workspace_id, default_brand_id);
CREATE INDEX IF NOT EXISTS idx_daily_ads_workspace_brand_date
  ON public.daily_ads_spend (workspace_id, brand_id, date);

-- Resolve the legacy mapping's canonical brand by name before creating aliases.
UPDATE public.ads_store_brand_mapping mapping
SET brand_id = brand.id
FROM public.brands brand
WHERE mapping.workspace_id = brand.workspace_id
  AND public.normalize_brand_key(mapping.brand) = public.normalize_brand_key(brand.name)
  AND mapping.brand_id IS DISTINCT FROM brand.id;

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
  brand.workspace_id,
  brand.id,
  'internal',
  'brand',
  brand.name,
  public.normalize_brand_key(brand.name),
  TRUE,
  'Canonical brand name'
FROM public.brands brand
ON CONFLICT (workspace_id, provider, alias_type, alias_normalized) DO UPDATE
SET brand_id = EXCLUDED.brand_id,
    alias = EXCLUDED.alias,
    is_active = TRUE,
    updated_at = NOW();

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
  mapping.workspace_id,
  mapping.brand_id,
  'legacy_ads',
  'store',
  mapping.store_pattern,
  public.normalize_brand_key(mapping.store_pattern),
  TRUE,
  'Migrated from ads_store_brand_mapping'
FROM public.ads_store_brand_mapping mapping
WHERE mapping.brand_id IS NOT NULL
ON CONFLICT (workspace_id, provider, alias_type, alias_normalized) DO UPDATE
SET brand_id = EXCLUDED.brand_id,
    alias = EXCLUDED.alias,
    is_active = TRUE,
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.resolve_workspace_brand_id(
  p_workspace_id UUID,
  p_value TEXT
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := public.normalize_brand_key(p_value);
  v_brand_ids INT[];
BEGIN
  IF p_workspace_id IS NULL OR v_key = '' THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY_AGG(DISTINCT candidate.brand_id ORDER BY candidate.brand_id)
  INTO v_brand_ids
  FROM (
    SELECT brand.id AS brand_id
    FROM public.brands brand
    WHERE brand.workspace_id = p_workspace_id
      AND public.normalize_brand_key(brand.name) = v_key

    UNION ALL

    SELECT alias.brand_id
    FROM public.brand_aliases alias
    WHERE alias.workspace_id = p_workspace_id
      AND alias.alias_normalized = v_key
      AND alias.is_active

    UNION ALL

    SELECT COALESCE(mapping.brand_id, brand.id) AS brand_id
    FROM public.ads_store_brand_mapping mapping
    LEFT JOIN public.brands brand
      ON brand.workspace_id = mapping.workspace_id
     AND public.normalize_brand_key(brand.name) = public.normalize_brand_key(mapping.brand)
    WHERE mapping.workspace_id = p_workspace_id
      AND public.normalize_brand_key(mapping.store_pattern) = v_key
  ) candidate
  WHERE candidate.brand_id IS NOT NULL;

  IF COALESCE(CARDINALITY(v_brand_ids), 0) = 1 THEN
    RETURN v_brand_ids[1];
  END IF;

  -- Ambiguous aliases deliberately fail closed instead of guessing.
  RETURN NULL;
END;
$$;

-- Backfill account defaults without changing their existing store labels.
UPDATE public.meta_ad_accounts account
SET default_brand_id = public.resolve_workspace_brand_id(account.workspace_id, account.store)
WHERE account.default_brand_id IS NULL
  AND NULLIF(BTRIM(account.store), '') IS NOT NULL;

UPDATE public.waba_accounts account
SET default_brand_id = public.resolve_workspace_brand_id(account.workspace_id, account.store)
WHERE account.default_brand_id IS NULL
  AND NULLIF(BTRIM(account.store), '') IS NOT NULL;

-- Freeze the current attribution on historical spend. No financial value or
-- store label is changed by this update.
UPDATE public.daily_ads_spend spend
SET brand_id = public.resolve_workspace_brand_id(spend.workspace_id, spend.store)
WHERE spend.brand_id IS NULL
  AND NULLIF(BTRIM(spend.store), '') IS NOT NULL;

-- A deterministic owner can be inferred only when every canonical product for
-- a brand points to the same business entity. Ambiguous brands stay unassigned.
WITH candidates AS (
  SELECT
    product.owner_workspace_id AS workspace_id,
    product.brand_id,
    MIN(business.id) AS business_id,
    COUNT(DISTINCT business.id) AS business_count
  FROM public.warehouse_products product
  JOIN public.scalev_webhook_businesses business
    ON business.workspace_id = product.owner_workspace_id
   AND business.business_code = product.entity
  WHERE product.brand_id IS NOT NULL
  GROUP BY product.owner_workspace_id, product.brand_id
)
INSERT INTO public.business_brand_roles (
  workspace_id,
  brand_id,
  business_id,
  role,
  is_active
)
SELECT workspace_id, brand_id, business_id, 'owner', TRUE
FROM candidates
WHERE business_count = 1
ON CONFLICT (workspace_id, brand_id, business_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_canonical_brand_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
  VALUES (
    NEW.workspace_id,
    NEW.id,
    'internal',
    'brand',
    NEW.name,
    public.normalize_brand_key(NEW.name),
    TRUE,
    'Canonical brand name'
  )
  ON CONFLICT (workspace_id, provider, alias_type, alias_normalized) DO UPDATE
  SET brand_id = EXCLUDED.brand_id,
      alias = EXCLUDED.alias,
      is_active = TRUE,
      updated_at = NOW();

  UPDATE public.ads_store_brand_mapping
  SET brand = NEW.name,
      brand_id = NEW.id
  WHERE workspace_id = NEW.workspace_id
    AND brand_id = NEW.id;

  UPDATE public.ads_store_brand_mapping
  SET brand = NEW.name,
      brand_id = NEW.id
  WHERE workspace_id = NEW.workspace_id
    AND public.normalize_brand_key(store_pattern) = public.normalize_brand_key(NEW.name);

  IF NOT FOUND THEN
    INSERT INTO public.ads_store_brand_mapping (
      workspace_id,
      store_pattern,
      brand,
      brand_id
    )
    VALUES (NEW.workspace_id, NEW.name, NEW.name, NEW.id)
    ON CONFLICT (workspace_id, store_pattern) DO UPDATE
    SET brand = EXCLUDED.brand,
        brand_id = EXCLUDED.brand_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_canonical_brand_identity ON public.brands;
CREATE TRIGGER trg_sync_canonical_brand_identity
  AFTER INSERT OR UPDATE OF name ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_brand_identity();

CREATE OR REPLACE FUNCTION public.sync_marketing_account_brand()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand_name TEXT;
BEGIN
  IF NEW.default_brand_id IS NULL AND NULLIF(BTRIM(NEW.store), '') IS NOT NULL THEN
    NEW.default_brand_id := public.resolve_workspace_brand_id(NEW.workspace_id, NEW.store);
  END IF;

  IF NEW.default_brand_id IS NOT NULL THEN
    SELECT brand.name
    INTO v_brand_name
    FROM public.brands brand
    WHERE brand.workspace_id = NEW.workspace_id
      AND brand.id = NEW.default_brand_id;

    IF v_brand_name IS NULL THEN
      RAISE EXCEPTION 'Brand % is not available in workspace %', NEW.default_brand_id, NEW.workspace_id;
    END IF;

    -- Keep legacy readers stable while brand_id is the canonical relation.
    NEW.store := v_brand_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meta_account_canonical_brand ON public.meta_ad_accounts;
CREATE TRIGGER trg_meta_account_canonical_brand
  BEFORE INSERT OR UPDATE OF workspace_id, store, default_brand_id
  ON public.meta_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_marketing_account_brand();

DROP TRIGGER IF EXISTS trg_waba_account_canonical_brand ON public.waba_accounts;
CREATE TRIGGER trg_waba_account_canonical_brand
  BEFORE INSERT OR UPDATE OF workspace_id, store, default_brand_id
  ON public.waba_accounts
  FOR EACH ROW EXECUTE FUNCTION public.sync_marketing_account_brand();

CREATE OR REPLACE FUNCTION public.assign_daily_ads_brand()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.brand_id IS NULL AND NULLIF(BTRIM(NEW.store), '') IS NOT NULL THEN
    NEW.brand_id := public.resolve_workspace_brand_id(NEW.workspace_id, NEW.store);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_daily_ads_brand ON public.daily_ads_spend;
CREATE TRIGGER trg_assign_daily_ads_brand
  BEFORE INSERT OR UPDATE OF workspace_id, store, brand_id
  ON public.daily_ads_spend
  FOR EACH ROW EXECUTE FUNCTION public.assign_daily_ads_brand();

ALTER TABLE public.business_brand_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_brand_roles_read ON public.business_brand_roles;
CREATE POLICY business_brand_roles_read ON public.business_brand_roles
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));
DROP POLICY IF EXISTS business_brand_roles_manage ON public.business_brand_roles;
CREATE POLICY business_brand_roles_manage ON public.business_brand_roles
  FOR ALL TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('whs:brands')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('whs:brands')
  );

DROP POLICY IF EXISTS brand_aliases_read ON public.brand_aliases;
CREATE POLICY brand_aliases_read ON public.brand_aliases
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));
DROP POLICY IF EXISTS brand_aliases_manage ON public.brand_aliases;
CREATE POLICY brand_aliases_manage ON public.brand_aliases
  FOR ALL TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('whs:brands')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('whs:brands')
  );

GRANT SELECT ON public.business_brand_roles, public.brand_aliases TO authenticated;
GRANT ALL ON public.business_brand_roles, public.brand_aliases TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.business_brand_roles_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.brand_aliases_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.resolve_workspace_brand_id(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_workspace_brand_id(UUID, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.replace_workspace_brand_business_roles(
  p_workspace_id UUID,
  p_brand_id INT,
  p_owner_business_id INT DEFAULT NULL,
  p_seller_business_ids INT[] DEFAULT '{}'::INT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller_business_id INT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Brand business role writes require the service role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.workspace_id = p_workspace_id
      AND brand.id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'Brand % is not available in workspace %', p_brand_id, p_workspace_id;
  END IF;

  IF p_owner_business_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scalev_webhook_businesses business
    WHERE business.workspace_id = p_workspace_id
      AND business.id = p_owner_business_id
  ) THEN
    RAISE EXCEPTION 'Owner business % is not available in workspace %', p_owner_business_id, p_workspace_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM UNNEST(COALESCE(p_seller_business_ids, '{}'::INT[])) AS seller(seller_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.scalev_webhook_businesses business
      WHERE business.workspace_id = p_workspace_id
        AND business.id = seller.seller_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more seller businesses are not available in workspace %', p_workspace_id;
  END IF;

  DELETE FROM public.business_brand_roles
  WHERE workspace_id = p_workspace_id
    AND brand_id = p_brand_id
    AND role IN ('owner', 'seller');

  IF p_owner_business_id IS NOT NULL THEN
    INSERT INTO public.business_brand_roles (
      workspace_id, brand_id, business_id, role, is_active
    )
    VALUES (p_workspace_id, p_brand_id, p_owner_business_id, 'owner', TRUE);
  END IF;

  FOR v_seller_business_id IN
    SELECT DISTINCT seller.seller_id
    FROM UNNEST(COALESCE(p_seller_business_ids, '{}'::INT[])) AS seller(seller_id)
  LOOP
    INSERT INTO public.business_brand_roles (
      workspace_id, brand_id, business_id, role, is_active
    )
    VALUES (p_workspace_id, p_brand_id, v_seller_business_id, 'seller', TRUE);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_workspace_brand_alias(
  p_workspace_id UUID,
  p_brand_id INT,
  p_provider TEXT,
  p_alias_type TEXT,
  p_alias TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, 'generic')));
  v_alias_type TEXT := LOWER(BTRIM(COALESCE(p_alias_type, 'store')));
  v_alias TEXT := BTRIM(COALESCE(p_alias, ''));
  v_alias_id BIGINT;
  v_brand_name TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Brand alias writes require the service role';
  END IF;

  IF v_provider !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'Brand alias provider is invalid';
  END IF;
  IF v_alias_type NOT IN ('brand', 'store', 'product', 'campaign', 'other') THEN
    RAISE EXCEPTION 'Brand alias type is invalid';
  END IF;
  IF v_alias = '' OR LENGTH(v_alias) > 240 THEN
    RAISE EXCEPTION 'Brand alias is invalid';
  END IF;

  SELECT brand.name
  INTO v_brand_name
  FROM public.brands brand
  WHERE brand.workspace_id = p_workspace_id
    AND brand.id = p_brand_id;

  IF v_brand_name IS NULL THEN
    RAISE EXCEPTION 'Brand % is not available in workspace %', p_brand_id, p_workspace_id;
  END IF;

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
  VALUES (
    p_workspace_id,
    p_brand_id,
    v_provider,
    v_alias_type,
    v_alias,
    public.normalize_brand_key(v_alias),
    TRUE,
    NULLIF(BTRIM(COALESCE(p_notes, '')), '')
  )
  ON CONFLICT (workspace_id, provider, alias_type, alias_normalized) DO UPDATE
  SET brand_id = EXCLUDED.brand_id,
      alias = EXCLUDED.alias,
      is_active = TRUE,
      notes = EXCLUDED.notes,
      updated_at = NOW()
  RETURNING id INTO v_alias_id;

  IF v_alias_type = 'store' THEN
    INSERT INTO public.ads_store_brand_mapping (
      workspace_id,
      store_pattern,
      brand,
      brand_id
    )
    VALUES (p_workspace_id, v_alias, v_brand_name, p_brand_id)
    ON CONFLICT (workspace_id, store_pattern) DO UPDATE
    SET brand = EXCLUDED.brand,
        brand_id = EXCLUDED.brand_id;
  END IF;

  RETURN v_alias_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_brand_alias_active(
  p_workspace_id UUID,
  p_alias_id BIGINT,
  p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Brand alias writes require the service role';
  END IF;

  UPDATE public.brand_aliases
  SET is_active = COALESCE(p_is_active, FALSE),
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND id = p_alias_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brand alias % was not found in workspace %', p_alias_id, p_workspace_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_workspace_brand_business_roles(UUID, INT, INT, INT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_workspace_brand_business_roles(UUID, INT, INT, INT[])
  TO service_role;
REVOKE ALL ON FUNCTION public.upsert_workspace_brand_alias(UUID, INT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workspace_brand_alias(UUID, INT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_workspace_brand_alias_active(UUID, BIGINT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_brand_alias_active(UUID, BIGINT, BOOLEAN)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_brand_consolidation_audit(
  p_workspace_id UUID
)
RETURNS TABLE (
  metric TEXT,
  total BIGINT,
  resolved BIGINT,
  unresolved BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'brands', COUNT(*), COUNT(*), 0
  FROM public.brands
  WHERE workspace_id = p_workspace_id

  UNION ALL

  SELECT 'ads_store_brand_mapping', COUNT(*), COUNT(brand_id), COUNT(*) - COUNT(brand_id)
  FROM public.ads_store_brand_mapping
  WHERE workspace_id = p_workspace_id

  UNION ALL

  SELECT 'meta_ad_accounts', COUNT(*), COUNT(default_brand_id), COUNT(*) - COUNT(default_brand_id)
  FROM public.meta_ad_accounts
  WHERE workspace_id = p_workspace_id

  UNION ALL

  SELECT 'waba_accounts', COUNT(*), COUNT(default_brand_id), COUNT(*) - COUNT(default_brand_id)
  FROM public.waba_accounts
  WHERE workspace_id = p_workspace_id

  UNION ALL

  SELECT 'daily_ads_spend', COUNT(*), COUNT(brand_id), COUNT(*) - COUNT(brand_id)
  FROM public.daily_ads_spend
  WHERE workspace_id = p_workspace_id;
$$;

REVOKE ALL ON FUNCTION public.get_brand_consolidation_audit(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_brand_consolidation_audit(UUID)
  TO service_role;

COMMENT ON TABLE public.business_brand_roles IS
  'Workspace-scoped business roles for a canonical brand: owner, seller, or operator.';
COMMENT ON TABLE public.brand_aliases IS
  'External provider labels that resolve to one canonical workspace brand.';
COMMENT ON COLUMN public.meta_ad_accounts.default_brand_id IS
  'Canonical default brand for account-level Meta insights.';
COMMENT ON COLUMN public.daily_ads_spend.brand_id IS
  'Brand attribution frozen when the spend row is ingested.';

COMMIT;
