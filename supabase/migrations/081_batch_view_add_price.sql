-- Migration 081: Add price_list to v_warehouse_batch_stock view for Nilai column
CREATE OR REPLACE VIEW v_warehouse_batch_stock AS
SELECT
  wb.id AS batch_id,
  wb.batch_code,
  wb.expired_date,
  wb.current_qty,
  wp.id AS product_id,
  wp.name AS product_name,
  wp.category,
  wp.entity,
  wp.warehouse,
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
