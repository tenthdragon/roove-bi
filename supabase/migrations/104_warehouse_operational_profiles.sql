-- ============================================================
-- 104: Warehouse operational and attribution profile views
-- Helper views for operational readiness and future attribution.
-- ============================================================

CREATE OR REPLACE VIEW v_warehouse_product_operational_profiles AS
SELECT
  wp.id AS product_id,
  wp.name AS product_name,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.brand_id,
  b.name AS brand_name,
  COUNT(wsm.id) FILTER (
    WHERE COALESCE(wsm.is_ignored, false) = false
  )::INT AS active_scalev_mapping_count,
  ARRAY_REMOVE(
    ARRAY_AGG(wsm.scalev_product_name ORDER BY wsm.scalev_product_name) FILTER (
      WHERE COALESCE(wsm.is_ignored, false) = false
    ),
    NULL
  ) AS active_scalev_product_names
FROM warehouse_products wp
LEFT JOIN brands b
  ON b.id = wp.brand_id
LEFT JOIN warehouse_scalev_mapping wsm
  ON wsm.warehouse_product_id = wp.id
GROUP BY
  wp.id,
  wp.name,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.brand_id,
  b.name;

COMMENT ON VIEW v_warehouse_product_operational_profiles IS
  'Operational readiness profile per warehouse product: category, brand, and active Scalev mappings.';

CREATE OR REPLACE VIEW v_warehouse_scalev_attribution_profiles AS
SELECT
  wsm.id AS mapping_id,
  wsm.scalev_product_name,
  wsm.warehouse_product_id,
  wsm.deduct_qty_multiplier,
  wsm.is_ignored,
  wsm.notes,
  wp.name AS warehouse_product_name,
  wp.category AS stock_category,
  wp.entity,
  wp.warehouse,
  wp.brand_id,
  b.name AS brand_name
FROM warehouse_scalev_mapping wsm
LEFT JOIN warehouse_products wp
  ON wp.id = wsm.warehouse_product_id
LEFT JOIN brands b
  ON b.id = wp.brand_id;

COMMENT ON VIEW v_warehouse_scalev_attribution_profiles IS
  'Scalev product mapping joined with warehouse stock category and brand metadata for attribution logic.';
