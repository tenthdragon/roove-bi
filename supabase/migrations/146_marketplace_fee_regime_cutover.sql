-- ============================================================================
-- Migration 146: Marketplace fee regime cutover (Shopee actual, TikTok/Others estimated)
-- ============================================================================
-- Business rules:
-- - Before 2026-05-01 (WIB shipped date): keep legacy marketplace_commission_rates
-- - On/after 2026-05-01:
--   * Shopee     -> actual MP fee from intake/app if present
--   * Shopee NIL -> fallback Shopee commission rate
--   * TikTok     -> estimated TikTok commission rate
--   * Others MP  -> estimated Others MP commission rate
-- ============================================================================

ALTER TABLE public.marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_marketplace_fee_amount NUMERIC NULL;

ALTER TABLE public.scalev_orders
  ADD COLUMN IF NOT EXISTS marketplace_fee_amount NUMERIC NULL;

COMMENT ON COLUMN public.marketplace_intake_orders.mp_marketplace_fee_amount IS
  'Actual marketplace fee captured from authoritative marketplace intake when available. Currently used for Shopee actual MP fee.';

COMMENT ON COLUMN public.scalev_orders.marketplace_fee_amount IS
  'Order-level marketplace fee stored on ScaleV authoritative orders. Shopee actual MP fee after 2026-05-01 reads from this column.';

CREATE TABLE IF NOT EXISTS public.marketplace_fee_estimate_rates (
  id SERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL CHECK (setting_key IN ('tiktok_estimated', 'others_estimated', 'shopee_fallback')),
  rate NUMERIC NOT NULL CHECK (rate >= 0 AND rate <= 1),
  effective_from DATE NOT NULL DEFAULT DATE '2026-05-01',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(setting_key, effective_from)
);

COMMENT ON TABLE public.marketplace_fee_estimate_rates IS
  'Estimated marketplace fee rates used after 2026-05-01 for TikTok, Other marketplaces, and Shopee fallback when actual fee is missing.';

COMMENT ON COLUMN public.marketplace_fee_estimate_rates.setting_key IS
  'One of: tiktok_estimated, others_estimated, shopee_fallback.';

ALTER TABLE public.marketplace_fee_estimate_rates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'marketplace_fee_estimate_rates'
      AND policyname = 'Read marketplace_fee_estimate_rates'
  ) THEN
    CREATE POLICY "Read marketplace_fee_estimate_rates" ON public.marketplace_fee_estimate_rates
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'marketplace_fee_estimate_rates'
      AND policyname = 'Owner manage marketplace_fee_estimate_rates'
  ) THEN
    CREATE POLICY "Owner manage marketplace_fee_estimate_rates" ON public.marketplace_fee_estimate_rates
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'));
  END IF;
END $$;

