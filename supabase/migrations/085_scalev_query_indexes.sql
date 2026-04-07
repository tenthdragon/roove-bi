-- Migration 085: Add indexes to speed up Scalev order queries
-- Fixes 15s query in ppic_monthly_movements_scalev and similar joins

-- Partial index for shipped orders by date (most common filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scalev_orders_shipped_status
ON scalev_orders (shipped_time)
WHERE status IN ('shipped', 'completed') AND shipped_time IS NOT NULL;

-- Index for joining order_lines by product_name (used in warehouse mapping lookups)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scalev_order_lines_product_name
ON scalev_order_lines (product_name);

-- Index for joining order_lines by scalev_order_id (used in all order-line joins)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scalev_order_lines_order_id
ON scalev_order_lines (scalev_order_id);
