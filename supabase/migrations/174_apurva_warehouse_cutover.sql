-- ============================================================================
-- 174: Purvu inventory cutover from Roove/JHN to independent Apurva/APV
-- ============================================================================
-- This intentionally copies only the closing position at cutover. Historical
-- movements remain in Roove and are not replayed into Apurva.
--
-- Apply during the 31 July 2026 operational freeze. The snapshot is calculated
-- from the ledger at execution time, closed in Roove, and opened in Apurva at
-- 1 August 2026 00:00 WIB.
-- ============================================================================

BEGIN;

LOCK TABLE public.warehouse_products IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.warehouse_batches IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.warehouse_stock_ledger IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.scalev_webhook_businesses
    WHERE workspace_id = '00000000-0000-4000-8000-000000000002'::uuid
      AND business_code = 'PRVA'
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Active PRVA Scalev business is required in Apurva Workspace';
  END IF;
END
$$;

CREATE TEMP TABLE apurva_cutover_products (
  source_product_id integer PRIMARY KEY,
  target_product_id integer,
  opening_qty numeric NOT NULL,
  source_name text NOT NULL,
  source_category text NOT NULL,
  source_hpp numeric NOT NULL
) ON COMMIT DROP;

INSERT INTO apurva_cutover_products (
  source_product_id,
  opening_qty,
  source_name,
  source_category,
  source_hpp
)
SELECT
  product.id,
  COALESCE(SUM(ledger.quantity), 0),
  product.name,
  product.category,
  COALESCE(product.hpp, 0)
FROM public.warehouse_products product
LEFT JOIN public.warehouse_stock_ledger ledger
  ON ledger.workspace_id = product.owner_workspace_id
 AND ledger.warehouse_product_id = product.id
WHERE product.owner_workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND product.entity = 'JHN'
  AND product.warehouse = 'BTN'
  AND product.name IN (
    'Purvu - Haram Memories 3 ml',
    'Purvu - Haram Memories 10 ml',
    'Purvu - Haram Memories 30 ml',
    'Purvu - Arabian Memories 3 ml',
    'Purvu - Arabian Memories 30 ml',
    'Purvu - Mediterranean Sea 3 ml',
    'Purvu - Mediterranean Sea 30 ml',
    'Purvu - TS Aisha 3 ml',
    'Purvu - TS Adele 3 ml',
    'Purvu - TS Ariana 3 ml',
    'Purvu - TS Arum 3 ml',
    'Purvu - TS Aisha 50 ml',
    'Purvu - TS Adele 50 ml',
    'Purvu - TS Ariana 50 ml',
    'Purvu - TS Arum 50 ml',
    'Purvu - Discovery Set TS 5 ml',
    'Discovery TS Aisha 5 ml',
    'Discovery TS Adele 5 ml',
    'Discovery TS Ariana 5 ml',
    'Discovery TS Arum 5 ml'
  )
GROUP BY
  product.id,
  product.name,
  product.category,
  product.hpp;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM apurva_cutover_products;
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'Expected 20 Purvu warehouse products for cutover, found %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM apurva_cutover_products
    WHERE opening_qty < 0
  ) THEN
    RAISE EXCEPTION 'Negative Purvu stock found; cutover aborted';
  END IF;
END
$$;