WITH latest_legacy_rates AS (
  SELECT DISTINCT ON (channel)
    channel,
    rate
  FROM public.marketplace_commission_rates
  ORDER BY channel, effective_from DESC
),
seed_values AS (
  SELECT 'tiktok_estimated'::TEXT AS setting_key,
         COALESCE(
           (SELECT rate FROM latest_legacy_rates WHERE channel = 'TikTok Shop'),
           0
         ) AS rate
  UNION ALL
  SELECT 'shopee_fallback'::TEXT AS setting_key,
         COALESCE(
           (SELECT rate FROM latest_legacy_rates WHERE channel = 'Shopee'),
           0
         ) AS rate
  UNION ALL
  SELECT 'others_estimated'::TEXT AS setting_key,
         COALESCE(
           (
             SELECT AVG(rate)::NUMERIC
             FROM latest_legacy_rates
             WHERE channel NOT IN ('Shopee', 'TikTok Shop')
           ),
           (SELECT rate FROM latest_legacy_rates WHERE channel = 'TikTok Shop'),
           0
         ) AS rate
)
INSERT INTO public.marketplace_fee_estimate_rates (setting_key, rate, effective_from)
SELECT setting_key, rate, DATE '2026-05-01'
FROM seed_values
ON CONFLICT (setting_key, effective_from) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_marketplace_fee_estimate_rate(p_setting_key TEXT, p_date DATE)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT rate
  FROM public.marketplace_fee_estimate_rates
  WHERE setting_key = p_setting_key
    AND effective_from <= p_date
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.calculate_channel_mp_admin_cost(
  p_date DATE,
  p_product TEXT,
  p_channel TEXT,
  p_net_sales NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cutover_date CONSTANT DATE := DATE '2026-05-01';
  v_rate NUMERIC := 0;
  v_fallback_rate NUMERIC := 0;
  v_amount NUMERIC := 0;
BEGIN
  IF p_date IS NULL OR p_product IS NULL OR p_channel IS NULL THEN
    RETURN 0;
  END IF;

  IF p_date < v_cutover_date THEN
    RETURN ROUND(COALESCE(p_net_sales, 0) * COALESCE(public.get_commission_rate(p_channel, p_date), 0));
  END IF;

  IF p_channel = 'Shopee' THEN
    v_fallback_rate := COALESCE(public.get_marketplace_fee_estimate_rate('shopee_fallback', p_date), 0);

    SELECT COALESCE(SUM(
      CASE
        WHEN alloc.order_net_sales = 0 OR alloc.bucket_net_sales = 0 THEN 0
        WHEN alloc.marketplace_fee_amount IS NULL THEN alloc.bucket_net_sales * v_fallback_rate
        ELSE alloc.marketplace_fee_amount * alloc.bucket_net_sales / alloc.order_net_sales
      END
    ), 0)
    INTO v_amount
    FROM (
      SELECT
        o.id,
        o.marketplace_fee_amount,
        SUM(
          CASE
            WHEN l.product_type IS NOT NULL AND l.product_type != 'Unknown'
              THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
            ELSE 0
          END
        ) AS order_net_sales,
        SUM(
          CASE
            WHEN l.product_type = p_product
             AND l.sales_channel = p_channel
             AND l.product_type IS NOT NULL
             AND l.product_type != 'Unknown'
              THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
            ELSE 0
          END
        ) AS bucket_net_sales
      FROM public.scalev_orders o
      JOIN public.scalev_order_lines l
        ON l.scalev_order_id = o.id
      WHERE o.status IN ('shipped', 'completed')
        AND o.shipped_time IS NOT NULL
        AND DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') = p_date
      GROUP BY o.id, o.marketplace_fee_amount
      HAVING SUM(
        CASE
          WHEN l.product_type = p_product
           AND l.sales_channel = p_channel
           AND l.product_type IS NOT NULL
           AND l.product_type != 'Unknown'
            THEN 1
          ELSE 0
        END
      ) > 0
    ) AS alloc;

    RETURN ROUND(COALESCE(v_amount, 0));
  END IF;

  IF p_channel = 'TikTok Shop' THEN
    v_rate := COALESCE(public.get_marketplace_fee_estimate_rate('tiktok_estimated', p_date), 0);
    RETURN ROUND(COALESCE(p_net_sales, 0) * v_rate);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.marketplace_commission_rates mcr
    WHERE mcr.channel = p_channel
      AND mcr.effective_from <= p_date
  ) THEN
    v_rate := COALESCE(public.get_marketplace_fee_estimate_rate('others_estimated', p_date), 0);
    RETURN ROUND(COALESCE(p_net_sales, 0) * v_rate);
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recompute_channel_complete(p_date DATE, p_product TEXT, p_channel TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.summary_daily_order_channel%ROWTYPE;
  v_mp_admin NUMERIC;
BEGIN
  SELECT * INTO v_row
  FROM public.summary_daily_order_channel
  WHERE date = p_date
    AND product = p_product
    AND channel = p_channel;

  IF NOT FOUND THEN
    DELETE FROM public.summary_daily_channel_complete
    WHERE date = p_date
      AND product = p_product
      AND channel = p_channel;
    RETURN;
  END IF;

  v_mp_admin := public.calculate_channel_mp_admin_cost(
    p_date,
    p_product,
    p_channel,
    COALESCE(v_row.net_sales, 0)
  );

  INSERT INTO public.summary_daily_channel_complete
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

CREATE OR REPLACE FUNCTION public.fn_order_status_change()
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
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed') AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed') AND NEW.shipped_time IS NOT NULL;

  IF v_old_qualifying = v_new_qualifying AND OLD.shipped_time = NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  v_old_date := DATE(OLD.shipped_time AT TIME ZONE 'Asia/Jakarta');
  v_new_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');

  IF v_old_qualifying THEN
    FOR v_line IN
      SELECT *
      FROM public.scalev_order_lines
      WHERE scalev_order_id = OLD.id
        AND product_type IS NOT NULL
        AND product_type != 'Unknown'
    LOOP
      v_channel := v_line.sales_channel;

      UPDATE public.summary_daily_order_channel SET
        gross_sales = gross_sales - COALESCE(v_line.product_price_bt, 0),
        discount = discount - COALESCE(v_line.discount_bt, 0),
        net_sales = net_sales - (COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0)),
        cogs = cogs - COALESCE(v_line.cogs_bt, 0),
        gross_profit = gross_profit - (COALESCE(v_line.product_price_bt, 0) - COALESCE(v_line.discount_bt, 0) - COALESCE(v_line.cogs_bt, 0)),
        updated_at = NOW()
      WHERE date = v_old_date
        AND product = v_line.product_type
        AND channel = v_channel;

      DELETE FROM public.summary_daily_order_channel
      WHERE date = v_old_date
        AND product = v_line.product_type
        AND channel = v_channel
        AND gross_sales = 0
        AND net_sales = 0
        AND cogs = 0;

      PERFORM public.fn_recompute_channel_complete(v_old_date, v_line.product_type, v_channel);
      PERFORM public.fn_recompute_product_complete(v_old_date, v_line.product_type);
    END LOOP;
  END IF;

  IF v_new_qualifying THEN
    FOR v_line IN
      SELECT *
      FROM public.scalev_order_lines
      WHERE scalev_order_id = NEW.id
        AND product_type IS NOT NULL
        AND product_type != 'Unknown'
    LOOP
      v_channel := v_line.sales_channel;

      INSERT INTO public.summary_daily_order_channel
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
        gross_sales = public.summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
        discount = public.summary_daily_order_channel.discount + EXCLUDED.discount,
        net_sales = public.summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
        cogs = public.summary_daily_order_channel.cogs + EXCLUDED.cogs,
        gross_profit = public.summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
        updated_at = NOW();

      PERFORM public.fn_recompute_channel_complete(v_new_date, v_line.product_type, v_channel);
      PERFORM public.fn_recompute_product_complete(v_new_date, v_line.product_type);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_marketplace_fee_estimate_rate_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_setting_key TEXT;
  v_from DATE;
  v_row RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_setting_key := OLD.setting_key;
    v_from := GREATEST(DATE '2026-05-01', OLD.effective_from);
  ELSIF TG_OP = 'INSERT' THEN
    v_setting_key := NEW.setting_key;
    v_from := GREATEST(DATE '2026-05-01', NEW.effective_from);
  ELSE
    v_setting_key := COALESCE(NEW.setting_key, OLD.setting_key);
    v_from := GREATEST(
      DATE '2026-05-01',
      LEAST(
        COALESCE(NEW.effective_from, OLD.effective_from),
        COALESCE(OLD.effective_from, NEW.effective_from)
      )
    );
  END IF;

  IF v_setting_key = 'tiktok_estimated' THEN
    FOR v_row IN
      SELECT DISTINCT date, product, channel
      FROM public.summary_daily_order_channel
      WHERE date >= v_from
        AND channel = 'TikTok Shop'
    LOOP
      PERFORM public.fn_recompute_channel_complete(v_row.date, v_row.product, v_row.channel);
      PERFORM public.fn_recompute_product_complete(v_row.date, v_row.product);
    END LOOP;
  ELSIF v_setting_key = 'shopee_fallback' THEN
    FOR v_row IN
      SELECT DISTINCT date, product, channel
      FROM public.summary_daily_order_channel
      WHERE date >= v_from
        AND channel = 'Shopee'
    LOOP
      PERFORM public.fn_recompute_channel_complete(v_row.date, v_row.product, v_row.channel);
      PERFORM public.fn_recompute_product_complete(v_row.date, v_row.product);
    END LOOP;
  ELSE
    FOR v_row IN
      SELECT DISTINCT oc.date, oc.product, oc.channel
      FROM public.summary_daily_order_channel oc
      WHERE oc.date >= v_from
        AND oc.channel NOT IN ('Shopee', 'TikTok Shop')
        AND EXISTS (
          SELECT 1
          FROM public.marketplace_commission_rates mcr
          WHERE mcr.channel = oc.channel
        )
    LOOP
      PERFORM public.fn_recompute_channel_complete(v_row.date, v_row.product, v_row.channel);
      PERFORM public.fn_recompute_product_complete(v_row.date, v_row.product);
    END LOOP;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_marketplace_fee_amount_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_date DATE;
  v_row RECORD;
