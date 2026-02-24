-- ============================================================
-- MIGRATION: Hybrid Repeat Detection
-- 
-- Priority:
--   1. CSV customer_type exists → use it (Scalev knows full history)
--   2. No CSV label → compute from earliest order date per identifier
--
-- Identifier:
--   - Phone exists → phone (cross all stores/platforms)
--   - No phone → platform:name (cross stores, same platform)
-- ============================================================

DROP VIEW IF EXISTS v_daily_customer_type CASCADE;
DROP VIEW IF EXISTS v_customer_cohort CASCADE;
DROP VIEW IF EXISTS v_monthly_cohort CASCADE;
DROP VIEW IF EXISTS v_customer_first_order CASCADE;
DROP VIEW IF EXISTS v_order_with_identity CASCADE;

-- ── Step 1: Order with identity + hybrid customer type ──
CREATE OR REPLACE VIEW v_order_with_identity AS
SELECT
  so.id as order_db_id,
  so.order_id,
  so.customer_name,
  so.customer_phone,
  so.customer_type as csv_customer_type,
  so.platform,
  so.store_name,
  sol.shipped_time,
  sol.sales_channel,
  sol.product_type,
  sol.quantity,
  sol.product_price_bt,
  sol.discount_bt,
  sol.cogs_bt,
  sol.scalev_order_id,
  -- Universal customer identifier
  CASE
    WHEN so.customer_phone IS NOT NULL AND so.customer_phone != '' 
      THEN so.customer_phone
    ELSE COALESCE(so.platform, 'unknown') || ':' || COALESCE(so.customer_name, 'unknown')
  END as customer_identifier,
  -- Revenue
  (sol.product_price_bt - sol.discount_bt) as line_revenue,
  sol.cogs_bt as line_cogs
FROM scalev_order_lines sol
JOIN scalev_orders so ON sol.scalev_order_id = so.id
WHERE sol.shipped_time IS NOT NULL;

-- ── Step 2: First order date per identifier (for computed fallback) ──
CREATE OR REPLACE VIEW v_customer_first_order AS
SELECT
  customer_identifier,
  MIN(DATE(shipped_time)) as first_order_date
FROM v_order_with_identity
GROUP BY customer_identifier;

-- ── Step 3: Daily customer type (hybrid) ──
CREATE OR REPLACE VIEW v_daily_customer_type AS
SELECT
  DATE(o.shipped_time) as date,
  -- HYBRID: CSV label first, computed fallback
  CASE 
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type != '' 
      THEN CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN DATE(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END as customer_type,
  o.sales_channel,
  COUNT(DISTINCT o.order_id) as order_count,
  COUNT(DISTINCT o.customer_identifier) as customer_count,
  SUM(o.line_revenue) as revenue,
  SUM(o.line_cogs) as cogs
FROM v_order_with_identity o
JOIN v_customer_first_order f ON o.customer_identifier = f.customer_identifier
GROUP BY 
  DATE(o.shipped_time),
  CASE 
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type != '' 
      THEN CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN DATE(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END,
  o.sales_channel;

-- ── Step 4: Customer cohort (hybrid) ──
CREATE OR REPLACE VIEW v_customer_cohort AS
WITH order_typed AS (
  SELECT
    o.*,
    f.first_order_date,
    CASE 
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type != '' 
        THEN CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN DATE(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END as resolved_type
  FROM v_order_with_identity o
  JOIN v_customer_first_order f ON o.customer_identifier = f.customer_identifier
)
SELECT
  customer_identifier as customer_phone,
  MIN(customer_name) as first_name,
  MIN(sales_channel) as first_channel,
  COUNT(DISTINCT order_id) as total_orders,
  SUM(line_revenue) as total_revenue,
  AVG(line_revenue) as avg_order_value,
  MIN(DATE(shipped_time)) as first_order_date,
  MAX(DATE(shipped_time)) as last_order_date,
  -- Customer is repeat if ANY of their orders is marked repeat
  BOOL_OR(resolved_type = 'ro') as is_repeat
FROM order_typed
GROUP BY customer_identifier;

-- ── Step 5: Monthly cohort ──
CREATE OR REPLACE VIEW v_monthly_cohort AS
WITH customer_cohort_month AS (
  SELECT
    customer_identifier,
    TO_CHAR(first_order_date, 'YYYY-MM') as cohort_month
  FROM v_customer_first_order
),
monthly_activity AS (
  SELECT
    o.customer_identifier,
    TO_CHAR(DATE(o.shipped_time), 'YYYY-MM') as activity_month
  FROM v_order_with_identity o
  GROUP BY o.customer_identifier, TO_CHAR(DATE(o.shipped_time), 'YYYY-MM')
)
SELECT
  cc.cohort_month,
  (EXTRACT(YEAR FROM TO_DATE(ma.activity_month, 'YYYY-MM')) * 12 + EXTRACT(MONTH FROM TO_DATE(ma.activity_month, 'YYYY-MM')))
  - (EXTRACT(YEAR FROM TO_DATE(cc.cohort_month, 'YYYY-MM')) * 12 + EXTRACT(MONTH FROM TO_DATE(cc.cohort_month, 'YYYY-MM')))
  as months_since_first,
  COUNT(DISTINCT ma.customer_identifier) as active_customers,
  COUNT(DISTINCT ma.customer_identifier) as orders,
  0 as revenue
FROM customer_cohort_month cc
JOIN monthly_activity ma ON cc.customer_identifier = ma.customer_identifier
GROUP BY cc.cohort_month, 
  (EXTRACT(YEAR FROM TO_DATE(ma.activity_month, 'YYYY-MM')) * 12 + EXTRACT(MONTH FROM TO_DATE(ma.activity_month, 'YYYY-MM')))
  - (EXTRACT(YEAR FROM TO_DATE(cc.cohort_month, 'YYYY-MM')) * 12 + EXTRACT(MONTH FROM TO_DATE(cc.cohort_month, 'YYYY-MM')));
