-- ============================================================================
-- Migration 052: Per-channel cohort retention
-- ============================================================================
-- Adds a channel_group dimension to monthly cohort data so the dashboard can
-- show separate retention tables for Scalev, Shopee, TikTok Shop, Reseller.
-- Channel is determined by the customer's FIRST order's sales_channel.
-- ============================================================================

BEGIN;

-- ── 1. Helper function: map sales_channel → channel_group ──
CREATE OR REPLACE FUNCTION get_channel_group(p_channel TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_channel IN ('CS Manual', 'Scalev Ads', 'WABA') THEN 'Scalev'
    WHEN p_channel = 'Shopee' THEN 'Shopee'
    WHEN p_channel = 'TikTok Shop' THEN 'TikTok Shop'
    WHEN p_channel = 'Reseller' THEN 'Reseller'
    ELSE NULL
  END;
$$;

-- ── 2. New summary table ──
CREATE TABLE IF NOT EXISTS summary_monthly_cohort_channel (
  channel_group TEXT NOT NULL,
  cohort_month TEXT NOT NULL,
  months_since_first BIGINT NOT NULL,
  active_customers BIGINT DEFAULT 0,
  orders BIGINT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_group, cohort_month, months_since_first)
);

-- ── 3. RLS ──
ALTER TABLE summary_monthly_cohort_channel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read for authenticated"
  ON summary_monthly_cohort_channel FOR SELECT TO authenticated USING (true);

-- ── 4. Wrapper view ──
CREATE OR REPLACE VIEW v_monthly_cohort_channel AS
SELECT * FROM summary_monthly_cohort_channel;

