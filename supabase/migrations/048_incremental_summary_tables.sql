-- ============================================================================
-- Migration 048: Incremental Summary Tables + Trigger Functions + Backfill
-- ============================================================================
-- Replaces materialized views (full-table-scan refresh) with regular tables
-- that are incrementally updated via PostgreSQL triggers on INSERT/UPDATE/DELETE.
--
-- Benefits:
--   - No more REFRESH MATERIALIZED VIEW (was scanning 340K+ rows)
--   - Summary tables always up-to-date (updated in same transaction as base data)
--   - Dramatically reduces Disk IO on Supabase Nano instance
--
-- Strategy:
--   1. Create summary tables (same schema as MVs)
--   2. Create trigger functions (but NOT triggers yet — migration 049)
--   3. Backfill from existing base data
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: CREATE SUMMARY TABLES
-- ════════════════════════════════════════════════════════════════════════════

-- Summary 1: Daily order data per channel (replaces mv_daily_order_channel)
CREATE TABLE IF NOT EXISTS summary_daily_order_channel (
  date DATE NOT NULL,
  product TEXT NOT NULL,
  channel TEXT NOT NULL,
  gross_sales NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  net_sales NUMERIC DEFAULT 0,
  cogs NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, product, channel)
);

-- Summary 2: Daily ads spend per brand (replaces mv_daily_ads_by_brand)
CREATE TABLE IF NOT EXISTS summary_daily_ads_by_brand (
  date DATE NOT NULL,
  product TEXT NOT NULL,
  total_ads_spend NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, product)
);

-- Summary 3: Daily channel complete (replaces mv_daily_channel_complete)
CREATE TABLE IF NOT EXISTS summary_daily_channel_complete (
  date DATE NOT NULL,
  product TEXT NOT NULL,
  channel TEXT NOT NULL,
  gross_sales NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  net_sales NUMERIC DEFAULT 0,
  cogs NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  mp_admin_cost NUMERIC DEFAULT 0,
  mkt_cost NUMERIC DEFAULT 0,
  net_after_mkt NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, product, channel)
);

-- Summary 4: Daily product complete (replaces mv_daily_product_complete)
CREATE TABLE IF NOT EXISTS summary_daily_product_complete (
  date DATE NOT NULL,
  product TEXT NOT NULL,
  net_sales NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  mkt_cost NUMERIC DEFAULT 0,
  mp_admin_cost NUMERIC DEFAULT 0,
  net_after_mkt NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, product)
);

-- Summary 5: Customer first order (replaces mv_customer_first_order)
CREATE TABLE IF NOT EXISTS summary_customer_first_order (
  customer_identifier TEXT PRIMARY KEY,
  first_order_date DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scfo_date ON summary_customer_first_order(first_order_date);

-- Summary 6: Daily customer type (replaces mv_daily_customer_type)
CREATE TABLE IF NOT EXISTS summary_daily_customer_type (
  date DATE NOT NULL,
  customer_type TEXT NOT NULL,
  sales_channel TEXT NOT NULL,
  order_count BIGINT DEFAULT 0,
  customer_count BIGINT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  cogs NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, customer_type, sales_channel)
);
CREATE INDEX IF NOT EXISTS idx_sdct_date ON summary_daily_customer_type(date);

