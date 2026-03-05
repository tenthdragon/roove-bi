-- ============================================================
-- Shipment Status RPC — for Channels page
-- ============================================================
-- Returns shipment status breakdown per sales channel:
--   completed, in_transit, returned — with order counts and revenue
-- ============================================================

CREATE OR REPLACE FUNCTION get_shipment_status(p_from DATE, p_to DATE)
RETURNS TABLE(
  sales_channel TEXT,
  completed_orders BIGINT,
  completed_revenue NUMERIC,
  in_transit_orders BIGINT,
  in_transit_revenue NUMERIC,
  returned_orders BIGINT,
  returned_revenue NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(l.sales_channel, 'Unknown') AS sales_channel,

    -- Completed: has completed_time
    COUNT(*) FILTER (
      WHERE o.completed_time IS NOT NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ) AS completed_orders,
    COALESCE(SUM(ABS(o.net_revenue)) FILTER (
      WHERE o.completed_time IS NOT NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ), 0) AS completed_revenue,

    -- In Transit: shipped but not completed, not canceled/returned
    COUNT(*) FILTER (
      WHERE o.completed_time IS NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ) AS in_transit_orders,
    COALESCE(SUM(ABS(o.net_revenue)) FILTER (
      WHERE o.completed_time IS NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ), 0) AS in_transit_revenue,

    -- Returned / Canceled after ship
    COUNT(*) FILTER (
      WHERE o.status IN ('canceled', 'cancelled', 'failed', 'returned')
    ) AS returned_orders,
    COALESCE(SUM(ABS(o.net_revenue)) FILTER (
      WHERE o.status IN ('canceled', 'cancelled', 'failed', 'returned')
    ), 0) AS returned_revenue

  FROM scalev_orders o
  -- Join to get sales_channel from the first order line
  -- scalev_order_lines.scalev_order_id references scalev_orders.id (integer PK)
  LEFT JOIN LATERAL (
    SELECT ol.sales_channel
    FROM scalev_order_lines ol
    WHERE ol.scalev_order_id = o.id
    ORDER BY ol.id
    LIMIT 1
  ) l ON TRUE
  WHERE o.shipped_time IS NOT NULL
    AND o.shipped_time >= p_from
    AND o.shipped_time < (p_to + INTERVAL '1 day')
  GROUP BY l.sales_channel
  ORDER BY (
    COUNT(*) FILTER (
      WHERE o.completed_time IS NOT NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ) +
    COUNT(*) FILTER (
      WHERE o.completed_time IS NULL
        AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
    ) +
    COUNT(*) FILTER (
      WHERE o.status IN ('canceled', 'cancelled', 'failed', 'returned')
    )
  ) DESC;
END;
$$;
