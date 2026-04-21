-- Migration 115: Rebuild active warehouse batches as opening batches grouped by expiry date
--
-- Purpose:
-- Repair Batch & Expiry so it matches the latest product stock balance while still
-- preserving separation by expired_date.
--
-- Rules:
-- - One SKU with multiple expired_date values => one rebuilt batch per expired_date.
-- - Same expired_date values are merged.
-- - No expired_date => one no-expiry rebuilt batch.
-- - If the current batch totals do not match product stock, rebuilt group quantities
--   are rebalanced proportionally so the final batch total exactly equals current stock.
-- - Whole-number stock totals are redistributed as whole numbers to avoid fractional
--   batch quantities for unit-based products such as sachet and FG.
--
-- Notes:
-- - This is intended as a one-time repair / reset.
-- - Historical ledger rows are left untouched.
-- - Existing active batches are deactivated and replaced with new opening batches.
-- - Negative-stock products are skipped on purpose and returned in the summary.

WITH params AS (
  SELECT
    'OPENING-SO-20260421'::TEXT AS batch_prefix,
    NOW()::TIMESTAMPTZ AS rebuilt_at
),
product_balances AS (
  SELECT
    wp.id AS product_id,
    wp.name AS product_name,
    COALESCE(SUM(sl.quantity), 0)::NUMERIC AS total_stock,
    EXISTS (
      SELECT 1
      FROM public.warehouse_batches b
      WHERE b.warehouse_product_id = wp.id
        AND b.is_active = true
        AND COALESCE(b.current_qty, 0) <> 0
    ) AS has_active_batch_qty
  FROM public.warehouse_products wp
  LEFT JOIN public.warehouse_stock_ledger sl
    ON sl.warehouse_product_id = wp.id
  WHERE wp.is_active = true
  GROUP BY wp.id, wp.name
),
negative_skips AS (
  SELECT *
  FROM product_balances
  WHERE total_stock < 0
    AND (total_stock <> 0 OR has_active_batch_qty)
),
candidates AS (
  SELECT *
  FROM product_balances
  WHERE total_stock >= 0
    AND (total_stock > 0 OR has_active_batch_qty)
),
existing_groups AS (
  SELECT
    b.warehouse_product_id AS product_id,
    b.expired_date,
    SUM(COALESCE(b.current_qty, 0))::NUMERIC AS source_qty,
    CASE
      WHEN SUM(
        CASE
          WHEN COALESCE(b.cost_per_unit, 0) > 0 THEN COALESCE(b.current_qty, 0)
          ELSE 0
        END
      ) > 0
      THEN SUM(
        CASE
          WHEN COALESCE(b.cost_per_unit, 0) > 0 THEN COALESCE(b.current_qty, 0) * b.cost_per_unit
          ELSE 0
        END
      ) / SUM(
        CASE
          WHEN COALESCE(b.cost_per_unit, 0) > 0 THEN COALESCE(b.current_qty, 0)
          ELSE 0
        END
      )
      ELSE 0
    END::NUMERIC AS source_cost
  FROM public.warehouse_batches b
  INNER JOIN candidates c
    ON c.product_id = b.warehouse_product_id
  WHERE b.is_active = true
    AND COALESCE(b.current_qty, 0) > 0
  GROUP BY b.warehouse_product_id, b.expired_date
),
groups_raw AS (
  SELECT
    c.product_id,
    c.product_name,
    c.total_stock,
    g.expired_date,
    g.source_qty,
    g.source_cost
  FROM candidates c
  INNER JOIN existing_groups g
    ON g.product_id = c.product_id
  WHERE c.total_stock > 0

  UNION ALL

  SELECT
    c.product_id,
    c.product_name,
    c.total_stock,
    NULL::DATE AS expired_date,
    c.total_stock AS source_qty,
    0::NUMERIC AS source_cost
  FROM candidates c
  WHERE c.total_stock > 0
    AND NOT EXISTS (
      SELECT 1
      FROM existing_groups g
      WHERE g.product_id = c.product_id
    )
),
ordered_groups AS (
  SELECT
    gr.*,
    ROW_NUMBER() OVER (
      PARTITION BY gr.product_id
      ORDER BY gr.expired_date NULLS LAST
    ) AS group_ordinal,
    COUNT(*) OVER (
      PARTITION BY gr.product_id
    ) AS group_count,
    SUM(gr.source_qty) OVER (
      PARTITION BY gr.product_id
    ) AS source_total
  FROM groups_raw gr
),
provisional_groups AS (
  SELECT
    og.*,
    CASE
      WHEN og.group_count = 1 THEN og.total_stock
      ELSE og.total_stock * og.source_qty / NULLIF(og.source_total, 0)
    END AS exact_qty
  FROM ordered_groups og
),
scaled_groups AS (
  SELECT
    pg.product_id,
    pg.product_name,
    pg.total_stock,
    pg.expired_date,
    pg.source_cost,
    pg.group_ordinal,
    pg.group_count,
    CASE
      WHEN pg.total_stock = TRUNC(pg.total_stock)
        THEN FLOOR(pg.exact_qty) + CASE
          WHEN ROW_NUMBER() OVER (
            PARTITION BY pg.product_id
            ORDER BY (pg.exact_qty - FLOOR(pg.exact_qty)) DESC, pg.expired_date NULLS LAST, pg.group_ordinal
          ) <= CAST(
            GREATEST(
              pg.total_stock - SUM(FLOOR(pg.exact_qty)) OVER (PARTITION BY pg.product_id),
              0
            ) AS INT
          )
          THEN 1
          ELSE 0
        END
      ELSE ROUND(pg.exact_qty, 6)
    END AS target_qty
  FROM provisional_groups pg
),
deactivated AS (
  UPDATE public.warehouse_batches b
  SET
    current_qty = 0,
    is_active = false
  FROM candidates c
  WHERE b.warehouse_product_id = c.product_id
    AND b.is_active = true
  RETURNING b.id, b.warehouse_product_id
),
inserted AS (
  INSERT INTO public.warehouse_batches (
    warehouse_product_id,
    batch_code,
    expired_date,
    initial_qty,
    current_qty,
    is_active,
    created_at,
    cost_per_unit
  )
  SELECT
    sg.product_id,
    CASE
      WHEN sg.expired_date IS NULL
        THEN FORMAT('%s-%s-NOEXP', p.batch_prefix, LPAD(sg.product_id::TEXT, 6, '0'))
      ELSE FORMAT(
        '%s-%s-ED%s',
        p.batch_prefix,
        LPAD(sg.product_id::TEXT, 6, '0'),
        TO_CHAR(sg.expired_date, 'YYYYMMDD')
      )
    END AS batch_code,
    sg.expired_date,
    sg.target_qty,
    sg.target_qty,
    true,
    p.rebuilt_at,
    CASE
      WHEN COALESCE(sg.source_cost, 0) > 0 THEN sg.source_cost
      ELSE 0
    END
  FROM scaled_groups sg
  CROSS JOIN params p
  WHERE COALESCE(sg.target_qty, 0) > 0
  ON CONFLICT (warehouse_product_id, batch_code)
  DO UPDATE SET
    expired_date = EXCLUDED.expired_date,
    initial_qty = EXCLUDED.initial_qty,
    current_qty = EXCLUDED.current_qty,
    is_active = EXCLUDED.is_active,
    created_at = EXCLUDED.created_at,
    cost_per_unit = EXCLUDED.cost_per_unit
  RETURNING warehouse_product_id
),
created_summary AS (
  SELECT
    sg.product_id,
    COUNT(*)::INT AS batch_groups_created
  FROM scaled_groups sg
  WHERE COALESCE(sg.target_qty, 0) > 0
  GROUP BY sg.product_id
)
SELECT
  c.product_id,
  c.product_name,
  c.total_stock,
  COALESCE(cs.batch_groups_created, 0) AS batch_groups_created,
  CASE
    WHEN c.total_stock = 0 THEN 'cleared_active_batches'
    WHEN COALESCE(cs.batch_groups_created, 0) > 0 THEN 'rebuilt'
    ELSE 'no_active_batches_created'
  END AS note
FROM candidates c
LEFT JOIN created_summary cs
  ON cs.product_id = c.product_id

UNION ALL

SELECT
  n.product_id,
  n.product_name,
  n.total_stock,
  0 AS batch_groups_created,
  'skipped_negative_stock' AS note
FROM negative_skips n

ORDER BY product_name;