-- Summary 7: Customer cohort (replaces mv_customer_cohort)
CREATE TABLE IF NOT EXISTS summary_customer_cohort (
  customer_phone TEXT PRIMARY KEY,  -- actually customer_identifier (kept for backward compat)
  first_name TEXT,
  first_channel TEXT,
  total_orders BIGINT DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  avg_order_value NUMERIC DEFAULT 0,
  first_order_date DATE,
  last_order_date DATE,
  is_repeat BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scc_last_order ON summary_customer_cohort(last_order_date);
CREATE INDEX IF NOT EXISTS idx_scc_revenue ON summary_customer_cohort(total_revenue DESC);

-- Summary 8: Monthly cohort (replaces mv_monthly_cohort)
CREATE TABLE IF NOT EXISTS summary_monthly_cohort (
  cohort_month TEXT NOT NULL,
  months_since_first BIGINT NOT NULL,
  active_customers BIGINT DEFAULT 0,
  orders BIGINT DEFAULT 0,
  revenue NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cohort_month, months_since_first)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: HELPER FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════════

-- Helper: get commission rate for a channel on a given date
CREATE OR REPLACE FUNCTION get_commission_rate(p_channel TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT rate FROM marketplace_commission_rates
  WHERE channel = p_channel AND effective_from <= p_date
  ORDER BY effective_from DESC LIMIT 1;
$$;

-- Helper: recompute summary_daily_channel_complete for a specific (date, product, channel)
CREATE OR REPLACE FUNCTION fn_recompute_channel_complete(p_date DATE, p_product TEXT, p_channel TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_row summary_daily_order_channel%ROWTYPE;
  v_rate NUMERIC;
  v_mp_admin NUMERIC;
BEGIN
  SELECT * INTO v_row FROM summary_daily_order_channel
  WHERE date = p_date AND product = p_product AND channel = p_channel;

  IF NOT FOUND THEN
    DELETE FROM summary_daily_channel_complete
    WHERE date = p_date AND product = p_product AND channel = p_channel;
    RETURN;
  END IF;

  v_rate := COALESCE(get_commission_rate(p_channel, p_date), 0);
  v_mp_admin := ROUND(v_row.net_sales * v_rate);

  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit,
     mp_admin_cost, mkt_cost, net_after_mkt, updated_at)
  VALUES
    (p_date, p_product, p_channel,
     ROUND(v_row.gross_sales), ROUND(v_row.discount), ROUND(v_row.net_sales),
     ROUND(v_row.cogs), ROUND(v_row.gross_profit),
     v_mp_admin, v_mp_admin,
     ROUND(v_row.gross_profit) - v_mp_admin,
     NOW())
  ON CONFLICT (date, product, channel) DO UPDATE SET
    gross_sales = EXCLUDED.gross_sales,
    discount = EXCLUDED.discount,
    net_sales = EXCLUDED.net_sales,
    cogs = EXCLUDED.cogs,
    gross_profit = EXCLUDED.gross_profit,
    mp_admin_cost = EXCLUDED.mp_admin_cost,
    mkt_cost = EXCLUDED.mkt_cost,
    net_after_mkt = EXCLUDED.net_after_mkt,
    updated_at = NOW();
END;
$$;

-- Helper: recompute summary_daily_product_complete for a specific (date, product)
CREATE OR REPLACE FUNCTION fn_recompute_product_complete(p_date DATE, p_product TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_net_sales NUMERIC;
  v_gross_profit NUMERIC;
  v_mp_admin NUMERIC;
  v_ads_spend NUMERIC;
  v_mkt_cost NUMERIC;
BEGIN
  SELECT COALESCE(SUM(net_sales), 0), COALESCE(SUM(gross_profit), 0), COALESCE(SUM(mp_admin_cost), 0)
  INTO v_net_sales, v_gross_profit, v_mp_admin
  FROM summary_daily_channel_complete
  WHERE date = p_date AND product = p_product;

  SELECT COALESCE(total_ads_spend, 0) INTO v_ads_spend
  FROM summary_daily_ads_by_brand
  WHERE date = p_date AND product = p_product;
  IF NOT FOUND THEN v_ads_spend := 0; END IF;

  v_mkt_cost := v_mp_admin + v_ads_spend;

  IF v_net_sales = 0 AND v_gross_profit = 0 AND v_mp_admin = 0 AND v_ads_spend = 0 THEN
    DELETE FROM summary_daily_product_complete
    WHERE date = p_date AND product = p_product;
    RETURN;
  END IF;

  INSERT INTO summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt, updated_at)
  VALUES
    (p_date, p_product, v_net_sales, v_gross_profit, v_mkt_cost, v_mp_admin,
     v_gross_profit - v_mkt_cost, NOW())
  ON CONFLICT (date, product) DO UPDATE SET
    net_sales = EXCLUDED.net_sales,
    gross_profit = EXCLUDED.gross_profit,
    mkt_cost = EXCLUDED.mkt_cost,
    mp_admin_cost = EXCLUDED.mp_admin_cost,
    net_after_mkt = EXCLUDED.net_after_mkt,
    updated_at = NOW();
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 3: TRIGGER FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════════

-- ── Trigger Function A: on scalev_order_lines INSERT/UPDATE/DELETE ──
-- Updates summary_daily_order_channel, cascades to channel_complete and product_complete
CREATE OR REPLACE FUNCTION fn_update_order_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order scalev_orders%ROWTYPE;
  v_date DATE;
  v_product TEXT;
  v_channel TEXT;
  v_old_date DATE;
  v_old_product TEXT;
  v_old_channel TEXT;
  v_old_order scalev_orders%ROWTYPE;
BEGIN
  -- ── Handle DELETE: subtract old values ──
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_order FROM scalev_orders WHERE id = OLD.scalev_order_id;
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND OLD.product_type IS NOT NULL
       AND OLD.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time);
      v_product := OLD.product_type;
      v_channel := OLD.sales_channel;

      UPDATE summary_daily_order_channel SET
        gross_sales = gross_sales - COALESCE(OLD.product_price_bt, 0),
        discount = discount - COALESCE(OLD.discount_bt, 0),
        net_sales = net_sales - (COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0)),
        cogs = cogs - COALESCE(OLD.cogs_bt, 0),
        gross_profit = gross_profit - (COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0) - COALESCE(OLD.cogs_bt, 0)),
        updated_at = NOW()
      WHERE date = v_date AND product = v_product AND channel = v_channel;

      -- Clean up zero rows
      DELETE FROM summary_daily_order_channel
      WHERE date = v_date AND product = v_product AND channel = v_channel
        AND gross_sales = 0 AND net_sales = 0 AND cogs = 0;

      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    END IF;
    RETURN OLD;
  END IF;

  -- ── Handle INSERT: add new values ──
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_order FROM scalev_orders WHERE id = NEW.scalev_order_id;
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND NEW.product_type IS NOT NULL
       AND NEW.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time);
      v_product := NEW.product_type;
      v_channel := NEW.sales_channel;

      INSERT INTO summary_daily_order_channel
        (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, updated_at)
      VALUES
        (v_date, v_product, v_channel,
         COALESCE(NEW.product_price_bt, 0),
         COALESCE(NEW.discount_bt, 0),
         COALESCE(NEW.product_price_bt, 0) - COALESCE(NEW.discount_bt, 0),
         COALESCE(NEW.cogs_bt, 0),
         COALESCE(NEW.product_price_bt, 0) - COALESCE(NEW.discount_bt, 0) - COALESCE(NEW.cogs_bt, 0),
         NOW())
      ON CONFLICT (date, product, channel) DO UPDATE SET
        gross_sales = summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
        discount = summary_daily_order_channel.discount + EXCLUDED.discount,
        net_sales = summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
        cogs = summary_daily_order_channel.cogs + EXCLUDED.cogs,
        gross_profit = summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
        updated_at = NOW();

      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    END IF;
    RETURN NEW;
  END IF;

  -- ── Handle UPDATE: subtract old, add new ──
  IF TG_OP = 'UPDATE' THEN
    -- Subtract OLD values if order was qualifying
    SELECT * INTO v_old_order FROM scalev_orders WHERE id = OLD.scalev_order_id;
    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.shipped_time IS NOT NULL
       AND OLD.product_type IS NOT NULL
       AND OLD.product_type != 'Unknown' THEN

      v_old_date := DATE(v_old_order.shipped_time);
      v_old_product := OLD.product_type;
      v_old_channel := OLD.sales_channel;

      UPDATE summary_daily_order_channel SET
        gross_sales = gross_sales - COALESCE(OLD.product_price_bt, 0),
        discount = discount - COALESCE(OLD.discount_bt, 0),
        net_sales = net_sales - (COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0)),
        cogs = cogs - COALESCE(OLD.cogs_bt, 0),
        gross_profit = gross_profit - (COALESCE(OLD.product_price_bt, 0) - COALESCE(OLD.discount_bt, 0) - COALESCE(OLD.cogs_bt, 0)),
        updated_at = NOW()
      WHERE date = v_old_date AND product = v_old_product AND channel = v_old_channel;

      DELETE FROM summary_daily_order_channel
      WHERE date = v_old_date AND product = v_old_product AND channel = v_old_channel
        AND gross_sales = 0 AND net_sales = 0 AND cogs = 0;
    END IF;

    -- Add NEW values if order is qualifying
    SELECT * INTO v_order FROM scalev_orders WHERE id = NEW.scalev_order_id;
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND NEW.product_type IS NOT NULL
       AND NEW.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time);
      v_product := NEW.product_type;
      v_channel := NEW.sales_channel;

      INSERT INTO summary_daily_order_channel
        (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, updated_at)
      VALUES
        (v_date, v_product, v_channel,
         COALESCE(NEW.product_price_bt, 0),
         COALESCE(NEW.discount_bt, 0),
         COALESCE(NEW.product_price_bt, 0) - COALESCE(NEW.discount_bt, 0),
         COALESCE(NEW.cogs_bt, 0),
         COALESCE(NEW.product_price_bt, 0) - COALESCE(NEW.discount_bt, 0) - COALESCE(NEW.cogs_bt, 0),
         NOW())
      ON CONFLICT (date, product, channel) DO UPDATE SET
        gross_sales = summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
        discount = summary_daily_order_channel.discount + EXCLUDED.discount,
        net_sales = summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
        cogs = summary_daily_order_channel.cogs + EXCLUDED.cogs,
        gross_profit = summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
        updated_at = NOW();
    END IF;

    -- Cascade for both old and new if they changed
    IF v_old_date IS NOT NULL THEN
      PERFORM fn_recompute_channel_complete(v_old_date, v_old_product, v_old_channel);
      PERFORM fn_recompute_product_complete(v_old_date, v_old_product);
    END IF;
    IF v_date IS NOT NULL AND (v_date != v_old_date OR v_product != v_old_product OR v_channel != v_old_channel) THEN
      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    ELSIF v_date IS NOT NULL AND v_old_date IS NULL THEN
      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- ── Trigger Function B: on scalev_orders UPDATE of status/shipped_time ──
