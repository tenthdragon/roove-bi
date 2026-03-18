-- ============================================================================
-- Migration 040: Remove redundant shipped_time from scalev_order_lines
-- ============================================================================
-- All MVs should use scalev_orders.shipped_time (the authoritative date field).
-- The duplicate column on order_lines added maintenance burden and bug surface.
--
-- Strategy: DROP COLUMN CASCADE, then recreate all dependent views/MVs
-- pointing to scalev_orders.shipped_time instead.
-- ============================================================================

BEGIN;

-- ── Step 1: Drop the column (CASCADE drops all dependent views/MVs) ──
ALTER TABLE scalev_order_lines DROP COLUMN shipped_time CASCADE;

-- ── Step 2: Recreate views/MVs in dependency order ──

-- 2a. v_order_with_identity — base view for customer analytics
--     CHANGE: uses so.shipped_time instead of sol.shipped_time
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
    CASE
        WHEN so.customer_name IS NULL THEN 'unidentified:' || so.order_id
        WHEN so.platform = ANY (ARRAY['shopee','tiktokshop','tiktok','lazada','tokopedia','blibli'])
            THEN so.platform || ':' || so.customer_name
        WHEN so.customer_phone IS NOT NULL AND so.customer_phone <> ''
            THEN so.customer_phone
        ELSE COALESCE(so.platform, 'unknown') || ':' || COALESCE(so.customer_name, 'unknown')
    END AS customer_identifier,
    sol.product_price_bt - sol.discount_bt AS line_revenue,
    sol.cogs_bt AS line_cogs
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND (so.status = ANY (ARRAY['completed','shipped']));

-- 2b. v_customer_first_order — depends on v_order_with_identity
CREATE OR REPLACE VIEW v_customer_first_order AS
SELECT customer_identifier,
    min(date(shipped_time)) AS first_order_date
FROM v_order_with_identity
GROUP BY customer_identifier;

-- 2c. v_daily_order_summary — standalone, uses JOIN now
--     CHANGE: JOINs scalev_orders for shipped_time instead of reading from order_lines
CREATE OR REPLACE VIEW v_daily_order_summary AS
SELECT (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS date,
    sol.product_type AS product,
    sum((sol.product_price_bt - sol.discount_bt) * sol.quantity::numeric) AS net_sales,
    sum((sol.product_price_bt - sol.discount_bt - sol.cogs_bt) * sol.quantity::numeric) AS gross_profit,
    sum(sol.cogs_bt * sol.quantity::numeric) AS total_cogs,
    count(DISTINCT sol.order_id) AS order_count,
    sum(sol.quantity) AS units_sold
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND sol.product_type IS NOT NULL
GROUP BY (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date, sol.product_type
ORDER BY (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date, sol.product_type;

-- 2d. v_daily_channel_summary — standalone, uses JOIN now
--     CHANGE: JOINs scalev_orders for shipped_time instead of reading from order_lines
CREATE OR REPLACE VIEW v_daily_channel_summary AS
SELECT (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS date,
    sol.product_type AS product,
    sol.sales_channel AS channel,
    sum((sol.product_price_bt - sol.discount_bt) * sol.quantity::numeric) AS net_sales,
    sum((sol.product_price_bt - sol.discount_bt - sol.cogs_bt) * sol.quantity::numeric) AS gross_profit,
    count(DISTINCT sol.order_id) AS order_count,
    sum(sol.quantity) AS units_sold
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND sol.product_type IS NOT NULL
  AND sol.sales_channel IS NOT NULL
GROUP BY (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date, sol.product_type, sol.sales_channel
ORDER BY (so.shipped_time AT TIME ZONE 'Asia/Jakarta')::date, sol.product_type, sol.sales_channel;

-- 2e. mv_daily_customer_type — depends on v_order_with_identity + v_customer_first_order
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
    END,
    o.sales_channel;

-- 2f. v_daily_customer_type — wrapper view for MV
CREATE OR REPLACE VIEW v_daily_customer_type AS
SELECT * FROM mv_daily_customer_type;

-- 2g. mv_customer_cohort — depends on v_order_with_identity + v_customer_first_order
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

-- 2h. v_customer_cohort — wrapper view for MV
CREATE OR REPLACE VIEW v_customer_cohort AS
SELECT * FROM mv_customer_cohort;

-- 2i. mv_monthly_cohort — depends on v_order_with_identity + v_customer_first_order
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

-- 2j. v_monthly_cohort — wrapper view for MV
CREATE OR REPLACE VIEW v_monthly_cohort AS
SELECT * FROM mv_monthly_cohort;

-- 2k. mv_bundled_orders — uses scalev_orders.shipped_time via JOIN now
--     CHANGE: JOINs scalev_orders for shipped_time filter
CREATE MATERIALIZED VIEW mv_bundled_orders AS
SELECT sol.scalev_order_id
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE so.shipped_time IS NOT NULL
  AND sol.product_type NOT IN ('Unknown', 'Other')
GROUP BY sol.scalev_order_id
HAVING count(DISTINCT sol.product_type) > 1;

-- 2l. mv_customer_brand_map — uses scalev_orders.shipped_time via v_order_with_identity
--     CHANGE: date() uses so.shipped_time instead of sol.shipped_time
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

-- 2m. mv_multi_brand_stats — depends on mv_customer_brand_map (unchanged logic)
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

-- 2n. v_brand_analysis_summary — depends on mv_multi_brand_stats (unchanged logic)
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

-- 2o. mv_cross_brand_matrix — depends on mv_customer_brand_map (unchanged logic)
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

-- 2p. mv_brand_journey — depends on mv_customer_brand_map (unchanged logic)
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

-- ── Step 3: Recreate refresh_brand_analysis function ──
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

-- ── Step 4: Add unique indexes for CONCURRENTLY refresh support on new MVs ──
CREATE UNIQUE INDEX IF NOT EXISTS mv_daily_customer_type_uniq
    ON mv_daily_customer_type (date, customer_type, sales_channel);
CREATE UNIQUE INDEX IF NOT EXISTS mv_customer_cohort_uniq
    ON mv_customer_cohort (customer_phone);
CREATE UNIQUE INDEX IF NOT EXISTS mv_monthly_cohort_uniq
    ON mv_monthly_cohort (cohort_month, months_since_first);

COMMIT;
