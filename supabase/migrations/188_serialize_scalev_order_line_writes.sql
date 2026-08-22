-- Prevent concurrent ScaleV order-line transactions in the same workspace from
-- updating the same incremental-summary buckets in conflicting row order.
--
-- A multi-row upsert fires several row-level summary triggers. Without a shared
-- transaction lock, webhook bursts can deadlock halfway through ingestion. The
-- statement is rolled back, but the independently inserted order header remains.

CREATE OR REPLACE FUNCTION public.fn_serialize_scalev_order_line_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_key BIGINT;
  v_new_key BIGINT;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_old_key := hashtextextended(
      'scalev-order-lines:' || OLD.workspace_id::TEXT,
      0
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_key := hashtextextended(
      'scalev-order-lines:' || NEW.workspace_id::TEXT,
      0
    );
  END IF;

  IF v_old_key IS NOT NULL
     AND v_new_key IS NOT NULL
     AND v_old_key <> v_new_key THEN
    -- Workspace moves are rare, but deterministic lock order avoids introducing
    -- a new deadlock path if one occurs.
    PERFORM pg_advisory_xact_lock(LEAST(v_old_key, v_new_key));
    PERFORM pg_advisory_xact_lock(GREATEST(v_old_key, v_new_key));
  ELSE
    PERFORM pg_advisory_xact_lock(COALESCE(v_new_key, v_old_key));
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_trg_serialize_scalev_order_line_writes
  ON public.scalev_order_lines;
CREATE TRIGGER aa_trg_serialize_scalev_order_line_writes
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.scalev_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_serialize_scalev_order_line_writes();

COMMENT ON FUNCTION public.fn_serialize_scalev_order_line_writes() IS
  'Serializes ScaleV order-line writes per workspace so row-level summary triggers cannot deadlock during concurrent webhook batches.';
