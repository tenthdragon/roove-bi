-- ============================================================
-- Phase 2: Materialized Views
-- Replaces Google Sheet sync for order/sales data
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- MV 1: Daily order data per channel (from ScaleV order lines)
-- ────────────────────────────────────────────────────────────
-- Aggregates scalev_order_lines for shipped/completed orders.
-- Applies channel merge: TikTok Ads + TikTok Shop → TikTok
-- Note: _bt fields from scalev are already LINE TOTALS (not per-unit).
--       Do NOT multiply by quantity — that would inflate the values.

CREATE MATERIALIZED VIEW mv_daily_order_channel AS
SELECT
  DATE(o.shipped_time) AS date,
  l.product_type AS product,
  CASE
    WHEN l.sales_channel IN ('TikTok Ads', 'TikTok Shop') THEN 'TikTok'
    ELSE l.sales_channel
  END AS channel,
  SUM(l.product_price_bt)                              AS gross_sales,
  SUM(l.discount_bt)                                   AS discount,
  SUM(l.product_price_bt - l.discount_bt)              AS net_sales,
  SUM(l.cogs_bt)                                       AS cogs,
  SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)  AS gross_profit
FROM scalev_order_lines l
JOIN scalev_orders o ON l.scalev_order_id = o.id
WHERE o.status IN ('shipped', 'completed')
  AND o.shipped_time IS NOT NULL
  AND l.product_type IS NOT NULL
  AND l.product_type != 'Unknown'
GROUP BY
  DATE(o.shipped_time),
  l.product_type,
  CASE
    WHEN l.sales_channel IN ('TikTok Ads', 'TikTok Shop') THEN 'TikTok'
    ELSE l.sales_channel
  END;

CREATE UNIQUE INDEX idx_mv_doc_date_prod_ch
  ON mv_daily_order_channel (date, product, channel);

-- ────────────────────────────────────────────────────────────
-- MV 2: Daily ads spend per brand
-- ────────────────────────────────────────────────────────────
-- Aggregates daily_ads_spend using store→brand mapping.
-- daily_ads_spend continues to be populated from Google Sheet Ads tab.

CREATE MATERIALIZED VIEW mv_daily_ads_by_brand AS
SELECT
  a.date,
  m.brand AS product,
  SUM(a.spent) AS total_ads_spend
FROM daily_ads_spend a
JOIN ads_store_brand_mapping m
  ON LOWER(a.store) = LOWER(m.store_pattern)
WHERE a.spent > 0
GROUP BY a.date, m.brand;

CREATE UNIQUE INDEX idx_mv_adb_date_prod
  ON mv_daily_ads_by_brand (date, product);

-- ────────────────────────────────────────────────────────────
-- MV 3: Daily channel data (complete) — replaces daily_channel_data
-- ────────────────────────────────────────────────────────────
-- Combines order data + marketplace commissions.
-- Ads cost is NOT attributed per channel (only at product level in MV4).
-- mp_admin_cost = net_sales × commission_rate for marketplace channels.

CREATE MATERIALIZED VIEW mv_daily_channel_complete AS
SELECT
  oc.date,
  oc.product,
  oc.channel,
  ROUND(oc.gross_sales)    AS gross_sales,
  ROUND(oc.discount)       AS discount,
  ROUND(oc.net_sales)      AS net_sales,
  ROUND(oc.cogs)           AS cogs,
  ROUND(oc.gross_profit)   AS gross_profit,
  ROUND(COALESCE(oc.net_sales * cr.rate, 0)) AS mp_admin_cost,
  -- mkt_cost at channel level = mp_admin only (ads attributed at product level)
  ROUND(COALESCE(oc.net_sales * cr.rate, 0)) AS mkt_cost,
  -- net_after_mkt at channel level = gross_profit - mp_admin_cost
  ROUND(oc.gross_profit - COALESCE(oc.net_sales * cr.rate, 0)) AS net_after_mkt
FROM mv_daily_order_channel oc
LEFT JOIN marketplace_commission_rates cr
  ON cr.channel = oc.channel
  AND cr.effective_from = (
    SELECT MAX(cr2.effective_from)
    FROM marketplace_commission_rates cr2
    WHERE cr2.channel = oc.channel
      AND cr2.effective_from <= oc.date
  );

CREATE UNIQUE INDEX idx_mv_dcc_date_prod_ch
  ON mv_daily_channel_complete (date, product, channel);

-- ────────────────────────────────────────────────────────────
-- MV 4: Daily product summary (complete) — replaces daily_product_summary
-- ────────────────────────────────────────────────────────────
-- Aggregates channel data + adds total ads spend at product level.
-- mkt_cost = total_mp_admin + total_ads_spend
-- net_after_mkt = total_gross_profit - mkt_cost

CREATE MATERIALIZED VIEW mv_daily_product_complete AS
SELECT
  cc.date,
  cc.product,
  SUM(cc.net_sales)        AS net_sales,
  SUM(cc.gross_profit)     AS gross_profit,
  -- mkt_cost = all mp_admin across channels + ads spend for this brand
  SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0) AS mkt_cost,
  SUM(cc.mp_admin_cost)    AS mp_admin_cost,
  -- net_after_mkt = gross_profit - total_mkt_cost
  SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0)) AS net_after_mkt
FROM mv_daily_channel_complete cc
LEFT JOIN mv_daily_ads_by_brand ads
  ON ads.date = cc.date
  AND ads.product = cc.product
GROUP BY cc.date, cc.product, ads.total_ads_spend;

CREATE UNIQUE INDEX idx_mv_dpc_date_prod
  ON mv_daily_product_complete (date, product);