-- ── 5. Update trigger function to also write per-channel cohort ──
CREATE OR REPLACE FUNCTION fn_update_customer_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_old_date DATE;
  v_new_date DATE;
  v_cust_id TEXT;
  v_first_order_date DATE;
  v_customer_type TEXT;
  v_line RECORD;
  v_total_revenue NUMERIC;
  v_total_orders BIGINT;
  v_cohort_month TEXT;
  v_activity_month TEXT;
  v_months_since INT;
  v_first_channel TEXT;
  v_channel_group TEXT;
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed') AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed') AND NEW.shipped_time IS NOT NULL;

  -- No change in qualification
  IF v_old_qualifying = v_new_qualifying AND OLD.shipped_time = NEW.shipped_time
     AND OLD.customer_identifier = NEW.customer_identifier THEN
    RETURN NEW;
  END IF;

  v_cust_id := NEW.customer_identifier;
  IF v_cust_id IS NULL THEN RETURN NEW; END IF;

  v_old_date := DATE(OLD.shipped_time);
  v_new_date := DATE(NEW.shipped_time);

  -- ────────────────────────────────────────────
  -- SUBTRACT old contribution if was qualifying
  -- ────────────────────────────────────────────
  IF v_old_qualifying AND OLD.customer_identifier IS NOT NULL THEN
    -- Determine old customer_type
    SELECT first_order_date INTO v_first_order_date
    FROM summary_customer_first_order WHERE customer_identifier = OLD.customer_identifier;

    v_customer_type := CASE
      WHEN OLD.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN OLD.customer_type IS NOT NULL AND OLD.customer_type <> '' THEN
        CASE WHEN OLD.customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN v_old_date = v_first_order_date THEN 'new'
      ELSE 'ro'
    END;

    -- Subtract from daily customer type
    FOR v_line IN
      SELECT sales_channel, product_price_bt, discount_bt, cogs_bt
      FROM scalev_order_lines WHERE scalev_order_id = OLD.id
        AND product_type IS NOT NULL AND product_type != 'Unknown'
    LOOP
      UPDATE summary_daily_customer_type SET
        order_count = GREATEST(0, order_count - 1),
        revenue = revenue - (COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0)),
        cogs = cogs - COALESCE(v_line.cogs_bt, 0),
        updated_at = NOW()
      WHERE date = v_old_date AND customer_type = v_customer_type AND sales_channel = v_line.sales_channel;
    END LOOP;

    -- Subtract from monthly cohort
    v_activity_month := to_char(v_old_date, 'YYYY-MM');
    v_cohort_month := to_char(v_first_order_date, 'YYYY-MM');
    v_months_since := (EXTRACT(year FROM v_old_date)::int * 12 + EXTRACT(month FROM v_old_date)::int)
                    - (EXTRACT(year FROM v_first_order_date)::int * 12 + EXTRACT(month FROM v_first_order_date)::int);

    UPDATE summary_monthly_cohort SET
      active_customers = GREATEST(0, active_customers - 1),
      orders = GREATEST(0, orders - 1),
      updated_at = NOW()
    WHERE cohort_month = v_cohort_month AND months_since_first = v_months_since;

    -- Subtract from per-channel monthly cohort
    SELECT first_channel INTO v_first_channel
    FROM summary_customer_cohort WHERE customer_phone = OLD.customer_identifier;
    v_channel_group := get_channel_group(v_first_channel);
    IF v_channel_group IS NOT NULL THEN
      UPDATE summary_monthly_cohort_channel SET
        active_customers = GREATEST(0, active_customers - 1),
        orders = GREATEST(0, orders - 1),
        updated_at = NOW()
      WHERE channel_group = v_channel_group
        AND cohort_month = v_cohort_month
        AND months_since_first = v_months_since;
    END IF;
  END IF;

  -- ────────────────────────────────────────────
  -- ADD new contribution if now qualifying
  -- ────────────────────────────────────────────
  IF v_new_qualifying THEN
    -- Update customer first order
    INSERT INTO summary_customer_first_order (customer_identifier, first_order_date)
    VALUES (v_cust_id, v_new_date)
    ON CONFLICT (customer_identifier) DO UPDATE SET
      first_order_date = LEAST(summary_customer_first_order.first_order_date, EXCLUDED.first_order_date);

    -- Get the (possibly updated) first order date
    SELECT first_order_date INTO v_first_order_date
    FROM summary_customer_first_order WHERE customer_identifier = v_cust_id;

    -- Determine customer_type
    v_customer_type := CASE
      WHEN v_cust_id ~~ 'unidentified:%' THEN 'unidentified'
      WHEN NEW.customer_type IS NOT NULL AND NEW.customer_type <> '' THEN
        CASE WHEN NEW.customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN v_new_date = v_first_order_date THEN 'new'
      ELSE 'ro'
    END;

    -- Add to daily customer type
    FOR v_line IN
      SELECT sales_channel, product_price_bt, discount_bt, cogs_bt
      FROM scalev_order_lines WHERE scalev_order_id = NEW.id
        AND product_type IS NOT NULL AND product_type != 'Unknown'
    LOOP
      INSERT INTO summary_daily_customer_type
        (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs, updated_at)
      VALUES
        (v_new_date, v_customer_type, v_line.sales_channel, 1, 1,
         COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0),
         COALESCE(v_line.cogs_bt, 0), NOW())
      ON CONFLICT (date, customer_type, sales_channel) DO UPDATE SET
        order_count = summary_daily_customer_type.order_count + 1,
        revenue = summary_daily_customer_type.revenue + EXCLUDED.revenue,
        cogs = summary_daily_customer_type.cogs + EXCLUDED.cogs,
        updated_at = NOW();
    END LOOP;

    -- Update customer cohort
    SELECT COALESCE(SUM(l.product_price_bt - l.discount_bt), 0), COUNT(DISTINCT o.order_id)
    INTO v_total_revenue, v_total_orders
    FROM scalev_orders o
    JOIN scalev_order_lines l ON l.scalev_order_id = o.id
    WHERE o.customer_identifier = v_cust_id
      AND o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND l.product_type IS NOT NULL AND l.product_type != 'Unknown';

    INSERT INTO summary_customer_cohort
      (customer_phone, first_name, first_channel, total_orders, total_revenue,
       avg_order_value, first_order_date, last_order_date, is_repeat, updated_at)
    VALUES
      (v_cust_id, NEW.customer_name,
       (SELECT sales_channel FROM scalev_order_lines WHERE scalev_order_id = NEW.id LIMIT 1),
       v_total_orders, v_total_revenue,
       v_total_revenue / NULLIF(v_total_orders, 0)::numeric,
       v_first_order_date,
       (SELECT MAX(DATE(shipped_time)) FROM scalev_orders
        WHERE customer_identifier = v_cust_id AND status IN ('shipped','completed') AND shipped_time IS NOT NULL),
       v_total_orders > 1,
       NOW())
    ON CONFLICT (customer_phone) DO UPDATE SET
      total_orders = EXCLUDED.total_orders,
      total_revenue = EXCLUDED.total_revenue,
      avg_order_value = EXCLUDED.avg_order_value,
      first_order_date = EXCLUDED.first_order_date,
      last_order_date = EXCLUDED.last_order_date,
      is_repeat = EXCLUDED.is_repeat,
      updated_at = NOW();

    -- Update monthly cohort
    v_activity_month := to_char(v_new_date, 'YYYY-MM');
    v_cohort_month := to_char(v_first_order_date, 'YYYY-MM');
    v_months_since := (EXTRACT(year FROM v_new_date)::int * 12 + EXTRACT(month FROM v_new_date)::int)
                    - (EXTRACT(year FROM v_first_order_date)::int * 12 + EXTRACT(month FROM v_first_order_date)::int);

    INSERT INTO summary_monthly_cohort
      (cohort_month, months_since_first, active_customers, orders, revenue, updated_at)
    VALUES (v_cohort_month, v_months_since, 1, 1, 0, NOW())
    ON CONFLICT (cohort_month, months_since_first) DO UPDATE SET
      active_customers = summary_monthly_cohort.active_customers + 1,
      orders = summary_monthly_cohort.orders + 1,
      updated_at = NOW();

    -- Update per-channel monthly cohort
    SELECT first_channel INTO v_first_channel
    FROM summary_customer_cohort WHERE customer_phone = v_cust_id;
    v_channel_group := get_channel_group(v_first_channel);
    IF v_channel_group IS NOT NULL THEN
      INSERT INTO summary_monthly_cohort_channel
        (channel_group, cohort_month, months_since_first, active_customers, orders, revenue, updated_at)
      VALUES (v_channel_group, v_cohort_month, v_months_since, 1, 1, 0, NOW())
      ON CONFLICT (channel_group, cohort_month, months_since_first) DO UPDATE SET
        active_customers = summary_monthly_cohort_channel.active_customers + 1,
        orders = summary_monthly_cohort_channel.orders + 1,
        updated_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 6. Update recalculate_all_summaries to include new table ──
