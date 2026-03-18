-- ============================================================================
-- Migration 042: Persist customer_identifier on scalev_orders
-- ============================================================================
-- Problem: MV5/6/7 (customer MVs) are extremely slow because they depend on
-- v_order_with_identity which computes customer_identifier via CASE on every
-- scan of 340K+ rows, and v_customer_first_order which GROUP BYs all 340K rows.
--
-- Fix:
-- 1. Add customer_identifier as stored column + index on scalev_orders
-- 2. Backfill from existing data
-- 3. Trigger to auto-compute on INSERT/UPDATE
-- 4. Simplify v_order_with_identity to use stored column
-- 5. Replace v_customer_first_order with MV (mv_customer_first_order)
-- 6. Recreate MV5/6/7 to use mv_customer_first_order
-- ============================================================================

BEGIN;

-- ── Step 1: Add column ──
ALTER TABLE scalev_orders ADD COLUMN IF NOT EXISTS customer_identifier TEXT;

-- ── Step 2: Backfill ──
UPDATE scalev_orders SET customer_identifier =
  CASE
    WHEN customer_name IS NULL THEN 'unidentified:' || order_id
    WHEN platform = ANY(ARRAY['shopee','tiktokshop','tiktok','lazada','tokopedia','blibli'])
      THEN platform || ':' || customer_name
    WHEN customer_phone IS NOT NULL AND customer_phone <> ''
      THEN customer_phone
    ELSE COALESCE(platform, 'unknown') || ':' || COALESCE(customer_name, 'unknown')
  END
WHERE customer_identifier IS NULL;

-- ── Step 3: Index ──
CREATE INDEX IF NOT EXISTS idx_scalev_orders_cust_id
  ON scalev_orders (customer_identifier);

-- ── Step 4: Trigger function ──
CREATE OR REPLACE FUNCTION compute_customer_identifier()
RETURNS TRIGGER AS $$
BEGIN
  NEW.customer_identifier :=
    CASE
      WHEN NEW.customer_name IS NULL THEN 'unidentified:' || NEW.order_id
      WHEN NEW.platform = ANY(ARRAY['shopee','tiktokshop','tiktok','lazada','tokopedia','blibli'])
        THEN NEW.platform || ':' || NEW.customer_name
      WHEN NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> ''
        THEN NEW.customer_phone
      ELSE COALESCE(NEW.platform, 'unknown') || ':' || COALESCE(NEW.customer_name, 'unknown')
    END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_customer_identifier ON scalev_orders;
CREATE TRIGGER trg_compute_customer_identifier
  BEFORE INSERT OR UPDATE OF customer_name, customer_phone, platform, order_id
  ON scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION compute_customer_identifier();

-- ── Step 5: Drop dependent MVs (CASCADE from views) ──
-- Must drop in reverse dependency order
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_cohort CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_customer_cohort CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_daily_customer_type CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_brand_journey CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_cross_brand_matrix CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_multi_brand_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_customer_brand_map CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_bundled_orders CASCADE;

-- ── Step 6: Replace v_order_with_identity — use stored column ──
CREATE OR REPLACE VIEW v_order_with_identity AS
SELECT so.id AS order_db_id,
    so.order_id,
    so.customer_name,
    so.customer_phone,
    so.customer_type AS csv_customer_type,
    so.platform,
    so.store_name,
    so.shipped_time,
    sol.sales_channel,
    sol.product_type,
    sol.quantity,
    sol.product_price_bt,
    sol.discount_bt,
    sol.cogs_bt,
    sol.scalev_order_id,
    so.customer_identifier,
    sol.product_price_bt - sol.discount_bt AS line_revenue,
    sol.cogs_bt AS line_cogs
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND (so.status = ANY (ARRAY['completed','shipped']));

-- ── Step 7: Replace v_customer_first_order with MV ──
-- This is the biggest performance win — no more 340K GROUP BY on every MV refresh
DROP VIEW IF EXISTS v_customer_first_order CASCADE;

CREATE MATERIALIZED VIEW mv_customer_first_order AS
SELECT customer_identifier,
    MIN(DATE(shipped_time)) AS first_order_date
FROM scalev_orders
WHERE shipped_time IS NOT NULL
  AND status IN ('shipped', 'completed')
  AND customer_identifier IS NOT NULL
GROUP BY customer_identifier;

CREATE UNIQUE INDEX idx_mv_cfo_cust_id
  ON mv_customer_first_order (customer_identifier);

