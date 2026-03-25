-- ============================================================================
-- Migration 053: Per-channel LTV 90-day for Roove brand
-- ============================================================================
-- RPC function that computes average LTV within 90 days of first order,
-- broken down by acquisition channel group, for Roove products only.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_channel_ltv_90d()
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
      -- First purchase Roove revenue (day 0)
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) = sc.first_order_date AND l.product_type = 'Roove'
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS first_val,
      -- Repeat Roove revenue (day 1-90)
      COALESCE(SUM(CASE
        WHEN DATE(o.shipped_time) > sc.first_order_date
          AND DATE(o.shipped_time) <= sc.first_order_date + 90
          AND l.product_type = 'Roove'
        THEN l.product_price_bt - l.discount_bt ELSE 0
      END), 0) AS repeat_val,
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
      AND DATE(o.shipped_time) <= sc.first_order_date + 90
      AND sc.first_order_date <= CURRENT_DATE - 90
      AND sc.customer_phone NOT LIKE 'unidentified:%'
      AND get_channel_group(sc.first_channel) IS NOT NULL
    GROUP BY cg, sc.customer_phone, sc.first_order_date
    -- Only include customers who bought Roove at least once
    HAVING SUM(CASE WHEN l.product_type = 'Roove' THEN 1 ELSE 0 END) > 0
  )
  SELECT r.channel_group, r.num_customers, r.avg_first_purchase, r.avg_repeat_value, r.avg_ltv_90d, r.repeat_rate
  FROM (
    -- Per-channel aggregation
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

    -- Global row
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