-- When an order transitions to/from shipped/completed, add/remove all its lines
CREATE OR REPLACE FUNCTION fn_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_old_date DATE;
  v_new_date DATE;
  v_line RECORD;
  v_channel TEXT;
  v_affected_keys TEXT[][];
  v_key TEXT[];
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed') AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed') AND NEW.shipped_time IS NOT NULL;

  -- No change in qualification
  IF v_old_qualifying = v_new_qualifying AND OLD.shipped_time = NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  v_old_date := DATE(OLD.shipped_time);
  v_new_date := DATE(NEW.shipped_time);

  -- Subtract all lines if order was qualifying
  IF v_old_qualifying THEN
    FOR v_line IN
      SELECT * FROM scalev_order_lines WHERE scalev_order_id = OLD.id
        AND product_type IS NOT NULL AND product_type != 'Unknown'
    LOOP
      v_channel := v_line.sales_channel;

      UPDATE summary_daily_order_channel SET
        gross_sales = gross_sales - COALESCE(v_line.product_price_bt, 0),
        discount = discount - COALESCE(v_line.discount_bt, 0),
        net_sales = net_sales - (COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0)),
        cogs = cogs - COALESCE(v_line.cogs_bt, 0),
        gross_profit = gross_profit - (COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0) - COALESCE(v_line.cogs_bt, 0)),
        updated_at = NOW()
      WHERE date = v_old_date AND product = v_line.product_type AND channel = v_channel;

      DELETE FROM summary_daily_order_channel
      WHERE date = v_old_date AND product = v_line.product_type AND channel = v_channel
        AND gross_sales = 0 AND net_sales = 0 AND cogs = 0;

      PERFORM fn_recompute_channel_complete(v_old_date, v_line.product_type, v_channel);
      PERFORM fn_recompute_product_complete(v_old_date, v_line.product_type);
    END LOOP;
  END IF;

  -- Add all lines if order is now qualifying
  IF v_new_qualifying THEN
    FOR v_line IN
      SELECT * FROM scalev_order_lines WHERE scalev_order_id = NEW.id
        AND product_type IS NOT NULL AND product_type != 'Unknown'
    LOOP
      v_channel := v_line.sales_channel;

      INSERT INTO summary_daily_order_channel
        (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, updated_at)
      VALUES
        (v_new_date, v_line.product_type, v_channel,
         COALESCE(v_line.product_price_bt, 0),
         COALESCE(v_line.discount_bt, 0),
         COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0),
         COALESCE(v_line.cogs_bt, 0),
         COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0) - COALESCE(v_line.cogs_bt, 0),
         NOW())
      ON CONFLICT (date, product, channel) DO UPDATE SET
        gross_sales = summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
        discount = summary_daily_order_channel.discount + EXCLUDED.discount,
        net_sales = summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
        cogs = summary_daily_order_channel.cogs + EXCLUDED.cogs,
        gross_profit = summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
        updated_at = NOW();

      PERFORM fn_recompute_channel_complete(v_new_date, v_line.product_type, v_channel);
      PERFORM fn_recompute_product_complete(v_new_date, v_line.product_type);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger Function C: on daily_ads_spend INSERT/UPDATE/DELETE ──
