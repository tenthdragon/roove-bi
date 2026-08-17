-- Keep the dashboard shipment-count read below PostgREST's statement timeout.
-- The existing customer-leading index cannot efficiently serve a query that
-- filters by workspace and shipped_time without filtering customer_identifier.

CREATE INDEX IF NOT EXISTS idx_scalev_orders_workspace_shipped_completed
  ON public.scalev_orders (workspace_id, shipped_time)
  INCLUDE (id)
  WHERE status IN ('shipped', 'completed')
    AND shipped_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scalev_order_lines_workspace_primary_line
  ON public.scalev_order_lines (
    workspace_id,
    scalev_order_id,
    product_price_bt DESC
  )
  INCLUDE (product_type, sales_channel)
  WHERE product_type IS NOT NULL
    AND product_type <> 'Unknown';

CREATE OR REPLACE FUNCTION public.get_workspace_daily_shipment_counts(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  order_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.workspace_can_access(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;

  v_start := (p_from::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;
  v_end := ((p_to + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;

  RETURN QUERY
  WITH eligible_orders AS (
    SELECT
      shipment_order.id,
      DATE(shipment_order.shipped_time AT TIME ZONE 'Asia/Jakarta') AS ship_date
    FROM public.scalev_orders shipment_order
    WHERE shipment_order.workspace_id = p_workspace_id
      AND shipment_order.status IN ('shipped', 'completed')
      AND shipment_order.shipped_time IS NOT NULL
      AND shipment_order.shipped_time >= v_start
      AND shipment_order.shipped_time < v_end
  )
  SELECT
    eligible.ship_date,
    primary_line.product_type,
    primary_line.sales_channel,
    COUNT(*)
  FROM eligible_orders eligible
  JOIN LATERAL (
    SELECT
      line.product_type,
      line.sales_channel
    FROM public.scalev_order_lines line
    WHERE line.workspace_id = p_workspace_id
      AND line.scalev_order_id = eligible.id
      AND line.product_type IS NOT NULL
      AND line.product_type <> 'Unknown'
    ORDER BY line.product_price_bt DESC
    LIMIT 1
  ) primary_line ON TRUE
  GROUP BY eligible.ship_date, primary_line.product_type, primary_line.sales_channel
  ORDER BY eligible.ship_date;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_daily_shipment_counts(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_daily_shipment_counts(UUID, DATE, DATE)
  TO authenticated, service_role;
