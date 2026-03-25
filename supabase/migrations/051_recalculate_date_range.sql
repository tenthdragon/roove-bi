-- ============================================================================
-- Migration 051: Recalculate summaries for a date range
-- ============================================================================
-- Lightweight alternative to recalculate_all_summaries() that only recomputes
-- a specific date range (e.g., last 7 days). Much faster on Nano instance.
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_summaries_range(p_from DATE, p_to DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
BEGIN
  -- ── Order summaries (MV1-MV4 equivalents) ──

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

  -- Clear and recompute ads for date range
  DELETE FROM summary_daily_ads_by_brand WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT a.date, m.brand, SUM(a.spent)
  FROM daily_ads_spend a
  JOIN ads_store_brand_mapping m ON LOWER(a.store) = LOWER(m.store_pattern)
  WHERE a.spent > 0 AND a.date >= p_from AND a.date <= p_to
  GROUP BY a.date, m.brand;

  -- Clear and recompute channel_complete for date range
  DELETE FROM summary_daily_channel_complete WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit,
     mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT oc.date, oc.product, oc.channel,
    ROUND(oc.gross_sales), ROUND(oc.discount), ROUND(oc.net_sales),
    ROUND(oc.cogs), ROUND(oc.gross_profit),
    ROUND(COALESCE(oc.net_sales * cr.rate, 0)),
    ROUND(COALESCE(oc.net_sales * cr.rate, 0)),
    ROUND(oc.gross_profit - COALESCE(oc.net_sales * cr.rate, 0))
  FROM summary_daily_order_channel oc
  LEFT JOIN marketplace_commission_rates cr
    ON cr.channel = oc.channel
    AND cr.effective_from = (
      SELECT MAX(cr2.effective_from)
      FROM marketplace_commission_rates cr2
      WHERE cr2.channel = oc.channel AND cr2.effective_from <= oc.date
    )
  WHERE oc.date >= p_from AND oc.date <= p_to;

  -- Clear and recompute product_complete for date range
  DELETE FROM summary_daily_product_complete WHERE date >= p_from AND date <= p_to;
  INSERT INTO summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT cc.date, cc.product,
    SUM(cc.net_sales), SUM(cc.gross_profit),
    SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0),
    SUM(cc.mp_admin_cost),
    SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0))
  FROM summary_daily_channel_complete cc
  LEFT JOIN summary_daily_ads_by_brand ads ON ads.date = cc.date AND ads.product = cc.product
  WHERE cc.date >= p_from AND cc.date <= p_to
  GROUP BY cc.date, cc.product, ads.total_ads_spend;

  -- ── Customer summaries for date range ──

  -- Recompute daily_customer_type for date range
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

  -- Note: customer_first_order, customer_cohort, and monthly_cohort are NOT
  -- recalculated here because they span all dates. Use recalculate_all_summaries()
  -- for a full rebuild if those are out of sync.
END;
$$;
