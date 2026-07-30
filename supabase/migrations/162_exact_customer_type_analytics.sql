-- ============================================================================
-- Migration 162: Exact customer-type analytics
-- ============================================================================
-- Marketplace/webhook orders do not carry a reliable raw customer_type label.
-- Treat customer_type as a derived metric instead:
--   new          = the order happened on the customer's lifetime first-order day
--   ro           = the order happened after that day
--   unidentified = the order has no usable customer identity
--
-- This migration:
--   1. keeps summary_customer_first_order complete for INSERT/UPDATE/DELETE,
--   2. uses Asia/Jakarta dates consistently,
--   3. exposes exact daily and period RPCs that deduplicate multi-line orders,
--   4. returns period customer counts without summing daily distinct counts.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_customer_qualifying_time
  ON public.scalev_orders (customer_identifier, shipped_time)
  WHERE customer_identifier IS NOT NULL
    AND shipped_time IS NOT NULL
    AND status IN ('shipped', 'completed');

-- Recompute one customer's first-order date from the current source of truth.
-- This is used for mutations that can move/remove the previously earliest order.
CREATE OR REPLACE FUNCTION public.refresh_customer_first_order_exact(
  p_customer_identifier TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_order_date DATE;
BEGIN
  IF p_customer_identifier IS NULL OR btrim(p_customer_identifier) = '' THEN
    RETURN;
  END IF;

  SELECT MIN((o.shipped_time AT TIME ZONE 'Asia/Jakarta')::date)
  INTO v_first_order_date
  FROM public.scalev_orders o
  WHERE o.customer_identifier = p_customer_identifier
    AND o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL;

  IF v_first_order_date IS NULL THEN
    DELETE FROM public.summary_customer_first_order
    WHERE customer_identifier = p_customer_identifier;
    RETURN;
  END IF;

  INSERT INTO public.summary_customer_first_order (
    customer_identifier,
    first_order_date
  )
  VALUES (
    p_customer_identifier,
    v_first_order_date
  )
  ON CONFLICT (customer_identifier) DO UPDATE
  SET first_order_date = EXCLUDED.first_order_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_customer_first_order_exact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_qualifying BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_qualifying :=
      NEW.customer_identifier IS NOT NULL
      AND btrim(NEW.customer_identifier) <> ''
      AND NEW.status IN ('shipped', 'completed')
      AND NEW.shipped_time IS NOT NULL;

    IF v_new_qualifying THEN
      INSERT INTO public.summary_customer_first_order (
        customer_identifier,
        first_order_date
      )
      VALUES (
        NEW.customer_identifier,
        (NEW.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
      )
      ON CONFLICT (customer_identifier) DO UPDATE
      SET first_order_date = LEAST(
        public.summary_customer_first_order.first_order_date,
        EXCLUDED.first_order_date
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_customer_first_order_exact(OLD.customer_identifier);
    RETURN OLD;
  END IF;

  -- Run after the legacy customer-summary trigger (the zz_ trigger name
  -- guarantees alphabetical ordering for triggers of the same kind).
  PERFORM public.refresh_customer_first_order_exact(OLD.customer_identifier);

  IF NEW.customer_identifier IS DISTINCT FROM OLD.customer_identifier THEN
    PERFORM public.refresh_customer_first_order_exact(NEW.customer_identifier);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_insert_delete
  ON public.scalev_orders;
CREATE TRIGGER zz_trg_customer_first_order_exact_insert_delete
  AFTER INSERT OR DELETE ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_customer_first_order_exact();

DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_update
  ON public.scalev_orders;
CREATE TRIGGER zz_trg_customer_first_order_exact_update
  AFTER UPDATE OF
    status,
    shipped_time,
    customer_identifier,
    customer_name,
    customer_phone,
    platform,
    order_id
  ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.shipped_time IS DISTINCT FROM NEW.shipped_time
    OR OLD.customer_identifier IS DISTINCT FROM NEW.customer_identifier
  )
  EXECUTE FUNCTION public.sync_customer_first_order_exact();

-- Repair all historical first-order dates, including orders inserted directly
-- in an already-shipped state (which the legacy UPDATE-only trigger missed).
INSERT INTO public.summary_customer_first_order (
  customer_identifier,
  first_order_date
)
SELECT
  o.customer_identifier,
  MIN((o.shipped_time AT TIME ZONE 'Asia/Jakarta')::date)
FROM public.scalev_orders o
WHERE o.customer_identifier IS NOT NULL
  AND btrim(o.customer_identifier) <> ''
  AND o.status IN ('shipped', 'completed')
  AND o.shipped_time IS NOT NULL
GROUP BY o.customer_identifier
ON CONFLICT (customer_identifier) DO UPDATE
SET first_order_date = EXCLUDED.first_order_date;

DELETE FROM public.summary_customer_first_order f
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scalev_orders o
  WHERE o.customer_identifier = f.customer_identifier
    AND o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
);

-- Exact daily rows, compatible with the existing v_daily_customer_type shape.
CREATE OR REPLACE FUNCTION public.get_customer_type_daily_exact(
  p_from DATE,
  p_to DATE,
  p_brand TEXT DEFAULT NULL,
  p_sales_channel TEXT DEFAULT NULL
)
RETURNS TABLE (
  date DATE,
  customer_type TEXT,
  sales_channel TEXT,
  order_count BIGINT,
  customer_count BIGINT,
  revenue NUMERIC,
  cogs NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH eligible_orders AS (
    SELECT
      o.id AS order_db_id,
      o.customer_identifier,
      (o.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS order_date
    FROM public.scalev_orders o
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time >= (p_from::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND o.shipped_time < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  ),
  order_channel AS (
    SELECT
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(btrim(l.sales_channel), ''), 'Unknown') AS sales_channel,
      SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS revenue,
      SUM(COALESCE(l.cogs_bt, 0)) AS cogs
    FROM eligible_orders eo
    JOIN public.scalev_order_lines l
      ON l.scalev_order_id = eo.order_db_id
    WHERE l.product_type IS NOT NULL
      AND l.product_type <> 'Unknown'
      AND (p_brand IS NULL OR l.product_type = p_brand)
      AND (
        p_sales_channel IS NULL
        OR COALESCE(NULLIF(btrim(l.sales_channel), ''), 'Unknown') = p_sales_channel
      )
    GROUP BY
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(btrim(l.sales_channel), ''), 'Unknown')
  ),
  first_orders AS (
    SELECT
      ids.customer_identifier,
      (
        SELECT (fo.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
        FROM public.scalev_orders fo
        WHERE fo.customer_identifier = ids.customer_identifier
          AND fo.status IN ('shipped', 'completed')
          AND fo.shipped_time IS NOT NULL
        ORDER BY fo.shipped_time
        LIMIT 1
      ) AS first_order_date
    FROM (
      SELECT DISTINCT oc.customer_identifier
      FROM order_channel oc
      WHERE oc.customer_identifier IS NOT NULL
        AND btrim(oc.customer_identifier) <> ''
        AND oc.customer_identifier NOT LIKE 'unidentified:%'
    ) ids
  ),
  typed AS (
    SELECT
      oc.*,
      CASE
        WHEN oc.customer_identifier IS NULL
          OR btrim(oc.customer_identifier) = ''
          OR oc.customer_identifier LIKE 'unidentified:%'
          THEN 'unidentified'
        WHEN oc.order_date = f.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_customer_type
    FROM order_channel oc
    LEFT JOIN first_orders f
      ON f.customer_identifier = oc.customer_identifier
  )
  SELECT
    t.order_date AS date,
    t.resolved_customer_type AS customer_type,
    t.sales_channel,
    COUNT(*)::bigint AS order_count,
    COUNT(DISTINCT t.customer_identifier)::bigint AS customer_count,
    SUM(t.revenue)::numeric AS revenue,
    SUM(t.cogs)::numeric AS cogs
  FROM typed t
  GROUP BY
    t.order_date,
    t.resolved_customer_type,
    t.sales_channel
  ORDER BY
    t.order_date,
    t.sales_channel,
    t.resolved_customer_type;
$$;

-- Exact period rows for the Customer Analytics UI.
-- Channel groups deliberately mirror app/dashboard/customers/page.tsx.
-- scope_customer_count is the distinct identified-customer denominator for
-- the whole scope; it prevents double-counting customers who bought on
-- multiple days or have both new and repeat orders in the selected period.
CREATE OR REPLACE FUNCTION public.get_customer_type_period_exact(
  p_from DATE,
  p_to DATE,
  p_brand TEXT DEFAULT NULL
)
RETURNS TABLE (
  channel_group TEXT,
  customer_type TEXT,
  order_count BIGINT,
  customer_count BIGINT,
  scope_customer_count BIGINT,
  revenue NUMERIC,
  cogs NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH eligible_orders AS (
    SELECT
      o.id AS order_db_id,
      o.customer_identifier,
      (o.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS order_date
    FROM public.scalev_orders o
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time >= (p_from::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND o.shipped_time < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  ),
  order_channel AS (
    SELECT
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(btrim(l.sales_channel), ''), 'Unknown') AS sales_channel,
      SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS revenue,
      SUM(COALESCE(l.cogs_bt, 0)) AS cogs
    FROM eligible_orders eo
    JOIN public.scalev_order_lines l
      ON l.scalev_order_id = eo.order_db_id
    WHERE l.product_type IS NOT NULL
      AND l.product_type <> 'Unknown'
      AND (p_brand IS NULL OR l.product_type = p_brand)
    GROUP BY
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(btrim(l.sales_channel), ''), 'Unknown')
  ),
  first_orders AS (
    SELECT
      ids.customer_identifier,
      (
        SELECT (fo.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
        FROM public.scalev_orders fo
        WHERE fo.customer_identifier = ids.customer_identifier
          AND fo.status IN ('shipped', 'completed')
          AND fo.shipped_time IS NOT NULL
        ORDER BY fo.shipped_time
        LIMIT 1
      ) AS first_order_date
    FROM (
      SELECT DISTINCT oc.customer_identifier
      FROM order_channel oc
      WHERE oc.customer_identifier IS NOT NULL
        AND btrim(oc.customer_identifier) <> ''
        AND oc.customer_identifier NOT LIKE 'unidentified:%'
    ) ids
  ),
  typed_channel AS (
    SELECT
      oc.*,
      CASE
        WHEN oc.customer_identifier IS NULL
          OR btrim(oc.customer_identifier) = ''
          OR oc.customer_identifier LIKE 'unidentified:%'
          THEN 'unidentified'
        WHEN oc.order_date = f.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_customer_type,
      CASE
        WHEN oc.sales_channel IN ('Scalev Ads', 'Google Ads') THEN 'Scalev Ads'
        WHEN oc.sales_channel = 'CS Manual' THEN 'CS Manual'
        WHEN oc.sales_channel = 'TikTok Shop' THEN 'TikTok Shop'
        WHEN oc.sales_channel = 'Reseller' THEN 'Reseller'
        WHEN oc.sales_channel = 'Shopee' THEN 'Shopee'
        ELSE 'Other Marketplaces'
      END AS resolved_channel_group
    FROM order_channel oc
    LEFT JOIN first_orders f
      ON f.customer_identifier = oc.customer_identifier
  ),
  order_group AS (
    SELECT
      tc.order_db_id,
      tc.customer_identifier,
      tc.order_date,
      tc.resolved_customer_type,
      tc.resolved_channel_group AS channel_group,
      SUM(tc.revenue) AS revenue,
      SUM(tc.cogs) AS cogs
    FROM typed_channel tc
    GROUP BY
      tc.order_db_id,
      tc.customer_identifier,
      tc.order_date,
      tc.resolved_customer_type,
      tc.resolved_channel_group
  ),
  scoped AS (
    SELECT
      og.order_db_id,
      og.customer_identifier,
      og.resolved_customer_type,
      og.channel_group,
      og.revenue,
      og.cogs
    FROM order_group og

    UNION ALL

    SELECT
      og.order_db_id,
      og.customer_identifier,
      og.resolved_customer_type,
      'Global'::text AS channel_group,
      SUM(og.revenue) AS revenue,
      SUM(og.cogs) AS cogs
    FROM order_group og
    GROUP BY
      og.order_db_id,
      og.customer_identifier,
      og.resolved_customer_type
  ),
  scope_totals AS (
    SELECT
      s.channel_group,
      COUNT(DISTINCT s.customer_identifier) FILTER (
        WHERE s.resolved_customer_type <> 'unidentified'
      )::bigint AS scope_customer_count
    FROM scoped s
    GROUP BY s.channel_group
  )
  SELECT
    s.channel_group,
    s.resolved_customer_type AS customer_type,
    COUNT(*)::bigint AS order_count,
    COUNT(DISTINCT s.customer_identifier)::bigint AS customer_count,
    st.scope_customer_count,
    SUM(s.revenue)::numeric AS revenue,
    SUM(s.cogs)::numeric AS cogs
  FROM scoped s
  JOIN scope_totals st
    ON st.channel_group = s.channel_group
  GROUP BY
    s.channel_group,
    s.resolved_customer_type,
    st.scope_customer_count
  ORDER BY
    s.channel_group,
    s.resolved_customer_type;
$$;

REVOKE ALL ON FUNCTION public.refresh_customer_first_order_exact(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_customer_first_order_exact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_type_daily_exact(DATE, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_type_period_exact(DATE, DATE, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_customer_type_daily_exact(DATE, DATE, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_type_period_exact(DATE, DATE, TEXT)
  TO authenticated, service_role;

COMMIT;
