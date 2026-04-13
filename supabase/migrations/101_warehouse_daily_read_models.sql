-- Migration 101: Warehouse daily read-model RPCs
-- Moves high-traffic warehouse daily aggregations into SQL so the UI reads
-- pre-aggregated results instead of scanning and grouping rows in Next.js.

CREATE OR REPLACE FUNCTION public.warehouse_daily_movement_summary(p_date date)
RETURNS TABLE (
  product_id integer,
  product_name text,
  category text,
  entity text,
  total_in numeric,
  total_out numeric,
  total_adjust numeric,
  net_change numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_start,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_end
  )
  SELECT
    wsl.warehouse_product_id AS product_id,
    wp.name AS product_name,
    wp.category,
    wp.entity,
    COALESCE(SUM(CASE WHEN wsl.movement_type IN ('IN', 'TRANSFER_IN') THEN wsl.quantity ELSE 0 END), 0) AS total_in,
    COALESCE(SUM(CASE WHEN wsl.movement_type IN ('OUT', 'TRANSFER_OUT', 'DISPOSE') THEN wsl.quantity ELSE 0 END), 0) AS total_out,
    COALESCE(SUM(CASE WHEN wsl.movement_type = 'ADJUST' THEN wsl.quantity ELSE 0 END), 0) AS total_adjust,
    COALESCE(SUM(wsl.quantity), 0) AS net_change
  FROM public.warehouse_stock_ledger wsl
  JOIN public.warehouse_products wp
    ON wp.id = wsl.warehouse_product_id
  CROSS JOIN bounds b
  WHERE wsl.created_at >= b.day_start
    AND wsl.created_at < b.day_end
  GROUP BY wsl.warehouse_product_id, wp.name, wp.category, wp.entity
  ORDER BY wp.entity, wp.name;
$$;

COMMENT ON FUNCTION public.warehouse_daily_movement_summary(date) IS
  'Daily warehouse movement summary in WIB, aggregated in SQL for fast warehouse dashboard reads.';

CREATE OR REPLACE FUNCTION public.warehouse_daily_deduction_summary(p_date date)
RETURNS TABLE (
  scalev_product text,
  warehouse_product text,
  entity text,
  total_qty numeric,
  order_count bigint,
  business_codes text,
  total_unique_orders bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_start,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_end
  ),
  base_rows AS (
    SELECT
      wsl.reference_id,
      ABS(wsl.quantity) AS qty_abs,
      CASE
        WHEN wsl.notes LIKE 'Auto:%' OR wsl.notes LIKE 'Backfill:%' OR wsl.notes LIKE 'Auto-deduct:%'
          THEN regexp_replace(split_part(COALESCE(wsl.notes, ''), ': ', 2), ' x[0-9.]+$', '')
        ELSE COALESCE(wsl.notes, '-')
      END AS scalev_product,
      wp.name AS warehouse_product,
      wp.entity,
      order_match.business_code
    FROM public.warehouse_stock_ledger wsl
    JOIN public.warehouse_products wp
      ON wp.id = wsl.warehouse_product_id
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT so.business_code
      FROM public.scalev_orders so
      WHERE so.id = wsl.scalev_order_id
         OR (wsl.scalev_order_id IS NULL AND so.order_id = wsl.reference_id)
      ORDER BY CASE WHEN so.id = wsl.scalev_order_id THEN 0 ELSE 1 END
      LIMIT 1
    ) order_match ON TRUE
    WHERE wsl.reference_type = 'scalev_order'
      AND wsl.movement_type = 'OUT'
      AND wsl.created_at >= b.day_start
      AND wsl.created_at < b.day_end
  ),
  totals AS (
    SELECT COUNT(DISTINCT reference_id) AS total_unique_orders
    FROM base_rows
  )
  SELECT
    br.scalev_product,
    br.warehouse_product,
    br.entity,
    COALESCE(SUM(br.qty_abs), 0) AS total_qty,
    COUNT(DISTINCT br.reference_id) AS order_count,
    COALESCE(string_agg(DISTINCT br.business_code, ', ' ORDER BY br.business_code), '') AS business_codes,
    t.total_unique_orders
  FROM base_rows br
  CROSS JOIN totals t
  GROUP BY br.scalev_product, br.warehouse_product, br.entity, t.total_unique_orders
  ORDER BY total_qty DESC, br.scalev_product, br.warehouse_product;
$$;

COMMENT ON FUNCTION public.warehouse_daily_deduction_summary(date) IS
  'Daily warehouse deduction summary in WIB, grouped in SQL for the warehouse dashboard.';