CREATE OR REPLACE FUNCTION recalculate_all_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600s'
AS $$
BEGIN
  -- Temporarily disable triggers to avoid double-counting
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
           summary_monthly_cohort_channel;

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
  INSERT INTO summary_daily_ads_by_brand (date, source, store, spent, impressions, updated_at)
  SELECT date, source, store, SUM(spent), SUM(impressions), NOW()
  FROM daily_ads_spend
  GROUP BY date, source, store;

  -- Backfill channel complete (needs ads + commission)
  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT oc.date, oc.product, oc.channel,
    oc.gross_sales, oc.discount, oc.net_sales, oc.cogs, oc.gross_profit,
    ROUND(oc.net_sales * COALESCE(cr.rate, 0), 0),
    0, -- mkt_cost filled separately
    oc.gross_profit - ROUND(oc.net_sales * COALESCE(cr.rate, 0), 0)
  FROM summary_daily_order_channel oc
  LEFT JOIN marketplace_commission_rates cr ON oc.channel = cr.channel AND oc.product = cr.product
  ON CONFLICT (date, product, channel) DO NOTHING;

  -- Backfill product complete
  INSERT INTO summary_daily_product_complete (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT date, product, SUM(net_sales), SUM(gross_profit), 0, SUM(mp_admin_cost), SUM(net_after_mkt)
  FROM summary_daily_channel_complete
  GROUP BY date, product
  ON CONFLICT (date, product) DO NOTHING;

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
    COUNT(*),
    COUNT(DISTINCT o.customer_identifier),
    SUM(COALESCE(o.product_price_bt, 0) - COALESCE(o.discount_bt, 0)),
    SUM(COALESCE(o.cogs_bt, 0))
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
  INSERT INTO summary_customer_cohort
    (customer_phone, first_name, first_channel, total_orders, total_revenue,
     avg_order_value, first_order_date, last_order_date, is_repeat)
  WITH order_typed AS (
    SELECT o.order_id, o.customer_name, o.shipped_time, o.sales_channel,
      o.customer_identifier, o.line_revenue, f.first_order_date,
      CASE
        WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
          CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
        WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_type
    FROM v_order_with_identity o
    JOIN summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  )
  SELECT customer_identifier, min(customer_name), min(sales_channel),
    count(DISTINCT order_id), sum(line_revenue),
    sum(line_revenue) / NULLIF(count(DISTINCT order_id), 0)::numeric,
    min(date(shipped_time)), max(date(shipped_time)),
    bool_or(resolved_type = 'ro')
  FROM order_typed GROUP BY customer_identifier;

  -- Backfill monthly cohort (global)
  INSERT INTO summary_monthly_cohort
    (cohort_month, months_since_first, active_customers, orders, revenue)
  WITH ccm AS (
    SELECT customer_identifier,
      to_char(first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month
    FROM summary_customer_first_order
  ), ma AS (
    SELECT o.customer_identifier,
      to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM') AS activity_month
    FROM v_order_with_identity o
    GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM')
  )
  SELECT ccm.cohort_month,
    (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
    (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int),
    count(DISTINCT ma.customer_identifier),
    count(DISTINCT ma.customer_identifier),
    0
  FROM ccm JOIN ma ON ccm.customer_identifier = ma.customer_identifier
  GROUP BY ccm.cohort_month,
    (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
    (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int);

  -- Backfill per-channel monthly cohort
  INSERT INTO summary_monthly_cohort_channel
    (channel_group, cohort_month, months_since_first, active_customers, orders, revenue)
  WITH ccm AS (
    SELECT f.customer_identifier,
      to_char(f.first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month,
      get_channel_group(sc.first_channel) AS channel_group
    FROM summary_customer_first_order f
    JOIN summary_customer_cohort sc ON sc.customer_phone = f.customer_identifier
    WHERE get_channel_group(sc.first_channel) IS NOT NULL
  ), ma AS (
    SELECT o.customer_identifier,
      to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM') AS activity_month
    FROM v_order_with_identity o
    GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM')
  )
  SELECT ccm.channel_group, ccm.cohort_month,
    (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
    (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int),
    count(DISTINCT ma.customer_identifier),
    count(DISTINCT ma.customer_identifier),
    0
  FROM ccm JOIN ma ON ccm.customer_identifier = ma.customer_identifier
  GROUP BY ccm.channel_group, ccm.cohort_month,
    (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
    (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int);

  -- Re-enable triggers
  ALTER TABLE scalev_order_lines ENABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend ENABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates ENABLE TRIGGER trg_commission_rate_summaries;
END;
$$;

-- ── 7. Initial backfill (runs once during migration) ──
INSERT INTO summary_monthly_cohort_channel
  (channel_group, cohort_month, months_since_first, active_customers, orders, revenue)
WITH ccm AS (
  SELECT f.customer_identifier,
    to_char(f.first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month,
    get_channel_group(sc.first_channel) AS channel_group
  FROM summary_customer_first_order f
  JOIN summary_customer_cohort sc ON sc.customer_phone = f.customer_identifier
  WHERE get_channel_group(sc.first_channel) IS NOT NULL
), ma AS (
  SELECT o.customer_identifier,
    to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM') AS activity_month
  FROM v_order_with_identity o
  GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM')
)
SELECT ccm.channel_group, ccm.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
  (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int),
  count(DISTINCT ma.customer_identifier),
  count(DISTINCT ma.customer_identifier),
  0
FROM ccm JOIN ma ON ccm.customer_identifier = ma.customer_identifier
GROUP BY ccm.channel_group, ccm.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
  (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int)
ON CONFLICT (channel_group, cohort_month, months_since_first) DO NOTHING;

COMMIT;
