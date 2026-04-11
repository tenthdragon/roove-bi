-- Migration 099: Link warehouse ledger to scalev_orders and align Meta/WABA RLS
-- Fixes two migration/runtime drifts:
-- 1. warehouse reverse/deduction previously keyed only by order_id text, which is
--    ambiguous across multi-business Scalev orders.
-- 2. Meta/WABA write policies still referenced legacy role checks instead of the
--    current permission matrix (`admin:meta` / owner).

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Link warehouse ledger rows to the internal Scalev order PK
-- ────────────────────────────────────────────────────────────
ALTER TABLE warehouse_stock_ledger
  ADD COLUMN IF NOT EXISTS scalev_order_id INT REFERENCES scalev_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN warehouse_stock_ledger.scalev_order_id IS
  'Optional FK to scalev_orders.id for unambiguous warehouse deduction/reversal in multi-business setups.';

CREATE INDEX IF NOT EXISTS idx_wsl_scalev_order_id
  ON warehouse_stock_ledger (scalev_order_id)
  WHERE scalev_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_business_order
  ON scalev_orders (business_code, order_id)
  WHERE business_code IS NOT NULL;

WITH unique_scalev_orders AS (
  SELECT order_id, MIN(id) AS scalev_order_id
  FROM scalev_orders
  GROUP BY order_id
  HAVING COUNT(*) = 1
)
UPDATE warehouse_stock_ledger wsl
SET scalev_order_id = uso.scalev_order_id
FROM unique_scalev_orders uso
WHERE wsl.reference_type = 'scalev_order'
  AND wsl.scalev_order_id IS NULL
  AND wsl.reference_id = uso.order_id;

-- ────────────────────────────────────────────────────────────
-- Extend FIFO deduction RPC to persist scalev_order_id
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS warehouse_deduct_fifo(INT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION warehouse_deduct_fifo(
  p_product_id INT,
  p_quantity NUMERIC,
  p_reference_type TEXT DEFAULT 'scalev_order',
  p_reference_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NULL,
  p_scalev_order_id INT DEFAULT NULL
)
RETURNS TABLE(batch_id INT, deducted NUMERIC) AS $$
DECLARE
  remaining NUMERIC := p_quantity;
  batch RECORD;
  deduct_qty NUMERIC;
  new_balance NUMERIC;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, NOW());
BEGIN
  FOR batch IN
    SELECT wb.id, wb.current_qty
    FROM warehouse_batches wb
    WHERE wb.warehouse_product_id = p_product_id
      AND wb.current_qty > 0
      AND wb.is_active = true
    ORDER BY wb.expired_date ASC NULLS LAST, wb.created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;

    deduct_qty := LEAST(batch.current_qty, remaining);

    UPDATE warehouse_batches
    SET current_qty = current_qty - deduct_qty
    WHERE id = batch.id;

    SELECT COALESCE(SUM(sl.quantity), 0) - deduct_qty
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, scalev_order_id, notes, created_at
    ) VALUES (
      p_product_id, batch.id, 'OUT', -deduct_qty,
      new_balance, p_reference_type, p_reference_id, p_scalev_order_id, p_notes, v_created_at
    );

    remaining := remaining - deduct_qty;
    batch_id := batch.id;
    deducted := deduct_qty;
    RETURN NEXT;
  END LOOP;

  IF remaining > 0 THEN
    SELECT COALESCE(SUM(sl.quantity), 0) - remaining
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, scalev_order_id, notes, created_at
    ) VALUES (
      p_product_id, NULL, 'OUT', -remaining,
      new_balance, p_reference_type, p_reference_id, p_scalev_order_id,
      COALESCE(p_notes, '') || ' [STOCK INSUFFICIENT: ' || remaining || ' units short]',
      v_created_at
    );

    batch_id := NULL;
    deducted := remaining;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- Extend reversal RPC to prefer scalev_order_id when available
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS warehouse_reverse_order(TEXT);

CREATE OR REPLACE FUNCTION warehouse_reverse_order(
  p_order_id TEXT DEFAULT NULL,
  p_scalev_order_id INT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  rec RECORD;
  reversed INT := 0;
  new_balance NUMERIC;
BEGIN
  IF p_order_id IS NULL AND p_scalev_order_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT id, warehouse_product_id, batch_id, quantity, notes, reference_id, scalev_order_id
    FROM warehouse_stock_ledger
    WHERE reference_type = 'scalev_order'
      AND movement_type = 'OUT'
      AND (
        (p_scalev_order_id IS NOT NULL AND scalev_order_id = p_scalev_order_id)
        OR (p_scalev_order_id IS NULL AND p_order_id IS NOT NULL AND reference_id = p_order_id)
      )
  LOOP
    SELECT COALESCE(SUM(sl.quantity), 0) + ABS(rec.quantity)
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = rec.warehouse_product_id;

    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, scalev_order_id, notes
    ) VALUES (
      rec.warehouse_product_id,
      rec.batch_id,
      'IN',
      ABS(rec.quantity),
      new_balance,
      'scalev_order',
      COALESCE(rec.reference_id, p_order_id),
      COALESCE(rec.scalev_order_id, p_scalev_order_id),
      'Reversal: order deleted — ' || COALESCE(rec.notes, '')
    );

    IF rec.batch_id IS NOT NULL THEN
      UPDATE warehouse_batches
      SET current_qty = current_qty + ABS(rec.quantity)
      WHERE id = rec.batch_id;
    END IF;

    reversed := reversed + 1;
  END LOOP;

  RETURN reversed;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- Permission helper + Meta/WABA write policy cleanup
-- ────────────────────────────────────────────────────────────
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
      ON rp.role = p.role
     AND rp.permission_key = p_permission_key
    WHERE p.id = auth.uid()
      AND (p.role = 'owner' OR rp.permission_key IS NOT NULL)
  );
$$;

DROP POLICY IF EXISTS "Owner manage meta_ad_accounts" ON meta_ad_accounts;
CREATE POLICY "Manage meta_ad_accounts via admin:meta" ON meta_ad_accounts
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Insert meta_sync_log" ON meta_sync_log;
DROP POLICY IF EXISTS "Delete meta_sync_log" ON meta_sync_log;
CREATE POLICY "Write meta_sync_log via admin:meta" ON meta_sync_log
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Owner manage waba_accounts" ON waba_accounts;
CREATE POLICY "Manage waba_accounts via admin:meta" ON waba_accounts
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Insert waba_sync_log" ON waba_sync_log;
DROP POLICY IF EXISTS "Delete waba_sync_log" ON waba_sync_log;
CREATE POLICY "Write waba_sync_log via admin:meta" ON waba_sync_log
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Write waba_templates" ON waba_templates;
CREATE POLICY "Write waba_templates via admin:meta" ON waba_templates
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Write waba_template_daily_analytics" ON waba_template_daily_analytics;
CREATE POLICY "Write waba_template_daily_analytics via admin:meta" ON waba_template_daily_analytics
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Write waba_template_sync_log" ON waba_template_sync_log;
CREATE POLICY "Write waba_template_sync_log via admin:meta" ON waba_template_sync_log
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

COMMIT;
