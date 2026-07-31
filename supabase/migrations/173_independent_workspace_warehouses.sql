-- ============================================================================
-- 173: Independent warehouse tenancy
-- ============================================================================
-- A warehouse code is only a display/location code. Roove BTN and Apurva BTN
-- are separate operational warehouses whose master data, stock, mappings,
-- purchasing and employees are isolated by workspace.
-- ============================================================================

BEGIN;

UPDATE public.workspaces
SET settings = (
      COALESCE(settings, '{}'::jsonb)
      - 'shared_warehouse_code'
    ) || jsonb_build_object(
      'warehouse_mode', 'independent',
      'warehouse_code', 'BTN'
    ),
    updated_at = NOW()
WHERE id IN (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
);

UPDATE public.workspaces
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
      'inventory_entity', 'APV',
      'warehouse_baseline_date', '2026-08-01',
      'warehouse_go_live_at', '2026-08-01T00:00:00+07:00'
    ),
    updated_at = NOW()
WHERE id = '00000000-0000-4000-8000-000000000002'::uuid;

UPDATE public.workspace_warehouse_access
SET access_level = 'owner',
    is_active = TRUE,
    updated_at = NOW()
WHERE workspace_id IN (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
)
  AND warehouse_code = 'BTN';

-- Product creation is already tenant-aware in both warehouse paths. Remove its
-- compatibility default so a missing owner can never silently become Roove.
--
-- The other legacy warehouse tables intentionally keep their migration-164
-- defaults for now: those screens remain Roove-only and several established
-- writers still rely on the default. Cross-workspace product triggers below
-- reject a mismatched reference, while Apurva uses explicit workspace writes.
ALTER TABLE public.warehouse_products
  ALTER COLUMN owner_workspace_id DROP DEFAULT;

-- Tenant-local natural keys. The same product/mapping/vendor/location label is
-- valid in both companies without making the underlying row shared.
ALTER TABLE public.warehouse_scalev_mapping
  DROP CONSTRAINT IF EXISTS warehouse_scalev_mapping_scalev_product_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wsm_workspace_product_name
  ON public.warehouse_scalev_mapping (workspace_id, scalev_product_name);

ALTER TABLE public.warehouse_vendors
  DROP CONSTRAINT IF EXISTS warehouse_vendors_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_vendors_workspace_name
  ON public.warehouse_vendors (workspace_id, name);

ALTER TABLE public.warehouse_business_mapping
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_business_target_key;
DROP INDEX IF EXISTS public.idx_wbm_primary_per_business;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wbm_workspace_primary_business
  ON public.warehouse_business_mapping (workspace_id, business_code)
  WHERE is_primary = TRUE;

ALTER TABLE public.warehouse_stock_opname_sessions
  DROP CONSTRAINT IF EXISTS warehouse_stock_opname_sessions_entity_opname_date_opname_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wso_sessions_workspace_identity
  ON public.warehouse_stock_opname_sessions (
    workspace_id,
    entity,
    warehouse,
    opname_date,
    opname_label
  );

ALTER TABLE public.warehouse_stock_opname
  DROP CONSTRAINT IF EXISTS warehouse_stock_opname_warehouse_opname_date_opname_label_product_name_key;
-- Migration 114 deliberately moved operational uniqueness to
-- (session_id, warehouse_product_id). Historical sheet-import rows may have no
-- session/product id and can legitimately repeat a display name across entity
-- or category. Keep those rows intact and add only a tenant/date lookup index.
DROP INDEX IF EXISTS public.idx_wso_workspace_identity;
CREATE INDEX IF NOT EXISTS idx_wso_workspace_date
  ON public.warehouse_stock_opname (
    workspace_id,
    warehouse,
    opname_date
  );

ALTER TABLE public.warehouse_stock_summary
  DROP CONSTRAINT IF EXISTS warehouse_stock_summary_warehouse_period_month_period_year_product_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wss_workspace_period_product
  ON public.warehouse_stock_summary (
    workspace_id,
    warehouse,
    period_month,
    period_year,
    product_name
  );

