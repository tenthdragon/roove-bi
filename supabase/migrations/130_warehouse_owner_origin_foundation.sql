BEGIN;

CREATE OR REPLACE FUNCTION dashboard_has_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN role_permissions rp
      ON rp.role = p.role::text
     AND rp.permission_key = p_permission_key
    WHERE p.id = auth.uid()
      AND (p.role::text = 'owner' OR rp.permission_key IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.warehouse_business_directory (
  id BIGSERIAL PRIMARY KEY,
  external_name TEXT NOT NULL,
  external_name_normalized TEXT NOT NULL,
  business_id INT REFERENCES public.scalev_webhook_businesses(id) ON DELETE SET NULL,
  business_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_name_normalized)
);

COMMENT ON TABLE public.warehouse_business_directory IS
  'Normalizes external ScaleV business labels such as business_name, origin_business_name, and item_owner into internal business codes.';

CREATE INDEX IF NOT EXISTS idx_wbd_business_code
  ON public.warehouse_business_directory (business_code);

ALTER TABLE public.warehouse_business_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_business_directory_read" ON public.warehouse_business_directory;
CREATE POLICY "warehouse_business_directory_read" ON public.warehouse_business_directory
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "warehouse_business_directory_manage" ON public.warehouse_business_directory;
CREATE POLICY "warehouse_business_directory_manage" ON public.warehouse_business_directory
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

DROP TRIGGER IF EXISTS set_updated_at_warehouse_business_directory ON public.warehouse_business_directory;
CREATE TRIGGER set_updated_at_warehouse_business_directory
  BEFORE UPDATE ON public.warehouse_business_directory
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.warehouse_origin_registry (
  id BIGSERIAL PRIMARY KEY,
  external_origin_business_name TEXT NOT NULL,
  external_origin_business_name_normalized TEXT NOT NULL,
  external_origin_name TEXT NOT NULL,
  external_origin_name_normalized TEXT NOT NULL,
  operator_business_id INT REFERENCES public.scalev_webhook_businesses(id) ON DELETE SET NULL,
  operator_business_code TEXT NOT NULL,
  internal_warehouse_code TEXT NOT NULL DEFAULT 'BTN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_origin_business_name_normalized, external_origin_name_normalized)
);

COMMENT ON TABLE public.warehouse_origin_registry IS
  'Maps ScaleV origin_business_name + origin pairs into the internal physical warehouse identity used for deduction.';

CREATE INDEX IF NOT EXISTS idx_wor_operator_business_code
  ON public.warehouse_origin_registry (operator_business_code);

ALTER TABLE public.warehouse_origin_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_origin_registry_read" ON public.warehouse_origin_registry;
CREATE POLICY "warehouse_origin_registry_read" ON public.warehouse_origin_registry
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "warehouse_origin_registry_manage" ON public.warehouse_origin_registry;
CREATE POLICY "warehouse_origin_registry_manage" ON public.warehouse_origin_registry
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:warehouses'))
  WITH CHECK (dashboard_has_permission('whs:warehouses'));

DROP TRIGGER IF EXISTS set_updated_at_warehouse_origin_registry ON public.warehouse_origin_registry;
CREATE TRIGGER set_updated_at_warehouse_origin_registry
  BEFORE UPDATE ON public.warehouse_origin_registry
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.scalev_orders
  ADD COLUMN IF NOT EXISTS business_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS origin_business_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS origin_raw TEXT,
  ADD COLUMN IF NOT EXISTS seller_business_code TEXT,
  ADD COLUMN IF NOT EXISTS origin_operator_business_code TEXT,
  ADD COLUMN IF NOT EXISTS origin_registry_id BIGINT REFERENCES public.warehouse_origin_registry(id) ON DELETE SET NULL;

ALTER TABLE public.scalev_order_lines
  ADD COLUMN IF NOT EXISTS item_name_raw TEXT,
  ADD COLUMN IF NOT EXISTS item_owner_raw TEXT,
  ADD COLUMN IF NOT EXISTS stock_owner_business_code TEXT;

-- IMPORTANT:
-- Keep this migration DDL-only.
-- Historical backfill for large scalev_orders / scalev_order_lines tables must run
-- separately in small batches, otherwise Supabase SQL Editor can hit upstream timeout
-- and roll back the whole transaction before COMMIT.

INSERT INTO public.warehouse_business_directory (
  external_name,
  external_name_normalized,
  business_id,
  business_code,
  is_active,
  notes
)
SELECT
  seeded.external_name,
  lower(trim(regexp_replace(seeded.external_name, '\s+', ' ', 'g'))),
  seeded.business_id,
  seeded.business_code,
  TRUE,
  'Seed dari scalev_webhook_businesses'
FROM (
  SELECT
    id AS business_id,
    business_code,
    business_name AS external_name
  FROM public.scalev_webhook_businesses
  WHERE business_name IS NOT NULL
    AND trim(business_name) <> ''

  UNION ALL

  SELECT
    id AS business_id,
    business_code,
    business_code AS external_name
  FROM public.scalev_webhook_businesses
  WHERE business_code IS NOT NULL
    AND trim(business_code) <> ''
) seeded
ON CONFLICT (external_name_normalized) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_seller_business_code
  ON public.scalev_orders (seller_business_code);
CREATE INDEX IF NOT EXISTS idx_scalev_orders_origin_operator_business_code
  ON public.scalev_orders (origin_operator_business_code);
CREATE INDEX IF NOT EXISTS idx_scalev_orders_origin_registry_id
  ON public.scalev_orders (origin_registry_id);

CREATE INDEX IF NOT EXISTS idx_scalev_order_lines_stock_owner_business_code
  ON public.scalev_order_lines (stock_owner_business_code);

COMMENT ON COLUMN public.scalev_orders.business_name_raw IS
  'Raw seller or order-owner label from ScaleV export or webhook payload.';
COMMENT ON COLUMN public.scalev_orders.origin_business_name_raw IS
  'Raw fulfillment-operator label from ScaleV export or webhook payload.';
COMMENT ON COLUMN public.scalev_orders.origin_raw IS
  'Raw physical origin label from ScaleV export or webhook payload.';
COMMENT ON COLUMN public.scalev_orders.seller_business_code IS
  'Normalized internal business code for business_name_raw.';
COMMENT ON COLUMN public.scalev_orders.origin_operator_business_code IS
  'Normalized internal business code for origin_business_name_raw.';
COMMENT ON COLUMN public.scalev_orders.origin_registry_id IS
  'Matched warehouse_origin_registry row for origin_business_name_raw + origin_raw.';

COMMENT ON COLUMN public.scalev_order_lines.item_name_raw IS
  'Raw line item label from ScaleV product-based export or webhook.';
COMMENT ON COLUMN public.scalev_order_lines.item_owner_raw IS
  'Raw stock-owner label from ScaleV product-based export or webhook.';
COMMENT ON COLUMN public.scalev_order_lines.stock_owner_business_code IS
  'Normalized internal business code for item_owner_raw.';

COMMIT;
