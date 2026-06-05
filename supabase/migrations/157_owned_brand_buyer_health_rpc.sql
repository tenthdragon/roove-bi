-- ============================================================================
-- 157: Owned-channel brand buyer health RPC
-- ============================================================================
-- Returns weekly trailing 90D active buyers and new-to-brand buyers for
-- phone-backed non-marketplace (Scalev/owned channel) identities only.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_owned_brand_buyer_health(p_weeks INT DEFAULT 26)
RETURNS TABLE (
  brand TEXT,
  week_start DATE,
  week_end DATE,
  trailing_active_buyers BIGINT,
  new_buyers BIGINT,
  latest_data_date DATE,
  latest_completed_week_end DATE,
  owned_purchase_rows BIGINT,
  unique_buyers BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  v_weeks INT := LEAST(GREATEST(COALESCE(p_weeks, 26), 13), 52);
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DATE(MAX(o.shipped_time AT TIME ZONE 'Asia/Jakarta')) AS latest_date
    FROM scalev_orders o
    WHERE o.platform = 'scalev'
      AND o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
  ), anchors AS (
    SELECT
      latest.latest_date,
      (latest.latest_date - EXTRACT(DOW FROM latest.latest_date)::INT) AS latest_week_end
    FROM latest
    WHERE latest.latest_date IS NOT NULL
  ), weeks AS (
    SELECT
      (a.latest_week_end - (gs.i * 7) - 6)::DATE AS week_start,
      (a.latest_week_end - (gs.i * 7))::DATE AS week_end,
      a.latest_date,
      a.latest_week_end
    FROM anchors a
    CROSS JOIN generate_series(v_weeks - 1, 0, -1) AS gs(i)
  ), owned_purchases AS (
    SELECT DISTINCT
      DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') AS purchase_date,
      o.customer_identifier,
      l.product_type AS brand
    FROM scalev_orders o
    JOIN scalev_order_lines l ON l.scalev_order_id = o.id
    WHERE o.platform = 'scalev'
      AND o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND o.customer_identifier IS NOT NULL
      AND o.customer_phone IS NOT NULL
      AND o.customer_identifier = o.customer_phone
      AND o.customer_identifier ~ '^[0-9]{10,15}$'
      AND l.product_type IS NOT NULL
      AND l.product_type NOT IN ('Unknown', 'Other')
  ), coverage AS (
    SELECT
      COUNT(*)::BIGINT AS owned_purchase_rows,
      COUNT(DISTINCT customer_identifier)::BIGINT AS unique_buyers
    FROM owned_purchases
  ), brands AS (
    SELECT DISTINCT owned_purchases.brand
    FROM owned_purchases
  ), brand_first AS (
    SELECT
      owned_purchases.brand,
      owned_purchases.customer_identifier,
      MIN(owned_purchases.purchase_date) AS first_purchase_date
    FROM owned_purchases
    GROUP BY owned_purchases.brand, owned_purchases.customer_identifier
  ), active_counts AS (
    SELECT
      w.week_start,
      w.week_end,
      p.brand,
      COUNT(DISTINCT p.customer_identifier)::BIGINT AS trailing_active_buyers
    FROM weeks w
    JOIN owned_purchases p
      ON p.purchase_date >= w.week_end - 89
     AND p.purchase_date <= w.week_end
    GROUP BY w.week_start, w.week_end, p.brand
  ), new_counts AS (
    SELECT
      w.week_start,
      w.week_end,
      bf.brand,
      COUNT(DISTINCT bf.customer_identifier)::BIGINT AS new_buyers
    FROM weeks w
    JOIN brand_first bf
      ON bf.first_purchase_date >= w.week_start
     AND bf.first_purchase_date <= w.week_end
    GROUP BY w.week_start, w.week_end, bf.brand
  )
  SELECT
    b.brand,
    w.week_start,
    w.week_end,
    COALESCE(ac.trailing_active_buyers, 0)::BIGINT AS trailing_active_buyers,
    COALESCE(nc.new_buyers, 0)::BIGINT AS new_buyers,
    w.latest_date AS latest_data_date,
    w.latest_week_end AS latest_completed_week_end,
    c.owned_purchase_rows,
    c.unique_buyers
  FROM weeks w
  CROSS JOIN brands b
  CROSS JOIN coverage c
  LEFT JOIN active_counts ac
    ON ac.week_start = w.week_start
   AND ac.week_end = w.week_end
   AND ac.brand = b.brand
  LEFT JOIN new_counts nc
    ON nc.week_start = w.week_start
   AND nc.week_end = w.week_end
   AND nc.brand = b.brand
  ORDER BY b.brand, w.week_end;
END;
$$;
