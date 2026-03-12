-- ============================================================
-- Standardize Sales Channel Names
-- DB names = UI names, remove mapping layers
-- ============================================================
-- Renames:
--   'Facebook Ads' → 'Scalev Ads'
--   'Organik'      → 'CS Manual'
--   'TikTok Ads'   → 'CS Manual'  (merge — only 37 orders)
--   'Blibli'       → 'BliBli'     (fix casing — 1 record)
-- Removes TikTok merge in MV1 and get_daily_shipment_counts
-- ============================================================

BEGIN;

-- ── Step A: Rename sales_channel in scalev_order_lines ──

UPDATE scalev_order_lines
SET sales_channel = 'Scalev Ads'
WHERE sales_channel = 'Facebook Ads';

UPDATE scalev_order_lines
SET sales_channel = 'CS Manual'
WHERE sales_channel = 'Organik';

UPDATE scalev_order_lines
SET sales_channel = 'CS Manual',
    is_purchase_tiktok = false
WHERE sales_channel = 'TikTok Ads';

UPDATE scalev_order_lines
SET sales_channel = 'BliBli'
WHERE sales_channel = 'Blibli';

-- ── Step B: Rename marketplace_commission_rates.channel ──

UPDATE marketplace_commission_rates
SET channel = 'TikTok Shop'
WHERE channel = 'TikTok';

-- ── Step C: Recreate MV1 without TikTok merge ──

DROP MATERIALIZED VIEW IF EXISTS mv_daily_product_complete CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_channel_complete CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_order_channel CASCADE;

CREATE MATERIALIZED VIEW mv_daily_order_channel AS
SELECT
  DATE(o.shipped_time) AS date,
  l.product_type AS product,
  l.sales_channel AS channel,
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
  l.sales_channel;

CREATE UNIQUE INDEX idx_mv_doc_date_prod_ch
  ON mv_daily_order_channel (date, product, channel);

-- ── Step D: Recreate MV3 (daily_channel_complete) ──

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
  ROUND(COALESCE(oc.net_sales * cr.rate, 0)) AS mkt_cost,
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

-- ── Step E: Recreate MV4 (daily_product_complete) ──

CREATE MATERIALIZED VIEW mv_daily_product_complete AS
SELECT
  cc.date,
  cc.product,
  SUM(cc.net_sales)        AS net_sales,
  SUM(cc.gross_profit)     AS gross_profit,
  SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0) AS mkt_cost,
  SUM(cc.mp_admin_cost)    AS mp_admin_cost,
  SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0)) AS net_after_mkt
FROM mv_daily_channel_complete cc
LEFT JOIN mv_daily_ads_by_brand ads
  ON ads.date = cc.date
  AND ads.product = cc.product
GROUP BY cc.date, cc.product, ads.total_ads_spend;

CREATE UNIQUE INDEX idx_mv_dpc_date_prod
  ON mv_daily_product_complete (date, product);

-- ── Step F: Recreate get_daily_shipment_counts without TikTok merge ──

DROP FUNCTION IF EXISTS get_daily_shipment_counts(DATE, DATE);

CREATE OR REPLACE FUNCTION get_daily_shipment_counts(p_from DATE, p_to DATE)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  order_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(o.shipped_time) AS date,
    l.product_type AS product,
    l.sales_channel AS channel,
    COUNT(DISTINCT o.order_id) AS order_count
  FROM scalev_order_lines l
  JOIN scalev_orders o ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND o.shipped_time >= p_from
    AND o.shipped_time < (p_to + INTERVAL '1 day')
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
  GROUP BY
    DATE(o.shipped_time),
    l.product_type,
    l.sales_channel
  ORDER BY date;
END;
$$;

-- ── Step G: Recreate wrapper views dropped by CASCADE ──
-- (from migration 006_dashboard_switch.sql)

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

-- ── Step H: Refresh all materialized views ──

REFRESH MATERIALIZED VIEW mv_daily_order_channel;
REFRESH MATERIALIZED VIEW mv_daily_channel_complete;
REFRESH MATERIALIZED VIEW mv_daily_product_complete;

-- ── Step I: Materialize v_daily_customer_type for performance ──
-- The view joins v_order_with_identity with v_customer_first_order using
-- computed customer_identifier (no index possible). Pre-computing avoids
-- 6s+ query time that causes PostgREST timeout.

DROP VIEW IF EXISTS v_daily_customer_type;

