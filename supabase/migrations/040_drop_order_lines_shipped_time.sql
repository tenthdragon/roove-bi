-- Drop redundant shipped_time column from scalev_order_lines.
-- Date grouping uses scalev_orders.shipped_time (via JOIN in all MVs).
-- The column on order_lines was never referenced by any MV, view, or RPC.
ALTER TABLE scalev_order_lines DROP COLUMN IF EXISTS shipped_time;