-- Updates summary_daily_ads_by_brand, cascades to product_complete
CREATE OR REPLACE FUNCTION fn_update_ads_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_brand TEXT;
  v_old_brand TEXT;
BEGIN
  -- ── DELETE ──
  IF TG_OP = 'DELETE' THEN
    IF OLD.spent > 0 THEN
      SELECT m.brand INTO v_old_brand FROM ads_store_brand_mapping m
      WHERE LOWER(OLD.store) = LOWER(m.store_pattern) LIMIT 1;

      IF v_old_brand IS NOT NULL THEN
        UPDATE summary_daily_ads_by_brand SET
          total_ads_spend = total_ads_spend - OLD.spent,
          updated_at = NOW()
        WHERE date = OLD.date AND product = v_old_brand;

        DELETE FROM summary_daily_ads_by_brand
        WHERE date = OLD.date AND product = v_old_brand AND total_ads_spend <= 0;

        PERFORM fn_recompute_product_complete(OLD.date, v_old_brand);
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- ── INSERT ──
  IF TG_OP = 'INSERT' THEN
    IF NEW.spent > 0 THEN
      SELECT m.brand INTO v_brand FROM ads_store_brand_mapping m
      WHERE LOWER(NEW.store) = LOWER(m.store_pattern) LIMIT 1;

      IF v_brand IS NOT NULL THEN
        INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend, updated_at)
        VALUES (NEW.date, v_brand, NEW.spent, NOW())
        ON CONFLICT (date, product) DO UPDATE SET
          total_ads_spend = summary_daily_ads_by_brand.total_ads_spend + EXCLUDED.total_ads_spend,
          updated_at = NOW();

        PERFORM fn_recompute_product_complete(NEW.date, v_brand);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE ──
  IF TG_OP = 'UPDATE' THEN
    -- Subtract old
    IF OLD.spent > 0 THEN
      SELECT m.brand INTO v_old_brand FROM ads_store_brand_mapping m
      WHERE LOWER(OLD.store) = LOWER(m.store_pattern) LIMIT 1;

      IF v_old_brand IS NOT NULL THEN
        UPDATE summary_daily_ads_by_brand SET
          total_ads_spend = total_ads_spend - OLD.spent,
          updated_at = NOW()
        WHERE date = OLD.date AND product = v_old_brand;

        DELETE FROM summary_daily_ads_by_brand
        WHERE date = OLD.date AND product = v_old_brand AND total_ads_spend <= 0;
      END IF;
    END IF;

    -- Add new
    IF NEW.spent > 0 THEN
      SELECT m.brand INTO v_brand FROM ads_store_brand_mapping m
      WHERE LOWER(NEW.store) = LOWER(m.store_pattern) LIMIT 1;

      IF v_brand IS NOT NULL THEN
        INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend, updated_at)
        VALUES (NEW.date, v_brand, NEW.spent, NOW())
        ON CONFLICT (date, product) DO UPDATE SET
          total_ads_spend = summary_daily_ads_by_brand.total_ads_spend + EXCLUDED.total_ads_spend,
          updated_at = NOW();
      END IF;
    END IF;

    -- Cascade
    IF v_old_brand IS NOT NULL THEN
      PERFORM fn_recompute_product_complete(OLD.date, v_old_brand);
    END IF;
    IF v_brand IS NOT NULL AND (v_brand != v_old_brand OR NEW.date != OLD.date) THEN
      PERFORM fn_recompute_product_complete(NEW.date, v_brand);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- ── Trigger Function D: on scalev_orders for customer summaries ──
