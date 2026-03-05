-- ============================================================
-- Fix: Ads spend on non-shipping days was invisible
-- ============================================================
-- Problem: mv_daily_product_complete uses LEFT JOIN from order data
-- to ads data. If no orders shipped on a date, ads spend for that
-- date is completely lost.
-- Fix: Use FULL OUTER JOIN so dates with only ads spend still appear.
-- ============================================================

-- ── Step 1: Drop dependent views (reverse order of creation) ──
DROP VIEW IF EXISTS v_daily_totals;
DROP VIEW IF EXISTS v_channel_totals;
DROP VIEW IF EXISTS daily_product_summary;
-- daily_channel_data view does NOT depend on mv_daily_product_complete, keep it

-- ── Step 2: Drop and recreate mv_daily_product_complete ──
DROP MATERIALIZED VIEW IF EXISTS mv_daily_product_complete;

CREATE MATERIALIZED VIEW mv_daily_product_complete AS
SELECT
  COALESCE(oc.date, ads.date)       AS date,
  COALESCE(oc.product, ads.product) AS product,
  COALESCE(oc.net_sales, 0)         AS net_sales,
  COALESCE(oc.gross_profit, 0)      AS gross_profit,
  -- mkt_cost = mp_admin across channels + ads spend for this brand
  COALESCE(oc.mp_admin_cost, 0) + COALESCE(ads.total_ads_spend, 0) AS mkt_cost,
  COALESCE(oc.mp_admin_cost, 0)     AS mp_admin_cost,
  -- net_after_mkt = gross_profit - total_mkt_cost
  COALESCE(oc.gross_profit, 0)
    - (COALESCE(oc.mp_admin_cost, 0) + COALESCE(ads.total_ads_spend, 0)) AS net_after_mkt
FROM (
  -- Pre-aggregate channel data to product level
  SELECT
    date,
    product,
    SUM(net_sales)      AS net_sales,
    SUM(gross_profit)   AS gross_profit,
    SUM(mp_admin_cost)  AS mp_admin_cost
  FROM mv_daily_channel_complete
  GROUP BY date, product
) oc
FULL OUTER JOIN mv_daily_ads_by_brand ads
  ON ads.date = oc.date
  AND ads.product = oc.product;

CREATE UNIQUE INDEX idx_mv_dpc_date_prod
  ON mv_daily_product_complete (date, product);

-- ── Step 3: Recreate dependent views ──

-- View alias for dashboard (matches original daily_product_summary schema)
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

-- Utility view: daily totals
CREATE OR REPLACE VIEW v_daily_totals AS
SELECT
  date,
  SUM(net_sales)      AS net_sales,
  SUM(gross_profit)   AS gross_profit,
  SUM(net_after_mkt)  AS net_after_mkt,
  SUM(mkt_cost)       AS mkt_cost
FROM daily_product_summary
GROUP BY date
ORDER BY date;

-- Utility view: channel totals (unchanged, but recreate since we dropped it)
CREATE OR REPLACE VIEW v_channel_totals AS
SELECT
  channel,
  SUM(net_sales)      AS net_sales,
  SUM(gross_profit)   AS gross_profit
FROM daily_channel_data
GROUP BY channel
ORDER BY SUM(net_sales) DESC;

-- ── Step 4: Refresh the rebuilt MV ──
REFRESH MATERIALIZED VIEW mv_daily_product_complete;