BEGIN
  IF NEW.status NOT IN ('shipped', 'completed') OR NEW.shipped_time IS NULL THEN
    RETURN NEW;
  END IF;

  v_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');

  FOR v_row IN
    SELECT DISTINCT product_type AS product, sales_channel AS channel
    FROM public.scalev_order_lines
    WHERE scalev_order_id = NEW.id
      AND product_type IS NOT NULL
      AND product_type != 'Unknown'
  LOOP
    PERFORM public.fn_recompute_channel_complete(v_date, v_row.product, v_row.channel);
    PERFORM public.fn_recompute_product_complete(v_date, v_row.product);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_fee_estimate_rate_summaries ON public.marketplace_fee_estimate_rates;
CREATE TRIGGER trg_marketplace_fee_estimate_rate_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON public.marketplace_fee_estimate_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_marketplace_fee_estimate_rate_change();

DROP TRIGGER IF EXISTS trg_order_marketplace_fee_summaries ON public.scalev_orders;
CREATE TRIGGER trg_order_marketplace_fee_summaries
  AFTER INSERT OR UPDATE OF marketplace_fee_amount
  ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_marketplace_fee_amount_change();

CREATE OR REPLACE FUNCTION public.recalculate_summaries_range(p_from DATE, p_to DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '300s'
AS $$
BEGIN
  DELETE FROM public.summary_daily_order_channel
  WHERE date >= p_from
    AND date <= p_to;

  INSERT INTO public.summary_daily_order_channel (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
  SELECT
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    l.product_type,
    l.sales_channel,
    SUM(l.product_price_bt),
    SUM(l.discount_bt),
    SUM(l.product_price_bt - l.discount_bt),
    SUM(l.cogs_bt),
    SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)
  FROM public.scalev_order_lines l
  JOIN public.scalev_orders o
    ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
    AND DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') >= p_from
    AND DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= p_to
  GROUP BY DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'), l.product_type, l.sales_channel;

  DELETE FROM public.summary_daily_ads_by_brand
  WHERE date >= p_from
    AND date <= p_to;

  INSERT INTO public.summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT a.date, m.brand, SUM(a.spent)
  FROM public.daily_ads_spend a
  JOIN public.ads_store_brand_mapping m
    ON LOWER(a.store) = LOWER(m.store_pattern)
  WHERE a.spent > 0
    AND a.date >= p_from
    AND a.date <= p_to
  GROUP BY a.date, m.brand;

  DELETE FROM public.summary_daily_channel_complete
  WHERE date >= p_from
    AND date <= p_to;

  INSERT INTO public.summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit,
     mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT
    oc.date,
    oc.product,
    oc.channel,
    ROUND(oc.gross_sales),
    ROUND(oc.discount),
    ROUND(oc.net_sales),
    ROUND(oc.cogs),
    ROUND(oc.gross_profit),
    fee.mp_admin_cost,
    fee.mp_admin_cost,
    ROUND(oc.gross_profit) - fee.mp_admin_cost
  FROM public.summary_daily_order_channel oc
  CROSS JOIN LATERAL (
    SELECT public.calculate_channel_mp_admin_cost(oc.date, oc.product, oc.channel, oc.net_sales) AS mp_admin_cost
  ) fee
  WHERE oc.date >= p_from
    AND oc.date <= p_to;

  DELETE FROM public.summary_daily_product_complete
  WHERE date >= p_from
    AND date <= p_to;

  INSERT INTO public.summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT
    cc.date,
    cc.product,
    SUM(cc.net_sales),
    SUM(cc.gross_profit),
    SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0),
    SUM(cc.mp_admin_cost),
    SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0))
  FROM public.summary_daily_channel_complete cc
  LEFT JOIN public.summary_daily_ads_by_brand ads
    ON ads.date = cc.date
   AND ads.product = cc.product
  WHERE cc.date >= p_from
    AND cc.date <= p_to
  GROUP BY cc.date, cc.product, ads.total_ads_spend;

  DELETE FROM public.summary_daily_customer_type
  WHERE date >= p_from
    AND date <= p_to;

  INSERT INTO public.summary_daily_customer_type (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs)
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
  FROM public.v_order_with_identity o
  LEFT JOIN public.summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  WHERE date(o.shipped_time) >= p_from
    AND date(o.shipped_time) <= p_to
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