-- Updates summary_customer_first_order, summary_daily_customer_type,
-- summary_customer_cohort, summary_monthly_cohort
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

    -- Subtract from daily customer type (aggregate, can't just decrement counts accurately)
    -- We'll recompute this from base data for the affected bucket
    -- For order_count and revenue we can decrement
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
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger Function E: on marketplace_commission_rates INSERT/UPDATE/DELETE ──
-- Recomputes channel_complete and product_complete for affected channel
CREATE OR REPLACE FUNCTION fn_commission_rate_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_channel TEXT;
  v_row RECORD;
BEGIN
  v_channel := COALESCE(NEW.channel, OLD.channel);

  -- Recompute all channel_complete rows for this channel
  FOR v_row IN
    SELECT DISTINCT date, product FROM summary_daily_order_channel
    WHERE channel = v_channel
  LOOP
    PERFORM fn_recompute_channel_complete(v_row.date, v_row.product, v_channel);
    PERFORM fn_recompute_product_complete(v_row.date, v_row.product);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 4: BACKFILL FROM EXISTING DATA
-- ════════════════════════════════════════════════════════════════════════════

-- Backfill summary_daily_order_channel (from MV1 logic)
INSERT INTO summary_daily_order_channel (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
SELECT
  DATE(o.shipped_time) AS date,
  l.product_type AS product,
  l.sales_channel AS channel,
  SUM(l.product_price_bt) AS gross_sales,
  SUM(l.discount_bt) AS discount,
  SUM(l.product_price_bt - l.discount_bt) AS net_sales,
  SUM(l.cogs_bt) AS cogs,
  SUM(l.product_price_bt - l.discount_bt - l.cogs_bt) AS gross_profit
FROM scalev_order_lines l
JOIN scalev_orders o ON l.scalev_order_id = o.id
WHERE o.status IN ('shipped', 'completed')
  AND o.shipped_time IS NOT NULL
  AND l.product_type IS NOT NULL
  AND l.product_type != 'Unknown'
GROUP BY DATE(o.shipped_time), l.product_type, l.sales_channel
ON CONFLICT (date, product, channel) DO NOTHING;

-- Backfill summary_daily_ads_by_brand (from MV2 logic)
INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend)
SELECT a.date, m.brand, SUM(a.spent)
FROM daily_ads_spend a
JOIN ads_store_brand_mapping m ON LOWER(a.store) = LOWER(m.store_pattern)
WHERE a.spent > 0
GROUP BY a.date, m.brand
ON CONFLICT (date, product) DO NOTHING;

-- Backfill summary_daily_channel_complete (from MV3 logic)
INSERT INTO summary_daily_channel_complete
  (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit,
   mp_admin_cost, mkt_cost, net_after_mkt)
SELECT
  oc.date, oc.product, oc.channel,
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
    WHERE cr2.channel = oc.channel
      AND cr2.effective_from <= oc.date
  )
