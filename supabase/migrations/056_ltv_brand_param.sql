-- ============================================================================
-- Migration 056: Add brand parameter to LTV functions
-- ============================================================================
-- Updates get_channel_ltv_90d and get_ltv_trend_by_cohort to accept
-- a brand_filter parameter. NULL or empty = all brands combined.
-- Also adds get_available_brands() for the brand selector.
-- ============================================================================

-- 1. Available brands function
CREATE OR REPLACE FUNCTION get_available_brands()
RETURNS TABLE(brand TEXT, order_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT product_type AS brand, COUNT(*)::BIGINT AS order_count
  FROM scalev_order_lines
  WHERE product_type IS NOT NULL
    AND product_type NOT IN ('Other', 'Unknown')
  GROUP BY product_type
  HAVING COUNT(*) >= 50
  ORDER BY COUNT(*) DESC;
$$;

-- 2. Update get_channel_ltv_90d with brand parameter
DROP FUNCTION IF EXISTS get_channel_ltv_90d();

CREATE OR REPLACE FUNCTION get_channel_ltv_90d(brand_filter TEXT DEFAULT NULL)
RETURNS TABLE(
  channel_group TEXT,
  num_customers BIGINT,
  avg_first_purchase NUMERIC,
  avg_repeat_value NUMERIC,
  avg_ltv_90d NUMERIC,
  repeat_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
BEGIN
  RETURN QUERY
  WITH customer_ltv AS (
    SELECT
      COALESCE(get_channel_group(sc.first_channel), 'Other') AS cg,
      sc.customer_phone AS cust_id,
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) = sc.first_order_date
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS first_val,
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS repeat_val,
      CASE WHEN COUNT(DISTINCT CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
        THEN o.id END) > 0 THEN 1 ELSE 0 END AS is_repeater
    FROM summary_customer_cohort sc
    JOIN scalev_orders o ON o.customer_identifier = sc.customer_phone
    JOIN scalev_order_lines l ON l.scalev_order_id = o.id
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND DATE(o.shipped_time) <= sc.first_order_date + 90
      AND sc.first_order_date <= CURRENT_DATE - 90
      AND sc.customer_phone NOT LIKE 'unidentified:%'
      AND get_channel_group(sc.first_channel) IS NOT NULL
      AND (brand_filter IS NULL OR l.product_type = brand_filter)
    GROUP BY cg, sc.customer_phone, sc.first_order_date
  )
  SELECT r.channel_group, r.num_customers, r.avg_first_purchase, r.avg_repeat_value, r.avg_ltv_90d, r.repeat_rate
  FROM (
    SELECT
      cl.cg AS channel_group,
      COUNT(*)::BIGINT AS num_customers,
      ROUND(AVG(cl.first_val), 0) AS avg_first_purchase,
      ROUND(AVG(cl.repeat_val), 0) AS avg_repeat_value,
      ROUND(AVG(cl.first_val + cl.repeat_val), 0) AS avg_ltv_90d,
      ROUND(SUM(cl.is_repeater)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS repeat_rate,
      1 AS sort_order
    FROM customer_ltv cl
    GROUP BY cl.cg

    UNION ALL

    SELECT
      'Global'::TEXT,
      COUNT(*)::BIGINT,
      ROUND(AVG(cl.first_val), 0),
      ROUND(AVG(cl.repeat_val), 0),
      ROUND(AVG(cl.first_val + cl.repeat_val), 0),
      ROUND(SUM(cl.is_repeater)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1),
      0
    FROM customer_ltv cl
  ) r
  ORDER BY r.sort_order, r.num_customers DESC;
END;
$$;

-- 3. Update get_ltv_trend_by_cohort with brand parameter
-- OPTIMIZED: filter product_type in WHERE clause for massive row reduction
DROP FUNCTION IF EXISTS get_ltv_trend_by_cohort();

CREATE OR REPLACE FUNCTION get_ltv_trend_by_cohort(brand_filter TEXT DEFAULT NULL)
RETURNS TABLE(
  cohort_month TEXT,
  channel_group TEXT,
  num_customers BIGINT,
  avg_first_purchase NUMERIC,
  avg_repeat_value NUMERIC,
  avg_ltv_90d NUMERIC,
  avg_ltv_lifetime NUMERIC,
  avg_after_90d NUMERIC,
  repeat_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
BEGIN
  RETURN QUERY
  WITH customer_ltv AS (
    SELECT
      TO_CHAR(sc.first_order_date, 'YYYY-MM') AS cohort_m,
      COALESCE(get_channel_group(sc.first_channel), 'Other') AS cg,
      sc.customer_phone AS cust_id,
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) = sc.first_order_date
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS first_val,
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS repeat_90d_val,
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date + 90
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS after_90d_val,
      CASE WHEN COUNT(DISTINCT CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
        THEN o.id END) > 0 THEN 1 ELSE 0 END AS is_repeater
    FROM summary_customer_cohort sc
    JOIN scalev_orders o ON o.customer_identifier = sc.customer_phone
    JOIN scalev_order_lines l ON l.scalev_order_id = o.id
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND sc.first_order_date <= CURRENT_DATE - 90
      AND sc.customer_phone NOT LIKE 'unidentified:%'
      AND get_channel_group(sc.first_channel) IS NOT NULL
      AND (brand_filter IS NULL OR l.product_type = brand_filter)
    GROUP BY cohort_m, cg, sc.customer_phone, sc.first_order_date
  )
  SELECT
    cl.cohort_m AS cohort_month,
    cl.cg AS channel_group,
    COUNT(*)::BIGINT AS num_customers,
    ROUND(AVG(cl.first_val), 0) AS avg_first_purchase,
    ROUND(AVG(cl.repeat_90d_val), 0) AS avg_repeat_value,
    ROUND(AVG(cl.first_val + cl.repeat_90d_val), 0) AS avg_ltv_90d,
    ROUND(AVG(cl.first_val + cl.repeat_90d_val + cl.after_90d_val), 0) AS avg_ltv_lifetime,
    ROUND(AVG(cl.after_90d_val), 0) AS avg_after_90d,
    ROUND(SUM(cl.is_repeater)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) AS repeat_rate
  FROM customer_ltv cl
  GROUP BY cl.cohort_m, cl.cg

  UNION ALL

  SELECT
    cl.cohort_m,
    'Global'::TEXT,
    COUNT(*)::BIGINT,
    ROUND(AVG(cl.first_val), 0),
    ROUND(AVG(cl.repeat_90d_val), 0),
    ROUND(AVG(cl.first_val + cl.repeat_90d_val), 0),
    ROUND(AVG(cl.first_val + cl.repeat_90d_val + cl.after_90d_val), 0),
    ROUND(AVG(cl.after_90d_val), 0),
    ROUND(SUM(cl.is_repeater)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1)
  FROM customer_ltv cl
  GROUP BY cl.cohort_m

  ORDER BY cohort_month, channel_group;
END;
$$;
