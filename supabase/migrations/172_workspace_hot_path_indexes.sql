-- ============================================================================
-- 172: Workspace hot-path indexes
-- ============================================================================
-- Index-only migration: no rows, policies, constraints, or views are changed.
-- These indexes match the workspace + date/product filters used by dashboard
-- first paint and warehouse stock balance queries. Dashboard reads through
-- daily_product_summary/daily_channel_data views, so their indexes belong on
-- the summary tables underneath those views.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_dps_workspace_date
  ON public.summary_daily_product_complete (workspace_id, date);

CREATE INDEX IF NOT EXISTS idx_das_workspace_date
  ON public.daily_ads_spend (workspace_id, date);

CREATE INDEX IF NOT EXISTS idx_dcd_workspace_date
  ON public.summary_daily_channel_complete (workspace_id, date);

CREATE INDEX IF NOT EXISTS idx_wsl_workspace_product_quantity
  ON public.warehouse_stock_ledger (workspace_id, warehouse_product_id)
  INCLUDE (quantity);

CREATE INDEX IF NOT EXISTS idx_wb_workspace_product_active_stock
  ON public.warehouse_batches (workspace_id, warehouse_product_id)
  INCLUDE (current_qty, cost_per_unit)
  WHERE is_active = TRUE AND current_qty > 0;

COMMIT;