ON CONFLICT (date, product, channel) DO NOTHING;

-- Backfill summary_daily_product_complete (from MV4 logic)
INSERT INTO summary_daily_product_complete
  (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
SELECT
  cc.date, cc.product,
  SUM(cc.net_sales),
  SUM(cc.gross_profit),
  SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0),
  SUM(cc.mp_admin_cost),
  SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0))
FROM summary_daily_channel_complete cc
LEFT JOIN summary_daily_ads_by_brand ads
  ON ads.date = cc.date AND ads.product = cc.product
GROUP BY cc.date, cc.product, ads.total_ads_spend
ON CONFLICT (date, product) DO NOTHING;

-- Backfill summary_customer_first_order (from MV5 logic)
INSERT INTO summary_customer_first_order (customer_identifier, first_order_date)
SELECT customer_identifier, MIN(DATE(shipped_time))
FROM scalev_orders
WHERE shipped_time IS NOT NULL
  AND status IN ('shipped', 'completed')
  AND customer_identifier IS NOT NULL
GROUP BY customer_identifier
ON CONFLICT (customer_identifier) DO NOTHING;

-- Backfill summary_daily_customer_type (from MV6 logic)
INSERT INTO summary_daily_customer_type
  (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs)
SELECT date(o.shipped_time) AS date,
  CASE
    WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
      CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END AS customer_type,
  o.sales_channel,
  count(DISTINCT o.order_id),
  count(DISTINCT o.customer_identifier),
  sum(o.line_revenue),
  sum(o.line_cogs)
