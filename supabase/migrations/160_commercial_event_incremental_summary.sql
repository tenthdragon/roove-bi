-- Commercial event revenue read model.
--
-- The Sales Channel Analysis page previously rebuilt seven event windows from
-- raw orders and lines on every read. This table keeps the four values the UI
-- needs incrementally, grouped by order-entry date and brand.

BEGIN;

CREATE TABLE IF NOT EXISTS public.summary_commercial_order_entry_revenue (
  order_date DATE NOT NULL,
  product TEXT NOT NULL,
  total_net_sales NUMERIC NOT NULL DEFAULT 0,
  same_day_net_sales NUMERIC NOT NULL DEFAULT 0,
  carryover_net_sales NUMERIC NOT NULL DEFAULT 0,
  before_noon_net_sales NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_date, product)
);

COMMENT ON TABLE public.summary_commercial_order_entry_revenue IS
  'Incremental net sales by ScaleV order-entry date (WIB) and brand for Commercial Moments analysis.';

CREATE INDEX IF NOT EXISTS idx_commercial_order_entry_revenue_product_date
  ON public.summary_commercial_order_entry_revenue (product, order_date);

CREATE OR REPLACE FUNCTION public.fn_apply_commercial_order_entry_revenue_delta(
  p_draft_time TIMESTAMPTZ,
  p_shipped_time TIMESTAMPTZ,
  p_product TEXT,
  p_net_sales_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_date DATE;
  v_shipment_date DATE;
  v_product TEXT;
  v_same_day BOOLEAN;
  v_before_noon BOOLEAN;
BEGIN
  v_product := BTRIM(COALESCE(p_product, ''));

  IF p_draft_time IS NULL
     OR p_shipped_time IS NULL
     OR v_product = ''
     OR v_product = 'Unknown'
     OR COALESCE(p_net_sales_delta, 0) = 0 THEN
    RETURN;
  END IF;

  v_order_date := DATE(p_draft_time AT TIME ZONE 'Asia/Jakarta');
  v_shipment_date := DATE(p_shipped_time AT TIME ZONE 'Asia/Jakarta');
  v_same_day := v_order_date = v_shipment_date;
  v_before_noon := EXTRACT(HOUR FROM p_draft_time AT TIME ZONE 'Asia/Jakarta') < 12;

  INSERT INTO public.summary_commercial_order_entry_revenue (
    order_date,
    product,
    total_net_sales,
    same_day_net_sales,
    carryover_net_sales,
    before_noon_net_sales,
    updated_at
  )
  VALUES (
    v_order_date,
    v_product,
    p_net_sales_delta,
    CASE WHEN v_same_day THEN p_net_sales_delta ELSE 0 END,
    CASE WHEN v_same_day THEN 0 ELSE p_net_sales_delta END,
    CASE WHEN v_before_noon THEN p_net_sales_delta ELSE 0 END,
    NOW()
  )
  ON CONFLICT (order_date, product) DO UPDATE
    SET total_net_sales =
          summary_commercial_order_entry_revenue.total_net_sales + EXCLUDED.total_net_sales,
        same_day_net_sales =
          summary_commercial_order_entry_revenue.same_day_net_sales + EXCLUDED.same_day_net_sales,
        carryover_net_sales =
          summary_commercial_order_entry_revenue.carryover_net_sales + EXCLUDED.carryover_net_sales,
        before_noon_net_sales =
          summary_commercial_order_entry_revenue.before_noon_net_sales + EXCLUDED.before_noon_net_sales,
        updated_at = NOW();

  DELETE FROM public.summary_commercial_order_entry_revenue
  WHERE order_date = v_order_date
    AND product = v_product
    AND ABS(total_net_sales) < 0.000001
    AND ABS(same_day_net_sales) < 0.000001
    AND ABS(carryover_net_sales) < 0.000001
    AND ABS(before_noon_net_sales) < 0.000001;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_commercial_order_entry_revenue(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_from DATE;
  v_to DATE;
BEGIN
  IF (p_from IS NULL) <> (p_to IS NULL) THEN
    RAISE EXCEPTION 'p_from and p_to must both be provided or both be null';
  END IF;

  IF p_from IS NULL THEN
    TRUNCATE public.summary_commercial_order_entry_revenue;
  ELSE
    v_from := LEAST(p_from, p_to);
    v_to := GREATEST(p_from, p_to);

    DELETE FROM public.summary_commercial_order_entry_revenue
    WHERE order_date BETWEEN v_from AND v_to;
  END IF;

  INSERT INTO public.summary_commercial_order_entry_revenue (
    order_date,
    product,
    total_net_sales,
    same_day_net_sales,
    carryover_net_sales,
    before_noon_net_sales,
    updated_at
  )
  SELECT
    DATE(o.draft_time AT TIME ZONE 'Asia/Jakarta') AS order_date,
    BTRIM(l.product_type) AS product,
    SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS total_net_sales,
    SUM(
      CASE
        WHEN DATE(o.draft_time AT TIME ZONE 'Asia/Jakarta')
           = DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta')
          THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
        ELSE 0
      END
    ) AS same_day_net_sales,
    SUM(
      CASE
        WHEN DATE(o.draft_time AT TIME ZONE 'Asia/Jakarta')
           <> DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta')
          THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
        ELSE 0
      END
    ) AS carryover_net_sales,
    SUM(
      CASE
        WHEN EXTRACT(HOUR FROM o.draft_time AT TIME ZONE 'Asia/Jakarta') < 12
          THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
        ELSE 0
      END
    ) AS before_noon_net_sales,
    NOW()
  FROM public.scalev_orders o
  JOIN public.scalev_order_lines l
    ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.draft_time IS NOT NULL
    AND o.shipped_time IS NOT NULL
    AND COALESCE(BTRIM(l.product_type), '') NOT IN ('', 'Unknown')
    AND (
      p_from IS NULL
      OR (
        o.draft_time >= (v_from::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
        AND o.draft_time < ((v_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
      )
    )
  GROUP BY
    DATE(o.draft_time AT TIME ZONE 'Asia/Jakarta'),
    BTRIM(l.product_type);
END;
$$;

COMMENT ON FUNCTION public.refresh_commercial_order_entry_revenue(DATE, DATE) IS
  'Rebuilds Commercial Moments revenue summary fully, or for an inclusive WIB order-date range.';

CREATE OR REPLACE FUNCTION public.fn_update_commercial_revenue_from_line()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order public.scalev_orders%ROWTYPE;
  v_old_order public.scalev_orders%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascaded line deletes are handled once by the parent-order delete trigger.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;

    SELECT * INTO v_old_order
    FROM public.scalev_orders
    WHERE id = OLD.scalev_order_id;

    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.draft_time IS NOT NULL
       AND v_old_order.shipped_time IS NOT NULL THEN
      PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
        v_old_order.draft_time,
        v_old_order.shipped_time,
        OLD.product_type,
        -(COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0))
      );
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_old_order
    FROM public.scalev_orders
    WHERE id = OLD.scalev_order_id;

    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.draft_time IS NOT NULL
       AND v_old_order.shipped_time IS NOT NULL THEN
      PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
        v_old_order.draft_time,
        v_old_order.shipped_time,
        OLD.product_type,
        -(COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0))
      );
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM public.scalev_orders
  WHERE id = NEW.scalev_order_id;

  IF v_order.status IN ('shipped', 'completed')
     AND v_order.draft_time IS NOT NULL
     AND v_order.shipped_time IS NOT NULL THEN
    PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
      v_order.draft_time,
      v_order.shipped_time,
      NEW.product_type,
      COALESCE(NEW.product_price_bt, 0) - COALESCE(NEW.discount_bt, 0)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_commercial_revenue_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_line RECORD;
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed')
    AND OLD.draft_time IS NOT NULL
    AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed')
    AND NEW.draft_time IS NOT NULL
    AND NEW.shipped_time IS NOT NULL;

  IF v_old_qualifying = v_new_qualifying
     AND OLD.draft_time IS NOT DISTINCT FROM NEW.draft_time
     AND OLD.shipped_time IS NOT DISTINCT FROM NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  FOR v_line IN
    SELECT product_type, product_price_bt, discount_bt
    FROM public.scalev_order_lines
    WHERE scalev_order_id = NEW.id
  LOOP
    IF v_old_qualifying THEN
      PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
        OLD.draft_time,
        OLD.shipped_time,
        v_line.product_type,
        -(COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0))
      );
    END IF;

    IF v_new_qualifying THEN
      PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
        NEW.draft_time,
        NEW.shipped_time,
        v_line.product_type,
        COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_delete_commercial_revenue_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_line RECORD;
