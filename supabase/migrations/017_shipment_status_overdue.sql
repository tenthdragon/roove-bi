-- ============================================================
-- Shipment Status RPC v2 — adds Overdue category
-- Revenue from SUM(product_price_bt - discount_bt) line items
-- Statuses: completed, in_transit (shipped), returned/rts/canceled
-- ============================================================

DROP FUNCTION IF EXISTS get_shipment_status(DATE, DATE);

CREATE OR REPLACE FUNCTION get_shipment_status(p_from DATE, p_to DATE)
RETURNS TABLE(
  sales_channel TEXT,
  completed_orders BIGINT,
  completed_revenue NUMERIC,
  in_transit_orders BIGINT,
  in_transit_revenue NUMERIC,
  returned_orders BIGINT,
  returned_revenue NUMERIC,
  overdue_orders BIGINT,
  overdue_revenue NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Current period: shipped within p_from..p_to
  current_period AS (
    SELECT
      COALESCE(l.sales_channel, 'Unknown') AS ch,
      o.completed_time,
      o.status,
      COALESCE(l.line_rev, 0) AS rev
    FROM scalev_orders o
    LEFT JOIN LATERAL (
      SELECT
        ol.sales_channel,
        SUM(ol.product_price_bt - ol.discount_bt) AS line_rev
      FROM scalev_order_lines ol
      WHERE ol.scalev_order_id = o.id
      GROUP BY ol.sales_channel
    ) l ON TRUE
    WHERE o.shipped_time IS NOT NULL
      AND o.shipped_time >= p_from
      AND o.shipped_time < (p_to + INTERVAL '1 day')
      AND o.status NOT IN ('deleted')
  ),
  -- Overdue: shipped BEFORE p_from, still not completed, not canceled/rts
  overdue AS (
    SELECT
      COALESCE(l.sales_channel, 'Unknown') AS ch,
      COALESCE(l.line_rev, 0) AS rev
    FROM scalev_orders o
    LEFT JOIN LATERAL (
      SELECT
        ol.sales_channel,
        SUM(ol.product_price_bt - ol.discount_bt) AS line_rev
      FROM scalev_order_lines ol
      WHERE ol.scalev_order_id = o.id
      GROUP BY ol.sales_channel
    ) l ON TRUE
    WHERE o.shipped_time IS NOT NULL
      AND o.shipped_time < p_from
      AND o.completed_time IS NULL
      AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts', 'deleted')
  ),
  -- Aggregate current period by channel
  current_agg AS (
    SELECT
      ch AS sales_channel,
      COUNT(*) FILTER (
        WHERE completed_time IS NOT NULL
          AND status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ) AS completed_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE completed_time IS NOT NULL
          AND status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ), 0) AS completed_revenue,
      COUNT(*) FILTER (
        WHERE completed_time IS NULL
          AND status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ) AS in_transit_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE completed_time IS NULL
          AND status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ), 0) AS in_transit_revenue,
      COUNT(*) FILTER (
        WHERE status IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ) AS returned_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE status IN ('canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts')
      ), 0) AS returned_revenue
    FROM current_period
    GROUP BY ch
  ),
  -- Aggregate overdue by channel
  overdue_agg AS (
    SELECT
      ch AS sales_channel,
      COUNT(*) AS overdue_orders,
      COALESCE(SUM(rev), 0) AS overdue_revenue
    FROM overdue
    GROUP BY ch
  )
  SELECT
    COALESCE(c.sales_channel, ov.sales_channel) AS sales_channel,
    COALESCE(c.completed_orders, 0)::BIGINT AS completed_orders,
    COALESCE(c.completed_revenue, 0)::NUMERIC AS completed_revenue,
    COALESCE(c.in_transit_orders, 0)::BIGINT AS in_transit_orders,
    COALESCE(c.in_transit_revenue, 0)::NUMERIC AS in_transit_revenue,
    COALESCE(c.returned_orders, 0)::BIGINT AS returned_orders,
    COALESCE(c.returned_revenue, 0)::NUMERIC AS returned_revenue,
    COALESCE(ov.overdue_orders, 0)::BIGINT AS overdue_orders,
    COALESCE(ov.overdue_revenue, 0)::NUMERIC AS overdue_revenue
  FROM current_agg c
  FULL OUTER JOIN overdue_agg ov ON c.sales_channel = ov.sales_channel
  ORDER BY (
    COALESCE(c.completed_orders, 0) +
    COALESCE(c.in_transit_orders, 0) +
    COALESCE(c.returned_orders, 0) +
    COALESCE(ov.overdue_orders, 0)
  ) DESC;
END;
$$;
