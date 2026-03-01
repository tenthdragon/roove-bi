-- ============================================================
-- Phase 4: Dashboard Switch
-- Rename legacy tables, create view aliases pointing to MVs.
-- Dashboard queries stay EXACTLY the same — zero UI changes.
-- ============================================================

-- ── Step 1: Drop existing regular views that reference legacy tables ──
DROP VIEW IF EXISTS v_daily_totals;
DROP VIEW IF EXISTS v_channel_totals;

-- ── Step 2: Rename legacy tables (preserve for rollback & historical data) ──
ALTER TABLE daily_channel_data RENAME TO daily_channel_data_legacy;
ALTER TABLE daily_product_summary RENAME TO daily_product_summary_legacy;

-- ── Step 3: Create view aliases with identical column layout ──

-- This view replaces daily_channel_data for the dashboard.
-- Columns match the original table schema exactly.
CREATE OR REPLACE VIEW daily_channel_data AS
SELECT
  NULL::INT           AS id,
  date,
  product,
  channel,
  gross_sales,
  discount,
  net_sales,
  cogs,
  gross_profit,
  mkt_cost,
  mp_admin_cost,
  net_after_mkt,
  NULL::INT           AS import_id
FROM mv_daily_channel_complete;

-- This view replaces daily_product_summary for the dashboard.
CREATE OR REPLACE VIEW daily_product_summary AS
SELECT
  NULL::INT           AS id,
  date,
  product,
  net_sales,
  gross_profit,
  mp_admin_cost,
  net_after_mkt,
  mkt_cost,
  NULL::INT           AS import_id
FROM mv_daily_product_complete;

-- ── Step 4: Recreate utility views on new aliases ──
CREATE OR REPLACE VIEW v_daily_totals AS
SELECT
  date,
  SUM(net_sales) as net_sales,
  SUM(gross_profit) as gross_profit,
  SUM(net_after_mkt) as net_after_mkt,
  SUM(mkt_cost) as mkt_cost
FROM daily_product_summary
GROUP BY date
ORDER BY date;

CREATE OR REPLACE VIEW v_channel_totals AS
SELECT
  channel,
  SUM(net_sales) as net_sales,
  SUM(gross_profit) as gross_profit
FROM daily_channel_data
GROUP BY channel
ORDER BY SUM(net_sales) DESC;

-- ── Note on RLS ──
-- Views inherit access from the underlying materialized views.
-- MVs don't have RLS by default, so data is accessible to service role.
-- Dashboard already uses service role for data queries.