-- Wrapper view for backward compatibility
CREATE OR REPLACE VIEW v_customer_first_order AS
SELECT * FROM mv_customer_first_order;

-- ── Step 8: Recreate MV5 (mv_daily_customer_type) ──
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
LEFT JOIN mv_customer_first_order f ON o.customer_identifier = f.customer_identifier
GROUP BY date(o.shipped_time),
    CASE
        WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
        WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
            CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
        WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
        ELSE 'ro'
    END,
    o.sales_channel;

CREATE UNIQUE INDEX mv_daily_customer_type_uniq
    ON mv_daily_customer_type (date, customer_type, sales_channel);

CREATE OR REPLACE VIEW v_daily_customer_type AS
SELECT * FROM mv_daily_customer_type;

-- ── Step 9: Recreate MV6 (mv_customer_cohort) ──
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
    JOIN mv_customer_first_order f ON o.customer_identifier = f.customer_identifier
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

CREATE UNIQUE INDEX mv_customer_cohort_uniq
    ON mv_customer_cohort (customer_phone);

CREATE OR REPLACE VIEW v_customer_cohort AS
SELECT * FROM mv_customer_cohort;

-- ── Step 10: Recreate MV7 (mv_monthly_cohort) ──
CREATE MATERIALIZED VIEW mv_monthly_cohort AS
WITH customer_cohort_month AS (
    SELECT customer_identifier,
        to_char(first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month
    FROM mv_customer_first_order
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

CREATE UNIQUE INDEX mv_monthly_cohort_uniq
    ON mv_monthly_cohort (cohort_month, months_since_first);

CREATE OR REPLACE VIEW v_monthly_cohort AS
SELECT * FROM mv_monthly_cohort;

-- ── Step 11: Recreate brand analysis MVs ──
CREATE MATERIALIZED VIEW mv_bundled_orders AS
SELECT sol.scalev_order_id
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND sol.product_type NOT IN ('Unknown', 'Other')
GROUP BY sol.scalev_order_id
HAVING count(DISTINCT sol.product_type) > 1;

CREATE MATERIALIZED VIEW mv_customer_brand_map AS
SELECT o.customer_identifier,
    sol.product_type AS brand,
    count(DISTINCT sol.order_id) AS order_count,
    sum(sol.product_price_bt - sol.discount_bt) AS total_revenue,
    min(date(o.shipped_time)) AS first_purchase_date,
    max(date(o.shipped_time)) AS last_purchase_date,
    bool_or(sol.scalev_order_id IN (SELECT scalev_order_id FROM mv_bundled_orders)) AS from_bundle,
    bool_or(NOT (sol.scalev_order_id IN (SELECT scalev_order_id FROM mv_bundled_orders))) AS from_separate
FROM v_order_with_identity o
JOIN scalev_order_lines sol ON sol.scalev_order_id = o.order_db_id
WHERE o.shipped_time IS NOT NULL
  AND sol.product_type IS NOT NULL
  AND sol.product_type NOT IN ('Unknown', 'Other')
  AND o.customer_identifier IS NOT NULL
GROUP BY o.customer_identifier, sol.product_type;

CREATE MATERIALIZED VIEW mv_multi_brand_stats AS
WITH customer_brands AS (
    SELECT customer_identifier,
        count(DISTINCT brand) AS brand_count,
        sum(order_count) AS total_orders,
        sum(total_revenue) AS total_revenue,
        (array_agg(brand ORDER BY first_purchase_date))[1] AS first_brand,
        array_agg(DISTINCT brand ORDER BY brand) AS brands_purchased,
        min(first_purchase_date) AS first_order_date,
        max(last_purchase_date) AS last_order_date,
        bool_and(from_bundle) AND NOT bool_or(from_separate) AS bundle_only,
        bool_and(from_separate) AND NOT bool_or(from_bundle) AS separate_only
    FROM mv_customer_brand_map
    GROUP BY customer_identifier
)
SELECT customer_identifier,
    brand_count,
    total_orders,
    total_revenue,
    round(total_revenue / NULLIF(total_orders, 0::numeric), 0) AS avg_order_value,
    first_brand,
    brands_purchased,
    first_order_date,
    last_order_date,
    CASE
        WHEN brand_count = 1 THEN 'single'
        WHEN brand_count = 2 THEN 'dual'
        ELSE 'multi'
    END AS customer_segment,
    CASE
        WHEN brand_count = 1 THEN 'single'
        WHEN bundle_only THEN 'bundle_only'
        WHEN separate_only THEN 'separate_only'
        ELSE 'mixed'
    END AS cross_brand_type
FROM customer_brands;

CREATE OR REPLACE VIEW v_brand_analysis_summary AS
WITH customer_segments AS (
    SELECT customer_segment,
        count(*) AS customer_count,
        sum(total_orders) AS total_orders,
        sum(total_revenue) AS total_revenue,
        avg(avg_order_value) AS avg_order_value
    FROM mv_multi_brand_stats
    GROUP BY customer_segment
), brand_distribution AS (
    SELECT brand_count,
        count(*) AS customer_count
    FROM mv_multi_brand_stats
    GROUP BY brand_count
), gateway AS (
    SELECT first_brand,
        count(*) AS customer_count
    FROM mv_multi_brand_stats
    GROUP BY first_brand
), cross_type AS (
    SELECT cross_brand_type,
        count(*) AS customer_count
    FROM mv_multi_brand_stats
    WHERE cross_brand_type <> 'single'
    GROUP BY cross_brand_type
)
SELECT 'segment'::text AS stat_type, customer_segment AS key,
    customer_count::text AS value1, total_orders::text AS value2,
    total_revenue::text AS value3, avg_order_value::text AS value4
FROM customer_segments
UNION ALL
SELECT 'distribution'::text, brand_count::text, customer_count::text, NULL, NULL, NULL
FROM brand_distribution
UNION ALL
SELECT 'gateway'::text, first_brand, customer_count::text, NULL, NULL, NULL
FROM gateway
UNION ALL
SELECT 'cross_type'::text, cross_brand_type, customer_count::text, NULL, NULL, NULL
FROM cross_type;

CREATE MATERIALIZED VIEW mv_cross_brand_matrix AS
WITH brand_totals AS (
    SELECT brand, count(DISTINCT customer_identifier) AS total_customers
    FROM mv_customer_brand_map
    GROUP BY brand
)
SELECT a.brand AS brand_from,
    b.brand AS brand_to,
    count(DISTINCT a.customer_identifier) AS shared_customers,
    bt.total_customers AS brand_from_total,
    round(count(DISTINCT a.customer_identifier)::numeric / NULLIF(bt.total_customers, 0)::numeric * 100, 1) AS overlap_pct
FROM mv_customer_brand_map a
JOIN mv_customer_brand_map b ON a.customer_identifier = b.customer_identifier AND a.brand <> b.brand
JOIN brand_totals bt ON bt.brand = a.brand
GROUP BY a.brand, b.brand, bt.total_customers;

CREATE MATERIALIZED VIEW mv_brand_journey AS
WITH ordered_brands AS (
    SELECT customer_identifier, brand, first_purchase_date,
        row_number() OVER (PARTITION BY customer_identifier ORDER BY first_purchase_date) AS brand_order
    FROM mv_customer_brand_map
), transitions AS (
    SELECT a.brand AS from_brand, b.brand AS to_brand, a.customer_identifier
    FROM ordered_brands a
    JOIN ordered_brands b ON a.customer_identifier = b.customer_identifier AND b.brand_order = a.brand_order + 1
)
SELECT from_brand, to_brand, count(DISTINCT customer_identifier) AS customer_count
FROM transitions
GROUP BY from_brand, to_brand;

-- ── Step 12: Recreate refresh_brand_analysis function ──
CREATE OR REPLACE FUNCTION refresh_brand_analysis()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_bundled_orders;
    REFRESH MATERIALIZED VIEW mv_customer_brand_map;
    REFRESH MATERIALIZED VIEW mv_multi_brand_stats;
    REFRESH MATERIALIZED VIEW mv_cross_brand_matrix;
    REFRESH MATERIALIZED VIEW mv_brand_journey;
    RETURN 'Brand analysis refreshed at ' || NOW()::TEXT;
END;
$$;

-- ── Step 13: Update refresh_order_views to include mv_customer_first_order ──
CREATE OR REPLACE FUNCTION refresh_order_views(use_concurrent BOOLEAN DEFAULT TRUE)
RETURNS void AS $$
BEGIN
  IF use_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_first_order;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_cohort;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_cohort;
  ELSE
    REFRESH MATERIALIZED VIEW mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW mv_customer_first_order;
    REFRESH MATERIALIZED VIEW mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW mv_customer_cohort;
    REFRESH MATERIALIZED VIEW mv_monthly_cohort;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET statement_timeout = '300s';

COMMIT;
