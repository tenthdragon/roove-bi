-- Migration 109: Warehouse activity log + running balance repair helper

CREATE TABLE IF NOT EXISTS public.warehouse_activity_log (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  action TEXT NOT NULL,
  screen TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_type TEXT NULL,
  target_id TEXT NULL,
  target_label TEXT NULL,
  business_code TEXT NULL,
  changed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  before_state JSONB NOT NULL DEFAULT '{}'::JSONB,
  after_state JSONB NOT NULL DEFAULT '{}'::JSONB,
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  acted_by UUID NULL REFERENCES public.profiles(id),
  acted_by_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_activity_log_created_at
  ON public.warehouse_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_activity_log_scope_created_at
  ON public.warehouse_activity_log (scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_activity_log_business_code
  ON public.warehouse_activity_log (business_code, created_at DESC);

COMMENT ON TABLE public.warehouse_activity_log IS
  'Audit log for sensitive warehouse configuration and mapping changes.';

CREATE OR REPLACE FUNCTION public.warehouse_recalculate_running_balances(
  p_product_ids INT[]
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id INT;
  v_row RECORD;
  v_running NUMERIC;
  v_count INT := 0;
BEGIN
  IF p_product_ids IS NULL OR COALESCE(array_length(p_product_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT unnest(p_product_ids)
  LOOP
    v_running := 0;

    FOR v_row IN
      SELECT id, quantity
      FROM public.warehouse_stock_ledger
      WHERE warehouse_product_id = v_product_id
      ORDER BY created_at ASC, id ASC
    LOOP
      v_running := v_running + COALESCE(v_row.quantity, 0);

      UPDATE public.warehouse_stock_ledger
      SET running_balance = v_running
      WHERE id = v_row.id
        AND running_balance IS DISTINCT FROM v_running;
    END LOOP;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.warehouse_recalculate_running_balances(INT[]) IS
  'Rebuilds warehouse_stock_ledger.running_balance for the provided warehouse_product_id list ordered by created_at and id.';