BEGIN
  IF OLD.status NOT IN ('shipped', 'completed')
     OR OLD.draft_time IS NULL
     OR OLD.shipped_time IS NULL THEN
    RETURN OLD;
  END IF;

  FOR v_line IN
    SELECT product_type, product_price_bt, discount_bt
    FROM public.scalev_order_lines
    WHERE scalev_order_id = OLD.id
  LOOP
    PERFORM public.fn_apply_commercial_order_entry_revenue_delta(
      OLD.draft_time,
      OLD.shipped_time,
      v_line.product_type,
      -(COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0))
    );
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_commercial_revenue_line ON public.scalev_order_lines;
CREATE TRIGGER trg_commercial_revenue_line
  AFTER INSERT OR UPDATE OR DELETE
  ON public.scalev_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_line();

DROP TRIGGER IF EXISTS trg_commercial_revenue_order ON public.scalev_orders;
CREATE TRIGGER trg_commercial_revenue_order
  AFTER UPDATE OF status, draft_time, shipped_time
  ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_order();

DROP TRIGGER IF EXISTS trg_commercial_revenue_order_delete ON public.scalev_orders;
CREATE TRIGGER trg_commercial_revenue_order_delete
  BEFORE DELETE
  ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_delete_commercial_revenue_from_order();

SELECT public.refresh_commercial_order_entry_revenue();

ALTER TABLE public.summary_commercial_order_entry_revenue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.summary_commercial_order_entry_revenue FROM anon, authenticated;
GRANT SELECT ON TABLE public.summary_commercial_order_entry_revenue TO service_role;

REVOKE ALL ON FUNCTION public.refresh_commercial_order_entry_revenue(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_commercial_order_entry_revenue(DATE, DATE) TO service_role;

COMMIT;
