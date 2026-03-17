-- ============================================================
-- Fix regression: ads-only days missing from mv_daily_product_complete
-- ============================================================
-- Migration 026 changed FULL OUTER JOIN (from 014) back to LEFT JOIN,
-- so dates with ads spend but no orders are lost again.
-- Restore FULL OUTER JOIN so those dates appear in the daily trend.
-- ============================================================

-- Drop dependent views
DROP VIEW IF EXISTS v_daily_totals;
DROP VIEW IF EXISTS daily_product_summary;

-- Recreate MV4 with FULL OUTER JOIN
DROP MATERIALIZED VIEW IF EXISTS mv_daily_product_complete;

CREATE MATERIALIZED VIEW mv_daily_product_complete AS
SELECT
  COALESCE(cc.date, ads.date)       AS date,
  COALESCE(cc.product, ads.product) AS product,
  COALESCE(cc.net_sales, 0)         AS net_sales,
  COALESCE(cc.gross_profit, 0)      AS gross_profit,
  COALESCE(cc.mp_admin_cost, 0) + COALESCE(ads.total_ads_spend, 0) AS mkt_cost,
  COALESCE(cc.mp_admin_cost, 0)     AS mp_admin_cost,
  COALESCE(cc.gross_profit, 0)
    - (COALESCE(cc.mp_admin_cost, 0) + COALESCE(ads.total_ads_spend, 0)) AS net_after_mkt
FROM (
  SELECT
    date,
    product,
    SUM(net_sales)      AS net_sales,
    SUM(gross_profit)   AS gross_profit,
    SUM(mp_admin_cost)  AS mp_admin_cost
  FROM mv_daily_channel_complete
  GROUP BY date, product
) cc
FULL OUTER JOIN mv_daily_ads_by_brand ads
  ON ads.date = cc.date
  AND ads.product = cc.product;

CREATE UNIQUE INDEX idx_mv_dpc_date_prod
  ON mv_daily_product_complete (date, product);

-- Recreate dependent views
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

-- Refresh
REFRESH MATERIALIZED VIEW mv_daily_product_complete;
