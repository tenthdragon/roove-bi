-- Migration 100: Repair warehouse schema drift for Scalev order linkage
-- Warehouse-only follow-up to keep production safe even if migration 099 was
-- skipped or partially applied. This aligns the ledger schema and RPC surface
-- that the shipment webhook and warehouse UI now depend on.

BEGIN;

ALTER TABLE public.warehouse_stock_ledger
  ADD COLUMN IF NOT EXISTS scalev_order_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.warehouse_stock_ledger'::regclass
      AND conname = 'warehouse_stock_ledger_scalev_order_id_fkey'
  ) THEN
    ALTER TABLE public.warehouse_stock_ledger
      ADD CONSTRAINT warehouse_stock_ledger_scalev_order_id_fkey
      FOREIGN KEY (scalev_order_id)
      REFERENCES public.scalev_orders(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON COLUMN public.warehouse_stock_ledger.scalev_order_id IS
  'Optional FK to scalev_orders.id for unambiguous warehouse deduction and reversal in multi-business setups.';

CREATE INDEX IF NOT EXISTS idx_wsl_scalev_order_id
  ON public.warehouse_stock_ledger (scalev_order_id)
  WHERE scalev_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_business_order
  ON public.scalev_orders (business_code, order_id)
  WHERE business_code IS NOT NULL;

WITH unique_scalev_orders AS (
  SELECT order_id, MIN(id) AS scalev_order_id
  FROM public.scalev_orders
  GROUP BY order_id
  HAVING COUNT(*) = 1
)
UPDATE public.warehouse_stock_ledger wsl
SET scalev_order_id = uso.scalev_order_id
FROM unique_scalev_orders uso
WHERE wsl.reference_type = 'scalev_order'
  AND wsl.scalev_order_id IS NULL
  AND wsl.reference_id = uso.order_id;

DROP FUNCTION IF EXISTS public.warehouse_deduct_fifo(INT, NUMERIC, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.warehouse_deduct_fifo(INT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.warehouse_deduct_fifo(INT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION public.warehouse_deduct_fifo(
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
    FROM public.warehouse_batches wb
    WHERE wb.warehouse_product_id = p_product_id
      AND wb.current_qty > 0
      AND wb.is_active = true
    ORDER BY wb.expired_date ASC NULLS LAST, wb.created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;

    deduct_qty := LEAST(batch.current_qty, remaining);

    UPDATE public.warehouse_batches
    SET current_qty = current_qty - deduct_qty
    WHERE id = batch.id;

    SELECT COALESCE(SUM(sl.quantity), 0) - deduct_qty
    INTO new_balance
    FROM public.warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO public.warehouse_stock_ledger (
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
    FROM public.warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO public.warehouse_stock_ledger (
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

DROP FUNCTION IF EXISTS public.warehouse_reverse_order(TEXT);
DROP FUNCTION IF EXISTS public.warehouse_reverse_order(TEXT, INT);

CREATE OR REPLACE FUNCTION public.warehouse_reverse_order(
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
    FROM public.warehouse_stock_ledger
    WHERE reference_type = 'scalev_order'
      AND movement_type = 'OUT'
      AND (
        (p_scalev_order_id IS NOT NULL AND scalev_order_id = p_scalev_order_id)
        OR (p_scalev_order_id IS NULL AND p_order_id IS NOT NULL AND reference_id = p_order_id)
      )
  LOOP
    SELECT COALESCE(SUM(sl.quantity), 0) + ABS(rec.quantity)
    INTO new_balance
    FROM public.warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = rec.warehouse_product_id;

    INSERT INTO public.warehouse_stock_ledger (
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
      UPDATE public.warehouse_batches
      SET current_qty = current_qty + ABS(rec.quantity)
      WHERE id = rec.batch_id;
    END IF;

    reversed := reversed + 1;
  END LOOP;

  RETURN reversed;
END;
$$ LANGUAGE plpgsql;

COMMIT;
