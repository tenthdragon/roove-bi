-- ============================================================
-- Migration 059: Fix product_complete missing ads-only dates
--
-- Bug: summary_daily_product_complete only has rows for dates
-- with shipped orders (from summary_daily_channel_complete).
-- Dates with ONLY ads spend but no orders were missing entirely,
-- causing mkt_cost to be understated in the overview dashboard.
--
-- Fix:
--   1. Update fn_recompute_product_complete to handle ads-only
--      dates (where channel_complete has no rows)
--   2. Update fn_recalculate_date_range to UNION ads-only dates
--   3. Update fn_recalculate_all_summaries backfill similarly
--   4. Backfill missing rows for current data
-- ============================================================

-- ── 1. Fix fn_recompute_product_complete ──
-- Already handles ads-only correctly (reads from ads_by_brand independently).
-- The function itself is fine — the issue is it wasn't called for ads-only dates.
-- No change needed here.

-- ── 2. Fix fn_recalculate_date_range ──
CREATE OR REPLACE FUNCTION fn_recalculate_date_range(p_from DATE, p_to DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Clear and recompute order_channel for date range
  DELETE FROM summary_daily_order_channel WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_order_channel (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
  SELECT DATE(o.shipped_time), l.product_type, l.sales_channel,
    SUM(l.product_price_bt), SUM(l.discount_bt),
    SUM(l.product_price_bt - l.discount_bt), SUM(l.cogs_bt),
    SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)
  FROM scalev_order_lines l
  JOIN scalev_orders o ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed') AND o.shipped_time IS NOT NULL
    AND l.product_type IS NOT NULL AND l.product_type != 'Unknown'
    AND DATE(o.shipped_time) >= p_from AND DATE(o.shipped_time) <= p_to
  GROUP BY DATE(o.shipped_time), l.product_type, l.sales_channel;

  -- Clear and recompute ads_by_brand for date range
  DELETE FROM summary_daily_ads_by_brand WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT d.date, m.brand, SUM(d.spent)
  FROM daily_ads_spend d
  JOIN ads_store_brand_mapping m ON LOWER(d.store) = LOWER(m.store_pattern)
  WHERE d.date >= p_from AND d.date <= p_to AND d.spent > 0
  GROUP BY d.date, m.brand;

  -- Clear and recompute channel_complete for date range
  DELETE FROM summary_daily_channel_complete WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT oc.date, oc.product, oc.channel,
    oc.gross_sales, oc.discount, oc.net_sales, oc.cogs, oc.gross_profit,
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    oc.gross_profit - ROUND(oc.net_sales * COALESCE(cr.rate, 0))
  FROM summary_daily_order_channel oc
  LEFT JOIN marketplace_commission_rates cr
    ON cr.channel = oc.channel AND cr.product = oc.product
    AND cr.effective_from = (
      SELECT MAX(cr2.effective_from)
      FROM marketplace_commission_rates cr2
      WHERE cr2.channel = oc.channel AND cr2.effective_from <= oc.date
    )
  WHERE oc.date >= p_from AND oc.date <= p_to;

  -- Clear and recompute product_complete for date range
  -- Use FULL join of channel_complete and ads to include ads-only dates
  DELETE FROM summary_daily_product_complete WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT
    COALESCE(cc.date, ads.date),
    COALESCE(cc.product, ads.product),
    COALESCE(cc.sum_net_sales, 0),
    COALESCE(cc.sum_gross_profit, 0),
    COALESCE(cc.sum_mp_admin, 0) + COALESCE(ads.total_ads_spend, 0),
    COALESCE(cc.sum_mp_admin, 0),
    COALESCE(cc.sum_gross_profit, 0) - (COALESCE(cc.sum_mp_admin, 0) + COALESCE(ads.total_ads_spend, 0))
  FROM (
    SELECT date, product,
      SUM(net_sales) AS sum_net_sales,
      SUM(gross_profit) AS sum_gross_profit,
      SUM(mp_admin_cost) AS sum_mp_admin
    FROM summary_daily_channel_complete
    WHERE date >= p_from AND date <= p_to
    GROUP BY date, product
  ) cc
  FULL OUTER JOIN summary_daily_ads_by_brand ads
    ON ads.date = cc.date AND ads.product = cc.product
  WHERE COALESCE(cc.date, ads.date) >= p_from
    AND COALESCE(cc.date, ads.date) <= p_to;

  -- ── Customer summaries for date range ──
  DELETE FROM summary_daily_customer_type WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_customer_type (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs)
  SELECT date(o.shipped_time),
    CASE
      WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END,
    o.sales_channel,
    count(DISTINCT o.order_id), count(DISTINCT o.customer_identifier),
    sum(o.line_revenue), sum(o.line_cogs)
  FROM v_order_with_identity o
  LEFT JOIN summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  WHERE date(o.shipped_time) >= p_from AND date(o.shipped_time) <= p_to
  GROUP BY date(o.shipped_time),
    CASE
      WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END,
    o.sales_channel;
END;
$$;

-- ── 3. Fix fn_recalculate_all_summaries ──
-- Update the product_complete backfill section to use FULL OUTER JOIN
CREATE OR REPLACE FUNCTION fn_recalculate_all_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600s'
AS $$
BEGIN
  -- Temporarily disable triggers
  ALTER TABLE scalev_order_lines DISABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders DISABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders DISABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend DISABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates DISABLE TRIGGER trg_commission_rate_summaries;

  TRUNCATE summary_daily_order_channel,
           summary_daily_ads_by_brand,
           summary_daily_channel_complete,
           summary_daily_product_complete,
           summary_customer_first_order,
           summary_daily_customer_type,
           summary_customer_cohort,
           summary_monthly_cohort,
           summary_monthly_cohort_channel,
           summary_customer_ltv;

  -- Backfill order channel
  INSERT INTO summary_daily_order_channel (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
  SELECT DATE(o.shipped_time), l.product_type, l.sales_channel,
    SUM(l.product_price_bt), SUM(l.discount_bt),
    SUM(l.product_price_bt - l.discount_bt), SUM(l.cogs_bt),
    SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)
  FROM scalev_order_lines l
  JOIN scalev_orders o ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed') AND o.shipped_time IS NOT NULL
    AND l.product_type IS NOT NULL AND l.product_type != 'Unknown'
  GROUP BY DATE(o.shipped_time), l.product_type, l.sales_channel;

  -- Backfill ads by brand
  INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT d.date, m.brand, SUM(d.spent)
  FROM daily_ads_spend d
  JOIN ads_store_brand_mapping m ON LOWER(d.store) = LOWER(m.store_pattern)
  WHERE d.spent > 0
  GROUP BY d.date, m.brand;

  -- Backfill channel complete
  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT oc.date, oc.product, oc.channel,
    oc.gross_sales, oc.discount, oc.net_sales, oc.cogs, oc.gross_profit,
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    oc.gross_profit - ROUND(oc.net_sales * COALESCE(cr.rate, 0))
  FROM summary_daily_order_channel oc
  LEFT JOIN marketplace_commission_rates cr ON oc.channel = cr.channel AND oc.product = cr.product
  ON CONFLICT (date, product, channel) DO NOTHING;

  -- Backfill product complete (FULL OUTER JOIN to include ads-only dates)
  INSERT INTO summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT
    COALESCE(cc.date, ads.date),
    COALESCE(cc.product, ads.product),
    COALESCE(cc.sum_net_sales, 0),
    COALESCE(cc.sum_gross_profit, 0),
    COALESCE(cc.sum_mp_admin, 0) + COALESCE(ads.total_ads_spend, 0),
    COALESCE(cc.sum_mp_admin, 0),
    COALESCE(cc.sum_gross_profit, 0) - (COALESCE(cc.sum_mp_admin, 0) + COALESCE(ads.total_ads_spend, 0))
  FROM (
    SELECT date, product,
      SUM(net_sales) AS sum_net_sales,
      SUM(gross_profit) AS sum_gross_profit,
      SUM(mp_admin_cost) AS sum_mp_admin
    FROM summary_daily_channel_complete
    GROUP BY date, product
  ) cc
  FULL OUTER JOIN summary_daily_ads_by_brand ads
    ON ads.date = cc.date AND ads.product = cc.product;

  -- Backfill customer first order
  INSERT INTO summary_customer_first_order (customer_identifier, first_order_date)
  SELECT customer_identifier, MIN(DATE(shipped_time))
  FROM scalev_orders
  WHERE status IN ('shipped', 'completed') AND shipped_time IS NOT NULL
    AND customer_identifier IS NOT NULL
  GROUP BY customer_identifier;

  -- Backfill daily customer type
  INSERT INTO summary_daily_customer_type
    (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs)
  SELECT DATE(o.shipped_time),
    CASE
      WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END,
    o.sales_channel,
    COUNT(DISTINCT o.order_id), COUNT(DISTINCT o.customer_identifier),
    SUM(o.line_revenue), SUM(o.line_cogs)
  FROM v_order_with_identity o
  LEFT JOIN summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  GROUP BY DATE(o.shipped_time),
    CASE
      WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END,
    o.sales_channel;

  -- Backfill customer cohort
  INSERT INTO summary_customer_cohort (cohort_month, customer_identifier, first_channel)
  SELECT TO_CHAR(f.first_order_date, 'YYYY-MM'), f.customer_identifier,
    COALESCE(l.sales_channel, 'Unknown')
  FROM summary_customer_first_order f
  LEFT JOIN LATERAL (
    SELECT l2.sales_channel FROM scalev_order_lines l2
    JOIN scalev_orders o2 ON l2.scalev_order_id = o2.id
    WHERE o2.customer_identifier = f.customer_identifier
      AND DATE(o2.shipped_time) = f.first_order_date
    ORDER BY l2.product_price_bt DESC LIMIT 1
  ) l ON TRUE;

  -- Backfill monthly cohort
  INSERT INTO summary_monthly_cohort
    (cohort_month, order_month, first_channel, customers, orders, revenue)
  SELECT sc.cohort_month,
    TO_CHAR(o.shipped_time, 'YYYY-MM'),
    sc.first_channel,
    COUNT(DISTINCT o.customer_identifier),
    COUNT(DISTINCT o.order_id),
    SUM(COALESCE(o.product_price_bt, 0) - COALESCE(o.discount_bt, 0))
  FROM summary_customer_cohort sc
  JOIN v_order_with_identity o ON o.customer_identifier = sc.customer_identifier
  GROUP BY sc.cohort_month, TO_CHAR(o.shipped_time, 'YYYY-MM'), sc.first_channel;

  -- Backfill monthly cohort by channel
  INSERT INTO summary_monthly_cohort_channel
    (cohort_month, order_month, first_channel, order_channel, customers, orders, revenue)
  SELECT sc.cohort_month,
    TO_CHAR(o.shipped_time, 'YYYY-MM'),
    sc.first_channel,
    COALESCE(o.sales_channel, 'Unknown'),
    COUNT(DISTINCT o.customer_identifier),
    COUNT(DISTINCT o.order_id),
    SUM(COALESCE(o.product_price_bt, 0) - COALESCE(o.discount_bt, 0))
  FROM summary_customer_cohort sc
  JOIN v_order_with_identity o ON o.customer_identifier = sc.customer_identifier
  GROUP BY sc.cohort_month, TO_CHAR(o.shipped_time, 'YYYY-MM'), sc.first_channel, COALESCE(o.sales_channel, 'Unknown');

  -- Backfill customer LTV
  INSERT INTO summary_customer_ltv
    (customer_identifier, cohort_month, first_channel, lifetime_orders, lifetime_revenue, lifetime_cogs)
  SELECT o.customer_identifier,
    sc.cohort_month,
    sc.first_channel,
    COUNT(DISTINCT o.order_id),
    SUM(COALESCE(o.product_price_bt, 0) - COALESCE(o.discount_bt, 0)),
    SUM(COALESCE(o.cogs_bt, 0))
  FROM v_order_with_identity o
  JOIN summary_customer_cohort sc ON sc.customer_identifier = o.customer_identifier
  GROUP BY o.customer_identifier, sc.cohort_month, sc.first_channel;

  -- Re-enable triggers
  ALTER TABLE scalev_order_lines ENABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend ENABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates ENABLE TRIGGER trg_commission_rate_summaries;
END;
$$;

-- ── 4. One-time fix: backfill missing ads-only dates into product_complete ──
-- Insert rows for (date, product) combinations that exist in ads_by_brand
-- but not in product_complete
INSERT INTO summary_daily_product_complete
  (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
SELECT
  ads.date,
  ads.product,
  0,
  0,
  ads.total_ads_spend,
  0,
  0 - ads.total_ads_spend
FROM summary_daily_ads_by_brand ads
LEFT JOIN summary_daily_product_complete pc
  ON pc.date = ads.date AND pc.product = ads.product
WHERE pc.date IS NULL
  AND ads.total_ads_spend > 0;

-- Also fix existing rows where mkt_cost doesn't include ads
UPDATE summary_daily_product_complete pc
SET
  mkt_cost = pc.mp_admin_cost + ads.total_ads_spend,
  net_after_mkt = pc.gross_profit - (pc.mp_admin_cost + ads.total_ads_spend),
  updated_at = NOW()
FROM summary_daily_ads_by_brand ads
WHERE ads.date = pc.date AND ads.product = pc.product
  AND pc.mkt_cost != pc.mp_admin_cost + ads.total_ads_spend;