ALTER TABLE public.warehouse_daily_stock
  DROP CONSTRAINT IF EXISTS warehouse_daily_stock_warehouse_date_product_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wds_workspace_date_product
  ON public.warehouse_daily_stock (workspace_id, warehouse, date, product_name);

ALTER TABLE public.warehouse_business_directory
  DROP CONSTRAINT IF EXISTS warehouse_business_directory_external_name_normalized_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wbd_workspace_external_name
  ON public.warehouse_business_directory (workspace_id, external_name_normalized);

ALTER TABLE public.warehouse_origin_registry
  DROP CONSTRAINT IF EXISTS warehouse_origin_registry_external_origin_business_name_normalized_external_origin_name_normalized_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wor_workspace_external_origin
  ON public.warehouse_origin_registry (
    workspace_id,
    external_origin_business_name_normalized,
    external_origin_name_normalized
  );

-- Any row that points at a warehouse product must belong to that product's
-- workspace. This protects service-role writers, which bypass RLS.
CREATE OR REPLACE FUNCTION public.enforce_warehouse_product_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_workspace uuid;
BEGIN
  IF NEW.warehouse_product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT owner_workspace_id
  INTO v_product_workspace
  FROM public.warehouse_products
  WHERE id = NEW.warehouse_product_id;

  IF v_product_workspace IS NULL THEN
    RAISE EXCEPTION 'Warehouse product % not found', NEW.warehouse_product_id;
  END IF;

  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := v_product_workspace;
  ELSIF NEW.workspace_id <> v_product_workspace THEN
    RAISE EXCEPTION 'Cross-workspace warehouse product reference is forbidden';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_trigger text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'warehouse_scalev_mapping',
    'warehouse_demand_plans',
    'warehouse_stock_opname',
    'warehouse_rts_verification_items'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      v_trigger := 'enforce_product_workspace_' || v_table;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trigger, v_table);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF workspace_id, warehouse_product_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_warehouse_product_workspace()',
        v_trigger,
        v_table
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.enforce_catalog_mapping_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_workspace uuid;
  v_product_workspace uuid;
BEGIN
  SELECT workspace_id
  INTO v_business_workspace
  FROM public.scalev_webhook_businesses
  WHERE id = NEW.business_id;

  IF v_business_workspace IS NULL OR NEW.workspace_id <> v_business_workspace THEN
    RAISE EXCEPTION 'Scalev business does not belong to mapping workspace';
  END IF;

  IF NEW.warehouse_product_id IS NOT NULL THEN
    SELECT owner_workspace_id
    INTO v_product_workspace
    FROM public.warehouse_products
    WHERE id = NEW.warehouse_product_id;

    IF v_product_workspace IS NULL OR NEW.workspace_id <> v_product_workspace THEN
      RAISE EXCEPTION 'Warehouse product does not belong to mapping workspace';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_catalog_mapping_workspace
  ON public.warehouse_scalev_catalog_mapping;
CREATE TRIGGER enforce_catalog_mapping_workspace
  BEFORE INSERT OR UPDATE OF workspace_id, business_id, warehouse_product_id
  ON public.warehouse_scalev_catalog_mapping
  FOR EACH ROW EXECUTE FUNCTION public.enforce_catalog_mapping_workspace();

CREATE OR REPLACE FUNCTION public.enforce_business_mapping_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.scalev_webhook_businesses business
    WHERE business.workspace_id = NEW.workspace_id
      AND business.business_code = NEW.business_code
  ) THEN
    RAISE EXCEPTION 'Scalev business code does not belong to warehouse workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_business_mapping_workspace
  ON public.warehouse_business_mapping;
CREATE TRIGGER enforce_business_mapping_workspace
  BEFORE INSERT OR UPDATE OF workspace_id, business_code
  ON public.warehouse_business_mapping
  FOR EACH ROW EXECUTE FUNCTION public.enforce_business_mapping_workspace();

