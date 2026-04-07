-- Migration 083: Add p_created_at parameter to warehouse_deduct_fifo
-- So auto-deduct and backfill can use shipped_time instead of NOW()

DROP FUNCTION IF EXISTS warehouse_deduct_fifo(INT, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION warehouse_deduct_fifo(
  p_product_id INT,
  p_quantity NUMERIC,
  p_reference_type TEXT DEFAULT 'scalev_order',
  p_reference_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(batch_id INT, deducted NUMERIC) AS $$
DECLARE
  remaining NUMERIC := p_quantity;
  batch RECORD;
  deduct_qty NUMERIC;
  new_balance NUMERIC;
  v_created_at TIMESTAMPTZ := COALESCE(p_created_at, NOW());
BEGIN
  -- Loop through batches FIFO (oldest expiry first)
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

    -- Update batch qty
    UPDATE warehouse_batches
    SET current_qty = current_qty - deduct_qty
    WHERE id = batch.id;

    -- Calculate running balance
    SELECT COALESCE(SUM(sl.quantity), 0) - deduct_qty
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    -- Insert ledger entry with specified created_at
    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, notes, created_at
    ) VALUES (
      p_product_id, batch.id, 'OUT', -deduct_qty,
      new_balance, p_reference_type, p_reference_id, p_notes, v_created_at
    );

    remaining := remaining - deduct_qty;
    batch_id := batch.id;
    deducted := deduct_qty;
    RETURN NEXT;
  END LOOP;

  -- If remaining > 0, stock insufficient — still record it as negative
  IF remaining > 0 THEN
    SELECT COALESCE(SUM(sl.quantity), 0) - remaining
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, notes, created_at
    ) VALUES (
      p_product_id, NULL, 'OUT', -remaining,
      new_balance, p_reference_type, p_reference_id,
      COALESCE(p_notes, '') || ' [STOCK INSUFFICIENT: ' || remaining || ' units short]',
      v_created_at
    );

    batch_id := NULL;
    deducted := remaining;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Fix existing ledger entries: set created_at to shipped_time of the order
UPDATE warehouse_stock_ledger wsl
SET created_at = o.shipped_time
FROM scalev_orders o
WHERE wsl.reference_type = 'scalev_order'
  AND wsl.reference_id = o.order_id
  AND o.shipped_time IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (wsl.created_at - o.shipped_time))) > 86400;