CREATE OR REPLACE FUNCTION public.recalculate_all_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '600s'
AS $$
BEGIN
  ALTER TABLE public.scalev_order_lines DISABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE public.scalev_orders DISABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE public.scalev_orders DISABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE public.scalev_orders DISABLE TRIGGER trg_order_marketplace_fee_summaries;
  ALTER TABLE public.daily_ads_spend DISABLE TRIGGER trg_ads_summaries;
  ALTER TABLE public.marketplace_commission_rates DISABLE TRIGGER trg_commission_rate_summaries;
  ALTER TABLE public.marketplace_fee_estimate_rates DISABLE TRIGGER trg_marketplace_fee_estimate_rate_summaries;

  TRUNCATE public.summary_daily_order_channel,
           public.summary_daily_ads_by_brand,
           public.summary_daily_channel_complete,
           public.summary_daily_product_complete,
           public.summary_customer_first_order,
           public.summary_daily_customer_type,
           public.summary_customer_cohort,
           public.summary_monthly_cohort;

  INSERT INTO public.summary_daily_order_channel (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit)
  SELECT
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    l.product_type,
    l.sales_channel,
    SUM(l.product_price_bt),
    SUM(l.discount_bt),
    SUM(l.product_price_bt - l.discount_bt),
    SUM(l.cogs_bt),
    SUM(l.product_price_bt - l.discount_bt - l.cogs_bt)
  FROM public.scalev_order_lines l
  JOIN public.scalev_orders o
    ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
  GROUP BY DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'), l.product_type, l.sales_channel;

  INSERT INTO public.summary_daily_ads_by_brand (date, product, total_ads_spend)
  SELECT a.date, m.brand, SUM(a.spent)
  FROM public.daily_ads_spend a
  JOIN public.ads_store_brand_mapping m
    ON LOWER(a.store) = LOWER(m.store_pattern)
  WHERE a.spent > 0
  GROUP BY a.date, m.brand;

  INSERT INTO public.summary_daily_channel_complete
    (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit,
     mp_admin_cost, mkt_cost, net_after_mkt)
  SELECT
    oc.date,
    oc.product,
    oc.channel,
    ROUND(oc.gross_sales),
    ROUND(oc.discount),
    ROUND(oc.net_sales),
    ROUND(oc.cogs),
    ROUND(oc.gross_profit),
    fee.mp_admin_cost,
    fee.mp_admin_cost,
    ROUND(oc.gross_profit) - fee.mp_admin_cost
  FROM public.summary_daily_order_channel oc
  CROSS JOIN LATERAL (
    SELECT public.calculate_channel_mp_admin_cost(oc.date, oc.product, oc.channel, oc.net_sales) AS mp_admin_cost
  ) fee;

  INSERT INTO public.summary_daily_product_complete
    (date, product, net_sales, gross_profit, mkt_cost, mp_admin_cost, net_after_mkt)
  SELECT
    cc.date,
    cc.product,
    SUM(cc.net_sales),
    SUM(cc.gross_profit),
    SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0),
    SUM(cc.mp_admin_cost),
    SUM(cc.gross_profit) - (SUM(cc.mp_admin_cost) + COALESCE(ads.total_ads_spend, 0))
  FROM public.summary_daily_channel_complete cc
  LEFT JOIN public.summary_daily_ads_by_brand ads
    ON ads.date = cc.date
   AND ads.product = cc.product
  GROUP BY cc.date, cc.product, ads.total_ads_spend;

  INSERT INTO public.summary_customer_first_order (customer_identifier, first_order_date)
  SELECT customer_identifier, MIN(DATE(shipped_time))
  FROM public.scalev_orders
  WHERE shipped_time IS NOT NULL
    AND status IN ('shipped', 'completed')
    AND customer_identifier IS NOT NULL
  GROUP BY customer_identifier;

  INSERT INTO public.summary_daily_customer_type (date, customer_type, sales_channel, order_count, customer_count, revenue, cogs)
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
  FROM public.v_order_with_identity o
  LEFT JOIN public.summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  GROUP BY date(o.shipped_time),
    CASE
      WHEN o.customer_identifier ~~ 'unidentified:%' THEN 'unidentified'
      WHEN o.csv_customer_type IS NOT NULL AND o.csv_customer_type <> '' THEN
        CASE WHEN o.csv_customer_type = 'ro' THEN 'ro' ELSE 'new' END
      WHEN date(o.shipped_time) = f.first_order_date THEN 'new'
      ELSE 'ro'
    END,
    o.sales_channel;

  INSERT INTO public.summary_customer_cohort
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
    FROM public.v_order_with_identity o
    JOIN public.summary_customer_first_order f ON o.customer_identifier = f.customer_identifier
  )
  SELECT customer_identifier, min(customer_name), min(sales_channel),
    count(DISTINCT order_id), sum(line_revenue),
    sum(line_revenue) / NULLIF(count(DISTINCT order_id), 0)::numeric,
    min(date(shipped_time)), max(date(shipped_time)),
    bool_or(resolved_type = 'ro')
  FROM order_typed
  GROUP BY customer_identifier;

  INSERT INTO public.summary_monthly_cohort (cohort_month, months_since_first, active_customers, orders, revenue)
  WITH ccm AS (
    SELECT customer_identifier, to_char(first_order_date::timestamp, 'YYYY-MM') AS cohort_month
    FROM public.summary_customer_first_order
  ), ma AS (
    SELECT o.customer_identifier, to_char(date(o.shipped_time)::timestamp, 'YYYY-MM') AS activity_month
    FROM public.v_order_with_identity o
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
  FROM ccm
  JOIN ma ON ccm.customer_identifier = ma.customer_identifier
  GROUP BY ccm.cohort_month,
    (EXTRACT(year FROM to_date(ma.activity_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ma.activity_month, 'YYYY-MM'))::int) -
    (EXTRACT(year FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int * 12 +
     EXTRACT(month FROM to_date(ccm.cohort_month, 'YYYY-MM'))::int);

  ALTER TABLE public.scalev_order_lines ENABLE TRIGGER trg_order_line_summaries;
  ALTER TABLE public.scalev_orders ENABLE TRIGGER trg_order_status_summaries;
  ALTER TABLE public.scalev_orders ENABLE TRIGGER trg_order_customer_summaries;
  ALTER TABLE public.scalev_orders ENABLE TRIGGER trg_order_marketplace_fee_summaries;
  ALTER TABLE public.daily_ads_spend ENABLE TRIGGER trg_ads_summaries;
  ALTER TABLE public.marketplace_commission_rates ENABLE TRIGGER trg_commission_rate_summaries;
  ALTER TABLE public.marketplace_fee_estimate_rates ENABLE TRIGGER trg_marketplace_fee_estimate_rate_summaries;
END;
$$;