INSERT INTO public.warehouse_products (
  owner_workspace_id,
  name,
  sku,
  category,
  unit,
  price_list,
  reorder_threshold,
  entity,
  warehouse,
  scalev_product_names,
  is_active,
  hpp,
  vendor,
  vendor_id,
  brand_id,
  lead_time_days,
  safety_stock_days
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  source.name,
  source.sku,
  source.category,
  source.unit,
  source.price_list,
  source.reorder_threshold,
  'APV',
  'BTN',
  source.scalev_product_names,
  TRUE,
  source.hpp,
  NULL,
  NULL,
  NULL,
  source.lead_time_days,
  source.safety_stock_days
FROM public.warehouse_products source
JOIN apurva_cutover_products cutover
  ON cutover.source_product_id = source.id
ON CONFLICT (
  owner_workspace_id,
  name,
  entity,
  warehouse,
  category
) DO UPDATE
SET sku = EXCLUDED.sku,
    unit = EXCLUDED.unit,
    price_list = EXCLUDED.price_list,
    reorder_threshold = EXCLUDED.reorder_threshold,
    scalev_product_names = EXCLUDED.scalev_product_names,
    hpp = EXCLUDED.hpp,
    lead_time_days = EXCLUDED.lead_time_days,
    safety_stock_days = EXCLUDED.safety_stock_days,
    is_active = TRUE,
    updated_at = NOW();

UPDATE apurva_cutover_products cutover
SET target_product_id = target.id
FROM public.warehouse_products target
WHERE target.owner_workspace_id = '00000000-0000-4000-8000-000000000002'::uuid
  AND target.name = cutover.source_name
  AND target.category = cutover.source_category
  AND target.entity = 'APV'
  AND target.warehouse = 'BTN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM apurva_cutover_products
    WHERE target_product_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Apurva warehouse product cloning was incomplete';
  END IF;
END
$$;

-- Close Roove's ownership position without deleting any historical movement.
INSERT INTO public.warehouse_stock_ledger (
  workspace_id,
  warehouse_product_id,
  batch_id,
  movement_type,
  quantity,
  running_balance,
  reference_type,
  reference_id,
  notes,
  created_at
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  cutover.source_product_id,
  NULL,
  'TRANSFER_OUT',
  -cutover.opening_qty,
  0,
  'transfer',
  'APURVA-CUTOVER-2026-08-01',
  'Closing balance Purvu dari Roove/JHN; ownership inventory dilanjutkan oleh Apurva/APV tanpa replay histori',
  '2026-07-31T23:59:59+07:00'::timestamptz
FROM apurva_cutover_products cutover
WHERE cutover.opening_qty > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.warehouse_stock_ledger existing
    WHERE existing.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
      AND existing.warehouse_product_id = cutover.source_product_id
      AND existing.reference_type = 'transfer'
      AND existing.reference_id = 'APURVA-CUTOVER-2026-08-01'
  );

UPDATE public.warehouse_batches batch
SET current_qty = 0,
    is_active = FALSE
FROM apurva_cutover_products cutover
WHERE batch.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND batch.warehouse_product_id = cutover.source_product_id;

UPDATE public.warehouse_products source
SET is_active = FALSE,
    updated_at = NOW()
FROM apurva_cutover_products cutover
WHERE source.id = cutover.source_product_id
  AND source.owner_workspace_id = '00000000-0000-4000-8000-000000000001'::uuid;

-- Apurva receives a single clean opening batch per SKU. No pre-cutover order,
-- stock-in, RTS or stock-opname movement is copied.
INSERT INTO public.warehouse_batches (
  workspace_id,
  warehouse_product_id,
  batch_code,
  expired_date,
  initial_qty,
  current_qty,
  cost_per_unit,
  is_active,
  created_at
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  cutover.target_product_id,
  'APV-OPENING-20260801-' || cutover.source_product_id,
  NULL,
  cutover.opening_qty,
  cutover.opening_qty,
  cutover.source_hpp,
  TRUE,
  '2026-08-01T00:00:00+07:00'::timestamptz
FROM apurva_cutover_products cutover
WHERE cutover.opening_qty > 0
ON CONFLICT (warehouse_product_id, batch_code) DO UPDATE
SET initial_qty = EXCLUDED.initial_qty,
    current_qty = EXCLUDED.current_qty,
    cost_per_unit = EXCLUDED.cost_per_unit,
    is_active = TRUE;

INSERT INTO public.warehouse_stock_ledger (
  workspace_id,
  warehouse_product_id,
  batch_id,
  movement_type,
  quantity,
  running_balance,
  reference_type,
  reference_id,
  notes,
  created_at
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  cutover.target_product_id,
  batch.id,
  'IN',
  cutover.opening_qty,
  cutover.opening_qty,
  'manual',
  'APURVA-OPENING-2026-08-01',
  'Initial stock Apurva/APV per posisi penutupan Roove 31 Juli 2026; histori sebelumnya tidak direplay',
  '2026-08-01T00:00:00+07:00'::timestamptz
FROM apurva_cutover_products cutover
JOIN public.warehouse_batches batch
  ON batch.workspace_id = '00000000-0000-4000-8000-000000000002'::uuid
 AND batch.warehouse_product_id = cutover.target_product_id
 AND batch.batch_code = 'APV-OPENING-20260801-' || cutover.source_product_id
WHERE cutover.opening_qty > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.warehouse_stock_ledger existing
    WHERE existing.workspace_id = '00000000-0000-4000-8000-000000000002'::uuid
      AND existing.warehouse_product_id = cutover.target_product_id
      AND existing.reference_type = 'manual'
      AND existing.reference_id = 'APURVA-OPENING-2026-08-01'
  );

-- Copy only mapping configuration, never Roove mapping ownership.
INSERT INTO public.warehouse_scalev_mapping (
  workspace_id,
  scalev_product_name,
  warehouse_product_id,
  deduct_qty_multiplier,
  is_ignored,
  notes
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  source_mapping.scalev_product_name,
  cutover.target_product_id,
  source_mapping.deduct_qty_multiplier,
  FALSE,
  'Apurva cutover 1 Agustus 2026; disalin dari konfigurasi nama produk Purvu'
FROM public.warehouse_scalev_mapping source_mapping
JOIN apurva_cutover_products cutover
  ON cutover.source_product_id = source_mapping.warehouse_product_id
WHERE source_mapping.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
ON CONFLICT (workspace_id, scalev_product_name) DO UPDATE
SET warehouse_product_id = EXCLUDED.warehouse_product_id,
    deduct_qty_multiplier = EXCLUDED.deduct_qty_multiplier,
    is_ignored = FALSE,
    notes = EXCLUDED.notes,
    updated_at = NOW();

UPDATE public.warehouse_scalev_mapping source_mapping
SET is_ignored = TRUE,
    notes = 'Inactive setelah inventory Purvu cutover ke Apurva pada 1 Agustus 2026',
    updated_at = NOW()
FROM apurva_cutover_products cutover
WHERE source_mapping.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND source_mapping.warehouse_product_id = cutover.source_product_id;

INSERT INTO public.warehouse_business_mapping (
  workspace_id,
  business_code,
  deduct_entity,
  deduct_warehouse,
  is_active,
  is_primary,
  notes
)
VALUES (
  '00000000-0000-4000-8000-000000000002'::uuid,
  'PRVA',
  'APV',
  'BTN',
  TRUE,
  TRUE,
  'Independent Apurva warehouse; no fallback to Roove/JHN'
)
ON CONFLICT (workspace_id, business_code, deduct_entity, deduct_warehouse)
DO UPDATE
SET is_active = TRUE,
    is_primary = TRUE,
    notes = EXCLUDED.notes,
    updated_at = NOW();

INSERT INTO public.warehouse_activity_log (
  workspace_id,
  scope,
  action,
  screen,
  summary,
  target_type,
  target_id,
  target_label,
  business_code,
  changed_fields,
  before_state,
  after_state,
  context,
  acted_by_name,
  created_at
)
SELECT
  '00000000-0000-4000-8000-000000000002'::uuid,
  'workspace_warehouse_cutover',
  'opening_balance',
  'Warehouse',
  'Membuka warehouse independen Apurva dari closing position Purvu',
  'workspace',
  '00000000-0000-4000-8000-000000000002',
  'Apurva Workspace · BTN · APV',
  'PRVA',
  ARRAY['warehouse_mode', 'products', 'opening_stock', 'scalev_mapping'],
  '{}'::jsonb,
  jsonb_build_object(
    'products', COUNT(*),
    'opening_units', COALESCE(SUM(opening_qty), 0),
    'go_live_at', '2026-08-01T00:00:00+07:00'
  ),
  jsonb_build_object(
    'source_workspace', 'Roove Workspace',
    'source_entity', 'JHN',
    'history_replayed', FALSE
  ),
  'System migration 174',
  NOW()
FROM apurva_cutover_products
WHERE NOT EXISTS (
  SELECT 1
  FROM public.warehouse_activity_log existing
  WHERE existing.workspace_id = '00000000-0000-4000-8000-000000000002'::uuid
    AND existing.scope = 'workspace_warehouse_cutover'
    AND existing.action = 'opening_balance'
    AND existing.target_id = '00000000-0000-4000-8000-000000000002'
);

COMMIT;
