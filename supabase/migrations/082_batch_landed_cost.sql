-- Migration 082: Landed cost HPP per batch
--
-- Adds cost_per_unit to warehouse_batches (set during PO receive).
-- Adds shipping_cost + other_cost to PO level (distributed proportionally).
-- Updates views to use batch-level cost for Nilai calculations.

-- 1. Add cost_per_unit to batches
ALTER TABLE warehouse_batches ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC DEFAULT 0;

-- 2. Add landed cost fields to PO level
ALTER TABLE warehouse_purchase_orders ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0;
ALTER TABLE warehouse_purchase_orders ADD COLUMN IF NOT EXISTS other_cost NUMERIC DEFAULT 0;

-- 3. Update batch view: use cost_per_unit (fallback to product hpp)
DROP VIEW IF EXISTS v_warehouse_batch_stock;
CREATE OR REPLACE VIEW v_warehouse_batch_stock AS
SELECT
  wb.id AS batch_id,
  wb.batch_code,
  wb.expired_date,
  wb.current_qty,
  wb.cost_per_unit,
  wp.id AS product_id,
  wp.name AS product_name,
  wp.category,
  wp.entity,
  wp.warehouse,
  CASE WHEN wb.cost_per_unit > 0 THEN wb.cost_per_unit ELSE wp.hpp END AS effective_hpp,
  wp.price_list,
  CASE
    WHEN wb.expired_date IS NULL THEN 'no_expiry'
    WHEN wb.expired_date < CURRENT_DATE THEN 'expired'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
    ELSE 'safe'
  END AS expiry_status,
  CASE
    WHEN wb.expired_date IS NOT NULL
    THEN (wb.expired_date - CURRENT_DATE)
    ELSE NULL
  END AS days_remaining
FROM warehouse_batches wb
JOIN warehouse_products wp ON wp.id = wb.warehouse_product_id
WHERE wb.is_active = true AND wb.current_qty > 0
ORDER BY wb.expired_date ASC NULLS LAST;

-- 4. Update stock balance view: weighted avg HPP from batches
DROP VIEW IF EXISTS v_warehouse_stock_balance;
CREATE OR REPLACE VIEW v_warehouse_stock_balance AS
SELECT
  wp.id AS product_id,
  wp.name AS product_name,
  wp.sku,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.unit,
  wp.price_list,
  wp.hpp,
  wp.reorder_threshold,
  COALESCE(SUM(sl.quantity), 0) AS current_stock,
  -- Weighted avg HPP: from active batches with cost, fallback to product hpp
  COALESCE(
    (SELECT SUM(b.current_qty * CASE WHEN b.cost_per_unit > 0 THEN b.cost_per_unit ELSE wp.hpp END)
       / NULLIF(SUM(b.current_qty), 0)
     FROM warehouse_batches b
     WHERE b.warehouse_product_id = wp.id AND b.is_active = true AND b.current_qty > 0),
    wp.hpp
  ) AS weighted_hpp,
  COALESCE(SUM(sl.quantity), 0) * wp.price_list AS stock_value,
  CASE
    WHEN wp.reorder_threshold > 0
      AND COALESCE(SUM(sl.quantity), 0) <= wp.reorder_threshold
    THEN true ELSE false
  END AS needs_reorder
FROM warehouse_products wp
LEFT JOIN warehouse_stock_ledger sl ON sl.warehouse_product_id = wp.id
WHERE wp.is_active = true
GROUP BY wp.id, wp.name, wp.sku, wp.category, wp.entity, wp.warehouse,
         wp.unit, wp.price_list, wp.hpp, wp.reorder_threshold;
