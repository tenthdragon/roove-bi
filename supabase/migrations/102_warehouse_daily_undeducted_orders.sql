-- Migration 102: Warehouse undeducted-order anomaly queue
-- Moves "Order Belum Deduct" into a SQL-side read model with pagination.

CREATE OR REPLACE FUNCTION public.warehouse_daily_undeducted_orders(
  p_date date,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  order_id text,
  business_code text,
  product_lines jsonb,
  problem text,
  problem_detail text,
  total_count bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_start,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_end
  ),
  orders AS (
    SELECT
      o.id,
      o.order_id,
      o.business_code,
      o.shipped_time
    FROM public.scalev_orders o
    CROSS JOIN bounds b
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time >= b.day_start
      AND o.shipped_time < b.day_end
  ),
  mapping AS (
    SELECT
      business_code,
      deduct_entity,
      COALESCE(deduct_warehouse, 'BTN') AS deduct_warehouse
    FROM public.warehouse_business_mapping
    WHERE is_active = true
  ),
  line_base AS (
    SELECT
      o.id AS scalev_order_id,
      o.order_id,
      o.business_code,
      l.product_name,
      SUM(l.quantity)::numeric AS quantity
    FROM orders o
    JOIN public.scalev_order_lines l
      ON l.scalev_order_id = o.id
    WHERE l.product_name IS NOT NULL
      AND l.product_name <> ''
      AND COALESCE(l.quantity, 0) > 0
    GROUP BY o.id, o.order_id, o.business_code, l.product_name
  ),
  product_lines AS (
    SELECT
      o.order_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'product_name', lb.product_name,
            'quantity', lb.quantity
          )
          ORDER BY lb.product_name
        ) FILTER (WHERE lb.product_name IS NOT NULL),
        '[]'::jsonb
      ) AS product_lines,
      COUNT(lb.product_name) AS line_count
    FROM orders o
    LEFT JOIN line_base lb
      ON lb.scalev_order_id = o.id
    GROUP BY o.order_id
  ),
  line_enriched AS (
    SELECT
      lb.scalev_order_id,
      lb.order_id,
      lb.business_code,
      lb.product_name,
      lb.quantity,
      m.deduct_entity,
      m.deduct_warehouse,
      wsm.warehouse_product_id AS mapped_product_id,
      COALESCE(wsm.deduct_qty_multiplier, 1)::numeric AS deduct_multiplier,
      COALESCE(wsm.is_ignored, false) AS is_ignored
    FROM line_base lb
    LEFT JOIN mapping m
      ON m.business_code = lb.business_code
    LEFT JOIN public.warehouse_scalev_mapping wsm
      ON wsm.scalev_product_name = lb.product_name
  ),
  fallback_requests AS (
    SELECT DISTINCT
      product_name,
      deduct_entity,
      deduct_warehouse
    FROM line_enriched
    WHERE deduct_entity IS NOT NULL
      AND is_ignored = false
      AND mapped_product_id IS NULL
  ),
  fallback_lookup AS (
    SELECT
      fr.product_name,
      fr.deduct_entity,
      fr.deduct_warehouse,
      MIN(wp.id)::integer AS warehouse_product_id
    FROM fallback_requests fr
    JOIN public.warehouse_products wp
      ON wp.is_active = true
     AND wp.entity = fr.deduct_entity
     AND wp.warehouse = fr.deduct_warehouse
     AND wp.scalev_product_names @> ARRAY[fr.product_name]::text[]
    GROUP BY fr.product_name, fr.deduct_entity, fr.deduct_warehouse
  ),
  desired AS (
    SELECT
      le.order_id,
      COALESCE(le.mapped_product_id, fl.warehouse_product_id) AS warehouse_product_id,
      SUM(le.quantity * le.deduct_multiplier)::numeric AS desired_qty
    FROM line_enriched le
    LEFT JOIN fallback_lookup fl
      ON fl.product_name = le.product_name
     AND fl.deduct_entity = le.deduct_entity
     AND fl.deduct_warehouse = le.deduct_warehouse
    WHERE le.deduct_entity IS NOT NULL
      AND le.is_ignored = false
      AND COALESCE(le.mapped_product_id, fl.warehouse_product_id) IS NOT NULL
    GROUP BY le.order_id, COALESCE(le.mapped_product_id, fl.warehouse_product_id)
  ),
  unmapped AS (
    SELECT
      le.order_id,
      string_agg(DISTINCT le.product_name, ', ' ORDER BY le.product_name) AS unmapped_products
    FROM line_enriched le
    LEFT JOIN fallback_lookup fl
      ON fl.product_name = le.product_name
     AND fl.deduct_entity = le.deduct_entity
     AND fl.deduct_warehouse = le.deduct_warehouse
    WHERE le.deduct_entity IS NOT NULL
      AND le.is_ignored = false
      AND COALESCE(le.mapped_product_id, fl.warehouse_product_id) IS NULL
    GROUP BY le.order_id
  ),
  ledger_net_source AS (
    SELECT
      o.order_id,
      wsl.warehouse_product_id,
      SUM(wsl.quantity)::numeric AS net_qty
    FROM public.warehouse_stock_ledger wsl
    JOIN orders o
      ON wsl.scalev_order_id = o.id
    WHERE wsl.reference_type = 'scalev_order'
    GROUP BY o.order_id, wsl.warehouse_product_id

    UNION ALL

    SELECT
      o.order_id,
      wsl.warehouse_product_id,
      SUM(wsl.quantity)::numeric AS net_qty
    FROM public.warehouse_stock_ledger wsl
    JOIN orders o
      ON wsl.scalev_order_id IS NULL
     AND wsl.reference_id = o.order_id
    WHERE wsl.reference_type = 'scalev_order'
    GROUP BY o.order_id, wsl.warehouse_product_id
  ),
  ledger_net AS (
    SELECT
      order_id,
      warehouse_product_id,
      SUM(net_qty)::numeric AS net_qty
    FROM ledger_net_source
    GROUP BY order_id, warehouse_product_id
  ),
  outstanding AS (
    SELECT
      order_id,
      warehouse_product_id,
      ABS(net_qty)::numeric AS outstanding_qty
    FROM ledger_net
    WHERE net_qty < -0.000001
  ),
  mismatch AS (
    SELECT DISTINCT
      COALESCE(d.order_id, o.order_id) AS order_id
    FROM desired d
    FULL OUTER JOIN outstanding o
      ON o.order_id = d.order_id
     AND o.warehouse_product_id = d.warehouse_product_id
    WHERE ABS(COALESCE(d.desired_qty, 0) - COALESCE(o.outstanding_qty, 0)) > 0.000001
  ),
  issues AS (
    SELECT
      o.order_id,
      o.business_code,
      COALESCE(pl.product_lines, '[]'::jsonb) AS product_lines,
      CASE
        WHEN m.business_code IS NULL THEN 'no_business_mapping'
        WHEN COALESCE(pl.line_count, 0) = 0 THEN 'no_order_lines'
        WHEN u.unmapped_products IS NOT NULL THEN 'no_product_mapping'
        WHEN mm.order_id IS NOT NULL THEN 'unknown'
        ELSE NULL
      END AS problem,
      CASE
        WHEN m.business_code IS NULL THEN format('Business %s tidak punya warehouse mapping', COALESCE(o.business_code, '-'))
        WHEN COALESCE(pl.line_count, 0) = 0 THEN format('Order %s tidak punya order lines', o.order_id)
        WHEN u.unmapped_products IS NOT NULL THEN format('Produk tidak ditemukan di gudang %s: %s', m.deduct_entity, u.unmapped_products)
        WHEN mm.order_id IS NOT NULL THEN 'Deduction warehouse belum sinkron dengan shipment Scalev'
        ELSE NULL
      END AS problem_detail,
      CASE
        WHEN m.business_code IS NULL THEN 1
        WHEN u.unmapped_products IS NOT NULL THEN 2
        WHEN COALESCE(pl.line_count, 0) = 0 THEN 3
        WHEN mm.order_id IS NOT NULL THEN 4
        ELSE 99
      END AS problem_rank,
      o.shipped_time
    FROM orders o
    LEFT JOIN mapping m
      ON m.business_code = o.business_code
    LEFT JOIN product_lines pl
      ON pl.order_id = o.order_id
    LEFT JOIN unmapped u
      ON u.order_id = o.order_id
    LEFT JOIN mismatch mm
      ON mm.order_id = o.order_id
  ),
  paged AS (
    SELECT
      order_id,
      business_code,
      product_lines,
      problem,
      problem_detail,
      COUNT(*) OVER() AS total_count,
      problem_rank,
      shipped_time
    FROM issues
    WHERE problem IS NOT NULL
    ORDER BY problem_rank, shipped_time DESC, order_id DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    p.order_id,
    p.business_code,
    p.product_lines,
    p.problem,
    p.problem_detail,
    p.total_count
  FROM paged p
  ORDER BY p.problem_rank, p.shipped_time DESC, p.order_id DESC;
$$;

COMMENT ON FUNCTION public.warehouse_daily_undeducted_orders(date, integer, integer) IS
  'Paginated anomaly queue for shipped orders whose warehouse deduction is missing, unmapped, or inconsistent.';
