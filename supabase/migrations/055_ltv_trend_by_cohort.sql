-- ============================================================================
-- Migration 055: LTV trend per cohort month per channel (90d + lifetime)
-- ============================================================================
-- Returns avg LTV 90d AND avg LTV lifetime per cohort month per channel.
-- Only includes mature cohorts (first_order_date <= CURRENT_DATE - 90).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ltv_trend_by_cohort()
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
      -- First purchase Roove revenue (day 0)
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) = sc.first_order_date AND l.product_type = 'Roove'
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS first_val,
      -- Repeat Roove revenue within 90 days (day 1-90)
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
          AND l.product_type = 'Roove'
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS repeat_90d_val,
      -- Roove revenue after 90 days (day 91+)
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date + 90
          AND l.product_type = 'Roove'
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS after_90d_val,
      -- Did they buy Roove again within 90 days?
      CASE WHEN COUNT(DISTINCT CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
          AND l.product_type = 'Roove'
        THEN o.id END) > 0 THEN 1 ELSE 0 END AS is_repeater
    FROM summary_customer_cohort sc
    JOIN scalev_orders o ON o.customer_identifier = sc.customer_phone
    JOIN scalev_order_lines l ON l.scalev_order_id = o.id
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND sc.first_order_date <= CURRENT_DATE - 90
      AND sc.customer_phone NOT LIKE 'unidentified:%'
      AND get_channel_group(sc.first_channel) IS NOT NULL
    GROUP BY cohort_m, cg, sc.customer_phone, sc.first_order_date
    HAVING SUM(CASE WHEN l.product_type = 'Roove' THEN 1 ELSE 0 END) > 0
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

  -- Global per cohort month
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
