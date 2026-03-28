-- ============================================================
-- Migration 061: Fix timezone in fn_update_order_summaries
--
-- Bug: DATE(shipped_time) uses UTC in the trigger function,
-- causing orders shipped at midnight WIB to be bucketed into
-- the wrong date in summary_daily_order_channel.
--
-- Fix: Use DATE(shipped_time AT TIME ZONE 'Asia/Jakarta').
-- Then backfill: delete wrong UTC date rows, recompute correct.
-- ============================================================

-- ── Fix trigger function ──
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
  -- ── Handle DELETE ──
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_order FROM scalev_orders WHERE id = OLD.scalev_order_id;
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND OLD.product_type IS NOT NULL
       AND OLD.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
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

      DELETE FROM summary_daily_order_channel
      WHERE date = v_date AND product = v_product AND channel = v_channel
        AND gross_sales = 0 AND net_sales = 0 AND cogs = 0;

      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    END IF;
    RETURN OLD;
  END IF;

  -- ── Handle INSERT ──
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_order FROM scalev_orders WHERE id = NEW.scalev_order_id;
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND NEW.product_type IS NOT NULL
       AND NEW.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
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

  -- ── Handle UPDATE ──
  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_old_order FROM scalev_orders WHERE id = OLD.scalev_order_id;
    SELECT * INTO v_order FROM scalev_orders WHERE id = NEW.scalev_order_id;

    -- Subtract old values
    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.shipped_time IS NOT NULL
       AND OLD.product_type IS NOT NULL
       AND OLD.product_type != 'Unknown' THEN

      v_old_date := DATE(v_old_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
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

    -- Add new values
    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL
       AND NEW.product_type IS NOT NULL
       AND NEW.product_type != 'Unknown' THEN

      v_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
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

    -- Cascade recompute for all affected dates/products
    IF v_old_date IS NOT NULL THEN
      PERFORM fn_recompute_channel_complete(v_old_date, v_old_product, v_old_channel);
      PERFORM fn_recompute_product_complete(v_old_date, v_old_product);
    END IF;
    IF v_date IS NOT NULL AND (v_date != v_old_date OR v_product != v_old_product OR v_channel != v_old_channel) THEN
      PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
      PERFORM fn_recompute_product_complete(v_date, v_product);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- ── Also fix fn_update_order_status_summaries (Trigger B: on scalev_orders UPDATE) ──
-- This trigger fires when order status changes to shipped/completed
-- Check if it also uses DATE(shipped_time)
CREATE OR REPLACE FUNCTION fn_update_order_status_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
  v_product TEXT;
  v_channel TEXT;
BEGIN
  -- Only care about transitions TO shipped/completed
  IF NEW.status NOT IN ('shipped', 'completed') THEN RETURN NEW; END IF;
  IF OLD.status IN ('shipped', 'completed') THEN RETURN NEW; END IF;
  IF NEW.shipped_time IS NULL THEN RETURN NEW; END IF;

  v_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');

  -- Insert all lines for this order into summaries
  INSERT INTO summary_daily_order_channel
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, updated_at)
  SELECT
    v_date,
    l.product_type,
    l.sales_channel,
    COALESCE(l.product_price_bt, 0),
    COALESCE(l.discount_bt, 0),
    COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0),
    COALESCE(l.cogs_bt, 0),
    COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0) - COALESCE(l.cogs_bt, 0),
    NOW()
  FROM scalev_order_lines l
  WHERE l.scalev_order_id = NEW.id
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
  ON CONFLICT (date, product, channel) DO UPDATE SET
    gross_sales = summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
    discount = summary_daily_order_channel.discount + EXCLUDED.discount,
    net_sales = summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
    cogs = summary_daily_order_channel.cogs + EXCLUDED.cogs,
    gross_profit = summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
    updated_at = NOW();

  -- Cascade recompute for all affected date/product/channel combos
  FOR v_product, v_channel IN
    SELECT DISTINCT l.product_type, l.sales_channel
    FROM scalev_order_lines l
    WHERE l.scalev_order_id = NEW.id
      AND l.product_type IS NOT NULL AND l.product_type != 'Unknown'
  LOOP
    PERFORM fn_recompute_channel_complete(v_date, v_product, v_channel);
    PERFORM fn_recompute_product_complete(v_date, v_product);
  END LOOP;

  RETURN NEW;
END;
$$;

-- ── Backfill: fix existing wrong-date rows in summary_daily_order_channel ──
-- Strategy: full recompute of order_channel + downstream tables
-- (avoids complex row-by-row correction)
DO $$
BEGIN
  -- Disable triggers temporarily
  ALTER TABLE scalev_order_lines DISABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders DISABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders DISABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend DISABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates DISABLE TRIGGER trg_commission_rate_summaries;

  -- Recompute order_channel with correct WIB timezone
  TRUNCATE summary_daily_order_channel;
  INSERT INTO summary_daily_order_channel
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
  SELECT
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    l.product_type,
    l.sales_channel,
    SUM(l.product_price_bt),
    SUM(l.discount_bt),
    SUM(l.product_price_bt - l.discount_bt),
    SUM(l.cogs_bt),
    SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)
  FROM scalev_order_lines l
  JOIN scalev_orders o ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
  GROUP BY DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'), l.product_type, l.sales_channel;

  -- Recompute channel_complete
  TRUNCATE summary_daily_channel_complete;
  INSERT INTO summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT oc.date, oc.product, oc.channel,
    oc.gross_sales, oc.discount, oc.net_sales, oc.cogs, oc.gross_profit,
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    ROUND(oc.net_sales * COALESCE(cr.rate, 0)),
    oc.gross_profit - ROUND(oc.net_sales * COALESCE(cr.rate, 0))
  FROM summary_daily_order_channel oc
  LEFT JOIN marketplace_commission_rates cr
    ON cr.channel = oc.channel
    AND cr.effective_from = (
      SELECT MAX(cr2.effective_from) FROM marketplace_commission_rates cr2
      WHERE cr2.channel = oc.channel AND cr2.effective_from <= oc.date
    );

  -- Recompute product_complete (FULL OUTER JOIN to keep ads-only dates)
  TRUNCATE summary_daily_product_complete;
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

  -- Re-enable triggers
  ALTER TABLE scalev_order_lines ENABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE scalev_orders ENABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE daily_ads_spend ENABLE TRIGGER trg_ads_summaries;
  ALTER TABLE marketplace_commission_rates ENABLE TRIGGER trg_commission_rate_summaries;
END;
$$;