CREATE MATERIALIZED VIEW mv_daily_customer_type AS
SELECT date(o.shipped_time) AS date,
  CASE
    WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
      CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END AS customer_type,
  o.sales_channel,
  count(DISTINCT o.order_id) AS order_count,
  count(DISTINCT o.customer_identifier) AS customer_count,
  sum(o.line_revenue) AS revenue,
  sum(o.line_cogs) AS cogs
FROM v_order_with_identity o
LEFT JOIN v_customer_first_order f ON o.customer_identifier = f.customer_identifier
GROUP BY date(o.shipped_time),
  CASE
    WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
      CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END, o.sales_channel;

CREATE UNIQUE INDEX idx_mv_daily_customer_type_uniq
  ON mv_daily_customer_type (date, customer_type, sales_channel);
CREATE INDEX idx_mv_daily_customer_type_date
  ON mv_daily_customer_type (date);

CREATE OR REPLACE VIEW v_daily_customer_type AS
  SELECT * FROM mv_daily_customer_type;

-- ── Step J: Materialize v_customer_cohort for performance ──

DROP VIEW IF EXISTS v_customer_cohort;

CREATE MATERIALIZED VIEW mv_customer_cohort AS
WITH order_typed AS (
  SELECT o.order_db_id, o.order_id, o.customer_name, o.customer_phone,
    o.csv_customer_type, o.platform, o.store_name, o.shipped_time,
    o.sales_channel, o.product_type, o.quantity, o.product_price_bt,
    o.discount_bt, o.cogs_bt, o.scalev_order_id, o.customer_identifier,
    o.line_revenue, o.line_cogs, f.first_order_date,
    CASE
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END AS resolved_type
  FROM v_order_with_identity o
  JOIN v_customer_first_order f ON o.customer_identifier = f.customer_identifier
)
SELECT customer_identifier AS customer_phone,
  min(customer_name) AS first_name,
  min(sales_channel) AS first_channel,
  count(DISTINCT order_id) AS total_orders,
  sum(line_revenue) AS total_revenue,
  sum(line_revenue) / NULLIF(count(DISTINCT order_id), 0)::numeric AS avg_order_value,
  min(date(shipped_time)) AS first_order_date,
  max(date(shipped_time)) AS last_order_date,
  bool_or(resolved_type = 'ro') AS is_repeat
FROM order_typed
GROUP BY customer_identifier;

CREATE UNIQUE INDEX idx_mv_customer_cohort_phone ON mv_customer_cohort (customer_phone);
CREATE INDEX idx_mv_customer_cohort_last_order ON mv_customer_cohort (last_order_date);

CREATE OR REPLACE VIEW v_customer_cohort AS SELECT * FROM mv_customer_cohort;

-- ── Step K: Materialize v_monthly_cohort for performance ──

DROP VIEW IF EXISTS v_monthly_cohort;

CREATE MATERIALIZED VIEW mv_monthly_cohort AS
WITH customer_cohort_month AS (
  SELECT customer_identifier,
    to_char(first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month
  FROM v_customer_first_order
), monthly_activity AS (
  SELECT o.customer_identifier,
    to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM') AS activity_month
  FROM v_order_with_identity o
  GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM')
)
SELECT cc.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM')) * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))) -
  (EXTRACT(year FROM to_date(cc.cohort_month, 'YYYY-MM')) * 12 +
   EXTRACT(month FROM to_date(cc.cohort_month, 'YYYY-MM'))) AS months_since_first,
  count(DISTINCT ma.customer_identifier) AS active_customers,
  count(DISTINCT ma.customer_identifier) AS orders,
  0 AS revenue
FROM customer_cohort_month cc
JOIN monthly_activity ma ON cc.customer_identifier = ma.customer_identifier
GROUP BY cc.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM')) * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))) -
  (EXTRACT(year FROM to_date(cc.cohort_month, 'YYYY-MM')) * 12 +
   EXTRACT(month FROM to_date(cc.cohort_month, 'YYYY-MM')));

CREATE UNIQUE INDEX idx_mv_monthly_cohort_uniq ON mv_monthly_cohort (cohort_month, months_since_first);

CREATE OR REPLACE VIEW v_monthly_cohort AS SELECT * FROM mv_monthly_cohort;

-- ── Step L: Update refresh function to include all new MVs ──

CREATE OR REPLACE FUNCTION refresh_order_views(use_concurrent BOOLEAN DEFAULT TRUE)
RETURNS void AS $func$
BEGIN
  IF use_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_cohort;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_cohort;
  ELSE
    REFRESH MATERIALIZED VIEW mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW mv_customer_cohort;
    REFRESH MATERIALIZED VIEW mv_monthly_cohort;
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
