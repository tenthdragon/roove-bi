-- ============================================================================
-- 167: Workspace ownership for shared-warehouse inventory ledgers
-- ============================================================================
-- The physical warehouse may be shared, but products, batches and movements
-- remain private to their owning workspace.
-- ============================================================================

BEGIN;

ALTER TABLE public.warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_name_entity_warehouse_key;

-- Migration 105 intentionally allows the same product name to exist in more
-- than one inventory category (for example an FG and bonus variant). Replace
-- that global business key with the equivalent workspace-local key; do not
-- narrow it back to name/entity/warehouse.
ALTER TABLE public.warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_name_entity_warehouse_category_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_products_workspace_identity
  ON public.warehouse_products (
    owner_workspace_id,
    name,
    entity,
    warehouse,
    category
  );

ALTER TABLE public.warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_entity_check;
ALTER TABLE public.warehouse_products
  ADD CONSTRAINT warehouse_products_entity_check
  CHECK (entity IN ('RTI', 'RLB', 'JHN', 'RLT', 'APV'));

ALTER TABLE public.warehouse_business_mapping
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_deduct_entity_check;
ALTER TABLE public.warehouse_business_mapping
  ADD CONSTRAINT warehouse_business_mapping_deduct_entity_check
  CHECK (deduct_entity IN ('RTI', 'RLB', 'JHN', 'RLT', 'APV'));

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'warehouse_batches',
    'warehouse_stock_ledger',
    'warehouse_transfers'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID',
      v_table
    );
    EXECUTE format(
      'UPDATE public.%I child
       SET workspace_id = product.owner_workspace_id
       FROM public.warehouse_products product
       WHERE child.warehouse_product_id = product.id
         AND child.workspace_id IS NULL',
      v_table
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL',
      v_table
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND con.conname = v_table || '_workspace_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I
         ADD CONSTRAINT %I
         FOREIGN KEY (workspace_id)
         REFERENCES public.workspaces(id)
         ON DELETE RESTRICT',
        v_table,
        v_table || '_workspace_id_fkey'
      );
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (workspace_id)',
      'idx_' || v_table || '_workspace',
      v_table
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_workspace_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT owner_workspace_id
  INTO v_workspace_id
  FROM public.warehouse_products
  WHERE id = NEW.warehouse_product_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse product % not found', NEW.warehouse_product_id;
  END IF;

  IF NEW.workspace_id IS NOT NULL AND NEW.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'Inventory workspace does not match product owner';
  END IF;

  NEW.workspace_id := v_workspace_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_workspace_warehouse_batches ON public.warehouse_batches;
CREATE TRIGGER set_workspace_warehouse_batches
  BEFORE INSERT OR UPDATE OF warehouse_product_id, workspace_id
  ON public.warehouse_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_workspace_from_product();

DROP TRIGGER IF EXISTS set_workspace_warehouse_stock_ledger ON public.warehouse_stock_ledger;
CREATE TRIGGER set_workspace_warehouse_stock_ledger
  BEFORE INSERT OR UPDATE OF warehouse_product_id, workspace_id
  ON public.warehouse_stock_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_workspace_from_product();

DROP TRIGGER IF EXISTS set_workspace_warehouse_transfers ON public.warehouse_transfers;
CREATE TRIGGER set_workspace_warehouse_transfers
  BEFORE INSERT OR UPDATE OF warehouse_product_id, workspace_id
  ON public.warehouse_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_workspace_from_product();

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'warehouse_batches',
    'warehouse_stock_ledger',
    'warehouse_transfers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS workspace_inventory_workspace_isolation ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY workspace_inventory_workspace_isolation
       ON public.%I AS RESTRICTIVE
       FOR ALL TO authenticated
       USING (public.workspace_can_access(workspace_id))
       WITH CHECK (public.workspace_can_access(workspace_id))',
      v_table
    );
  END LOOP;
END
$$;

DROP VIEW IF EXISTS public.v_warehouse_batch_stock;
CREATE VIEW public.v_warehouse_batch_stock
WITH (security_invoker = true)
AS
SELECT
  wb.id AS batch_id,
  wb.batch_code,
  wb.expired_date,
  wb.current_qty,
  wb.cost_per_unit,
  wp.id AS product_id,
  wp.name AS product_name,
  wp.category,
  wp.entity,
  wp.warehouse,
  CASE WHEN wb.cost_per_unit > 0 THEN wb.cost_per_unit ELSE wp.hpp END AS effective_hpp,
  wp.price_list,
  CASE
    WHEN wb.expired_date IS NULL THEN 'no_expiry'
    WHEN wb.expired_date < CURRENT_DATE THEN 'expired'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
    ELSE 'safe'
  END AS expiry_status,
  CASE
    WHEN wb.expired_date IS NOT NULL THEN (wb.expired_date - CURRENT_DATE)
    ELSE NULL
  END AS days_remaining,
  wb.workspace_id
FROM public.warehouse_batches wb
JOIN public.warehouse_products wp ON wp.id = wb.warehouse_product_id
WHERE wb.is_active = TRUE
  AND wb.current_qty > 0
ORDER BY wb.expired_date ASC NULLS LAST;

DROP VIEW IF EXISTS public.v_warehouse_stock_balance;
CREATE VIEW public.v_warehouse_stock_balance
WITH (security_invoker = true)
AS
SELECT
  wp.id AS product_id,
  wp.name AS product_name,
  wp.sku,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.unit,
  wp.price_list,
  wp.hpp,
  wp.reorder_threshold,
  COALESCE(SUM(sl.quantity), 0) AS current_stock,
  COALESCE(
    (
      SELECT SUM(b.current_qty * CASE WHEN b.cost_per_unit > 0 THEN b.cost_per_unit ELSE wp.hpp END)
        / NULLIF(SUM(b.current_qty), 0)
      FROM public.warehouse_batches b
      WHERE b.workspace_id = wp.owner_workspace_id
        AND b.warehouse_product_id = wp.id
        AND b.is_active = TRUE
        AND b.current_qty > 0
    ),
    wp.hpp
  ) AS weighted_hpp,
  COALESCE(SUM(sl.quantity), 0) * wp.price_list AS stock_value,
  CASE
    WHEN wp.reorder_threshold > 0
      AND COALESCE(SUM(sl.quantity), 0) <= wp.reorder_threshold
    THEN TRUE
    ELSE FALSE
  END AS needs_reorder,
  wp.owner_workspace_id AS workspace_id
FROM public.warehouse_products wp
LEFT JOIN public.warehouse_stock_ledger sl
  ON sl.workspace_id = wp.owner_workspace_id
 AND sl.warehouse_product_id = wp.id
WHERE wp.is_active = TRUE
GROUP BY
  wp.id,
  wp.name,
  wp.sku,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.unit,
  wp.price_list,
  wp.hpp,
  wp.reorder_threshold,
  wp.owner_workspace_id;

COMMIT;