FROM v_order_with_identity o
LEFT JOIN summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
GROUP BY date(o.shipped_time),
  CASE
    WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
    WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
      CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
    WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
    ELSE 'ro'
  END,
  o.sales_channel
ON CONFLICT (date, customer_type, sales_channel) DO NOTHING;

-- Backfill summary_customer_cohort (from MV7 logic)
INSERT INTO summary_customer_cohort
  (customer_phone, first_name, first_channel, total_orders, total_revenue,
   avg_order_value, first_order_date, last_order_date, is_repeat)
WITH order_typed AS (
  SELECT o.order_id, o.customer_name, o.customer_phone,
    o.csv_customer_type, o.shipped_time, o.sales_channel,
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
SELECT customer_identifier,
  min(customer_name),
  min(sales_channel),
  count(DISTINCT order_id),
  sum(line_revenue),
  sum(line_revenue) / NULLIF(count(DISTINCT order_id), 0)::numeric,
  min(date(shipped_time)),
  max(date(shipped_time)),
  bool_or(resolved_type = 'ro')
FROM order_typed
GROUP BY customer_identifier
ON CONFLICT (customer_phone) DO NOTHING;

-- Backfill summary_monthly_cohort (from MV8 logic)
INSERT INTO summary_monthly_cohort
  (cohort_month, months_since_first, active_customers, orders, revenue)
WITH customer_cohort_month AS (
  SELECT customer_identifier,
    to_char(first_order_date::timestamp with time zone, 'YYYY-MM') AS cohort_month
  FROM summary_customer_first_order
), monthly_activity AS (
  SELECT o.customer_identifier,
    to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM') AS activity_month
  FROM v_order_with_identity o
  GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp with time zone, 'YYYY-MM')
)
SELECT cc.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
  (EXTRACT(year FROM to_date(cc.cohort_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(cc.cohort_month, 'YYYY-MM'))::int),
  count(DISTINCT ma.customer_identifier),
  count(DISTINCT ma.customer_identifier),
  0
FROM customer_cohort_month cc
JOIN monthly_activity ma ON cc.customer_identifier = ma.customer_identifier
GROUP BY cc.cohort_month,
  (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
  (EXTRACT(year FROM to_date(cc.cohort_month, 'YYYY-MM'))::int * 12 +
   EXTRACT(month FROM to_date(cc.cohort_month, 'YYYY-MM'))::int)
ON CONFLICT (cohort_month, months_since_first) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 5: FORCE-RECALCULATE FUNCTION
-- ════════════════════════════════════════════════════════════════════════════
-- Safety valve: truncate all summary tables and re-run backfill
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
           summary_monthly_cohort;

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

  -- Backfill ads
  INSERT INTO summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT a.date, m.brand, SUM(a.spent)
  FROM daily_ads_spend a
  JOIN ads_store_brand_mapping m ON LOWER(a.store) = LOWER(m.store_pattern)
  WHERE a.spent > 0
  GROUP BY a.date, m.brand;

  -- Backfill channel complete
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
    );

  -- Backfill product complete
  INSERT INTO summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT cc.date, cc.product,
    SUM(cc.net_sales), SUM(cc.gross_profit),
    SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0),
    SUM(cc.mp_admin_cost),
    SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0))
  FROM summary_daily_channel_complete cc
  LEFT JOIN summary_daily_ads_by_brand ads ON ads.date = cc.date AND ads.product = cc.product
  GROUP BY cc.date, cc.product, ads.total_ads_spend;

  -- Backfill customer first order
  INSERT INTO summary_customer_first_order (customer_identifier, first_order_date)
  SELECT customer_identifier, MIN(DATE(shipped_time))
  FROM scalev_orders
  WHERE shipped_time IS NOT NULL AND status IN ('shipped', 'completed') AND customer_identifier IS NOT NULL
  GROUP BY customer_identifier;

  -- Backfill daily customer type
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
  GROUP BY date(o.shipped_time),
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

  -- Backfill monthly cohort
  INSERT INTO summary_monthly_cohort (cohort_month, months_since_first, active_customers, orders, revenue)
  WITH ccm AS (
    SELECT customer_identifier, to_char(first_order_date::timestamp, 'YYYY-MM') AS cohort_month
    FROM summary_customer_first_order
  ), ma AS (
    SELECT o.customer_identifier, to_char(date(o.shipped_time)::timestamp, 'YYYY-MM') AS activity_month
    FROM v_order_with_identity o
    GROUP BY o.customer_identifier, to_char(date(o.shipped_time)::timestamp, 'YYYY-MM')
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

  -- Re-enable triggers
  ALTER TABLE scalev_order_lines ENABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend ENABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates ENABLE TRIGGER trg_commission_rate_summaries;
END;
$$;

-- Grant RLS bypass for summary tables (service role writes via triggers)
ALTER TABLE summary_daily_order_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_daily_ads_by_brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_daily_channel_complete ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_daily_product_complete ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_customer_first_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_daily_customer_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_customer_cohort ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_monthly_cohort ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read summary tables
CREATE POLICY "Allow read for authenticated" ON summary_daily_order_channel FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_daily_ads_by_brand FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_daily_channel_complete FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_daily_product_complete FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_customer_first_order FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_daily_customer_type FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_customer_cohort FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow read for authenticated" ON summary_monthly_cohort FOR SELECT TO authenticated USING (true);

COMMIT;