-- Strict FIFO endpoint for workers. It validates workspace ownership before
-- touching any batch or ledger row and cannot silently fall back to Roove.
CREATE OR REPLACE FUNCTION public.warehouse_deduct_fifo_workspace(
  p_workspace_id uuid,
  p_product_id integer,
  p_quantity numeric,
  p_reference_type text DEFAULT 'scalev_order',
  p_reference_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_at timestamptz DEFAULT NULL,
  p_scalev_order_id integer DEFAULT NULL
)
RETURNS TABLE(batch_id integer, deducted numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining numeric := p_quantity;
  v_batch record;
  v_deduct_qty numeric;
  v_new_balance numeric;
  v_created_at timestamptz := COALESCE(p_created_at, NOW());
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Deduction quantity must be positive';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouse_products product
    WHERE product.id = p_product_id
      AND product.owner_workspace_id = p_workspace_id
      AND product.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Warehouse product does not belong to workspace';
  END IF;

  IF p_scalev_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.scalev_orders order_row
    WHERE order_row.id = p_scalev_order_id
      AND order_row.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Scalev order does not belong to workspace';
  END IF;

  FOR v_batch IN
    SELECT batch.id, batch.current_qty
    FROM public.warehouse_batches batch
    WHERE batch.workspace_id = p_workspace_id
      AND batch.warehouse_product_id = p_product_id
      AND batch.current_qty > 0
      AND batch.is_active = TRUE
    ORDER BY batch.expired_date ASC NULLS LAST, batch.created_at ASC, batch.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct_qty := LEAST(v_batch.current_qty, v_remaining);

    UPDATE public.warehouse_batches
    SET current_qty = current_qty - v_deduct_qty
    WHERE id = v_batch.id
      AND workspace_id = p_workspace_id;

    SELECT COALESCE(SUM(quantity), 0) - v_deduct_qty
    INTO v_new_balance
    FROM public.warehouse_stock_ledger
    WHERE workspace_id = p_workspace_id
      AND warehouse_product_id = p_product_id;

    INSERT INTO public.warehouse_stock_ledger (
      workspace_id,
      warehouse_product_id,
      batch_id,
      movement_type,
      quantity,
      running_balance,
      reference_type,
      reference_id,
      scalev_order_id,
      notes,
      created_at
    ) VALUES (
      p_workspace_id,
      p_product_id,
      v_batch.id,
      'OUT',
      -v_deduct_qty,
      v_new_balance,
      p_reference_type,
      p_reference_id,
      p_scalev_order_id,
      p_notes,
      v_created_at
    );

    v_remaining := v_remaining - v_deduct_qty;
    batch_id := v_batch.id;
    deducted := v_deduct_qty;
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 THEN
    SELECT COALESCE(SUM(quantity), 0) - v_remaining
    INTO v_new_balance
    FROM public.warehouse_stock_ledger
    WHERE workspace_id = p_workspace_id
      AND warehouse_product_id = p_product_id;

    INSERT INTO public.warehouse_stock_ledger (
      workspace_id,
      warehouse_product_id,
      batch_id,
      movement_type,
      quantity,
      running_balance,
      reference_type,
      reference_id,
      scalev_order_id,
      notes,
      created_at
    ) VALUES (
      p_workspace_id,
      p_product_id,
      NULL,
      'OUT',
      -v_remaining,
      v_new_balance,
      p_reference_type,
      p_reference_id,
      p_scalev_order_id,
      COALESCE(p_notes, '') || ' [STOCK INSUFFICIENT: ' || v_remaining || ' units short]',
      v_created_at
    );

    batch_id := NULL;
    deducted := v_remaining;
    RETURN NEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.warehouse_deduct_fifo_workspace(
  uuid,
  integer,
  numeric,
  text,
  text,
  text,
  timestamptz,
  integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_deduct_fifo_workspace(
  uuid,
  integer,
  numeric,
  text,
  text,
  text,
  timestamptz,
  integer
) TO service_role;

-- Atomic manual adjustment for the independent warehouse screen. Positive
-- adjustments always create a FIFO batch; negative adjustments consume only
-- batches owned by the same workspace and abort completely on inconsistency.
CREATE OR REPLACE FUNCTION public.warehouse_adjust_stock_workspace(
  p_workspace_id uuid,
  p_product_id integer,
  p_quantity numeric,
  p_reference_id text,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hpp numeric;
  v_balance numeric;
  v_next_balance numeric;
  v_batch_id integer;
  v_remaining numeric;
  v_batch record;
  v_deduct_qty numeric;
  v_batch_code text;
BEGIN
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;

  SELECT COALESCE(product.hpp, 0)
  INTO v_hpp
  FROM public.warehouse_products product
  WHERE product.id = p_product_id
    AND product.owner_workspace_id = p_workspace_id
    AND product.is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Warehouse product does not belong to workspace';
  END IF;

  SELECT COALESCE(SUM(quantity), 0)
  INTO v_balance
  FROM public.warehouse_stock_ledger
  WHERE workspace_id = p_workspace_id
    AND warehouse_product_id = p_product_id;

  v_next_balance := v_balance + p_quantity;
  IF v_next_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient workspace stock. Current balance: %', v_balance;
  END IF;

  IF p_quantity > 0 THEN
    v_batch_code := COALESCE(NULLIF(TRIM(p_reference_id), ''), 'MANUAL-IN')
      || '-' || LEFT(gen_random_uuid()::text, 8);

    INSERT INTO public.warehouse_batches (
      workspace_id,
      warehouse_product_id,
      batch_code,
      expired_date,
      initial_qty,
      current_qty,
      cost_per_unit,
      is_active
    ) VALUES (
      p_workspace_id,
      p_product_id,
      v_batch_code,
      NULL,
      p_quantity,
      p_quantity,
      v_hpp,
      TRUE
    )
    RETURNING id INTO v_batch_id;

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
      created_by
    ) VALUES (
      p_workspace_id,
      p_product_id,
      v_batch_id,
      'IN',
      p_quantity,
      v_next_balance,
      'manual',
      p_reference_id,
      p_notes,
      p_created_by
    );
  ELSE
    v_remaining := ABS(p_quantity);

    FOR v_batch IN
      SELECT batch.id, batch.current_qty
      FROM public.warehouse_batches batch
      WHERE batch.workspace_id = p_workspace_id
        AND batch.warehouse_product_id = p_product_id
        AND batch.current_qty > 0
        AND batch.is_active = TRUE
      ORDER BY batch.expired_date ASC NULLS LAST, batch.created_at ASC, batch.id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_deduct_qty := LEAST(v_batch.current_qty, v_remaining);

      UPDATE public.warehouse_batches
      SET current_qty = current_qty - v_deduct_qty,
          is_active = (current_qty - v_deduct_qty) > 0
      WHERE id = v_batch.id
        AND workspace_id = p_workspace_id;

      v_balance := v_balance - v_deduct_qty;
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
        created_by
      ) VALUES (
        p_workspace_id,
        p_product_id,
        v_batch.id,
        'OUT',
        -v_deduct_qty,
        v_balance,
        'manual',
        p_reference_id,
        p_notes,
        p_created_by
      );

      v_remaining := v_remaining - v_deduct_qty;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Batch stock is inconsistent with ledger. Missing: %', v_remaining;
    END IF;
  END IF;

  RETURN v_next_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.warehouse_adjust_stock_workspace(
  uuid,
  integer,
  numeric,
  text,
  text,
  uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.warehouse_adjust_stock_workspace(
  uuid,
  integer,
  numeric,
  text,
  text,
  uuid
) TO service_role;

COMMIT;
