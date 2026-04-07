-- Migration 088: Add warehouse_reverse_order function
-- Auto-reverses warehouse deductions when a Scalev order is deleted/canceled.
-- Creates matching IN entries for every OUT entry of the given order,
-- restores batch quantities, and recalculates running balances.

CREATE OR REPLACE FUNCTION warehouse_reverse_order(p_order_id TEXT)
RETURNS INT AS $$
DECLARE
  rec RECORD;
  reversed INT := 0;
  new_balance NUMERIC;
BEGIN
  -- Find all OUT deductions for this order
  FOR rec IN
    SELECT id, warehouse_product_id, batch_id, quantity, notes
    FROM warehouse_stock_ledger
    WHERE reference_type = 'scalev_order'
      AND reference_id = p_order_id
      AND movement_type = 'OUT'
  LOOP
    -- Calculate new running balance (current balance + reversal qty)
    SELECT COALESCE(SUM(sl.quantity), 0) + ABS(rec.quantity)
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = rec.warehouse_product_id;

    -- Insert reversal IN entry
    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, notes
    ) VALUES (
      rec.warehouse_product_id,
      rec.batch_id,
      'IN',
      ABS(rec.quantity),
      new_balance,
      'scalev_order',
      p_order_id,
      'Reversal: order deleted — ' || COALESCE(rec.notes, '')
    );

    -- Restore batch quantity if batch exists
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
