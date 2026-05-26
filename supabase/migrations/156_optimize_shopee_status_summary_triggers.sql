-- ============================================================================
-- Migration 156: Optimize Shopee status-change summary maintenance
-- ============================================================================
-- ScaleV sends marketplace status updates in large bursts after ops uploads.
-- The previous Shopee marketplace-admin calculation scanned every shipped order
-- in the day for each single order status update, which could push webhook
-- writes past PostgREST's statement timeout and make ScaleV retries keep 500ing.
--
-- This keeps synchronous summaries intact, but narrows Shopee fee recomputation
-- to candidate orders for the affected product/channel and uses shipped_time
-- range predicates so existing shipped_time indexes can be used.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_scalev_order_lines_channel_product_order
  ON public.scalev_order_lines (sales_channel, product_type, scalev_order_id)
  INCLUDE (product_price_bt, discount_bt)
  WHERE product_type IS NOT NULL
    AND product_type != 'Unknown';

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
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
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
    v_day_start := p_date::timestamp AT TIME ZONE 'Asia/Jakarta';
    v_day_end := (p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta';

    WITH candidate_orders AS (
      SELECT DISTINCT
        o.id,
        o.marketplace_fee_amount
      FROM public.scalev_order_lines ml
      JOIN public.scalev_orders o
        ON o.id = ml.scalev_order_id
      WHERE ml.product_type = p_product
        AND ml.sales_channel = p_channel
        AND o.status IN ('shipped', 'completed')
        AND o.shipped_time >= v_day_start
        AND o.shipped_time < v_day_end
    ),
    alloc AS (
      SELECT
        co.id,
        co.marketplace_fee_amount,
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
              THEN COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)
            ELSE 0
          END
        ) AS bucket_net_sales
      FROM candidate_orders co
      JOIN public.scalev_order_lines l
        ON l.scalev_order_id = co.id
      GROUP BY co.id, co.marketplace_fee_amount
    )
    SELECT COALESCE(SUM(
      CASE
        WHEN alloc.order_net_sales = 0 OR alloc.bucket_net_sales = 0 THEN 0
        WHEN alloc.marketplace_fee_amount IS NULL THEN alloc.bucket_net_sales * v_fallback_rate
        ELSE alloc.marketplace_fee_amount * alloc.bucket_net_sales / alloc.order_net_sales
      END
    ), 0)
    INTO v_amount
    FROM alloc;

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

CREATE OR REPLACE FUNCTION public.fn_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_old_date DATE;
  v_new_date DATE;
  v_bucket RECORD;
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed') AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed') AND NEW.shipped_time IS NOT NULL;

  IF v_old_qualifying = v_new_qualifying
     AND OLD.shipped_time IS NOT DISTINCT FROM NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  v_old_date := DATE(OLD.shipped_time AT TIME ZONE 'Asia/Jakarta');
  v_new_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');

  IF v_old_qualifying THEN
    FOR v_bucket IN
      SELECT
        l.product_type,
        l.sales_channel,
        SUM(COALESCE(l.product_price_bt, 0)) AS gross_sales,
        SUM(COALESCE(l.discount_bt, 0)) AS discount,
        SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS net_sales,
        SUM(COALESCE(l.cogs_bt, 0)) AS cogs,
        SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0) - COALESCE(l.cogs_bt, 0)) AS gross_profit
      FROM public.scalev_order_lines l
      WHERE l.scalev_order_id = OLD.id
        AND l.product_type IS NOT NULL
        AND l.product_type != 'Unknown'
      GROUP BY l.product_type, l.sales_channel
    LOOP
      UPDATE public.summary_daily_order_channel SET
        gross_sales = gross_sales - v_bucket.gross_sales,
        discount = discount - v_bucket.discount,
        net_sales = net_sales - v_bucket.net_sales,
        cogs = cogs - v_bucket.cogs,
        gross_profit = gross_profit - v_bucket.gross_profit,
        updated_at = NOW()
      WHERE date = v_old_date
        AND product = v_bucket.product_type
        AND channel = v_bucket.sales_channel;

      DELETE FROM public.summary_daily_order_channel
      WHERE date = v_old_date
        AND product = v_bucket.product_type
        AND channel = v_bucket.sales_channel
        AND gross_sales = 0
        AND net_sales = 0
        AND cogs = 0;

      PERFORM public.fn_recompute_channel_complete(v_old_date, v_bucket.product_type, v_bucket.sales_channel);
      PERFORM public.fn_recompute_product_complete(v_old_date, v_bucket.product_type);
    END LOOP;
  END IF;

  IF v_new_qualifying THEN
    FOR v_bucket IN
      SELECT
        l.product_type,
        l.sales_channel,
        SUM(COALESCE(l.product_price_bt, 0)) AS gross_sales,
        SUM(COALESCE(l.discount_bt, 0)) AS discount,
        SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS net_sales,
        SUM(COALESCE(l.cogs_bt, 0)) AS cogs,
        SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0) - COALESCE(l.cogs_bt, 0)) AS gross_profit
      FROM public.scalev_order_lines l
      WHERE l.scalev_order_id = NEW.id
        AND l.product_type IS NOT NULL
        AND l.product_type != 'Unknown'
      GROUP BY l.product_type, l.sales_channel
    LOOP
      INSERT INTO public.summary_daily_order_channel
        (date, product, channel, gross_sales, discount, net_sales, cogs, gross_profit, updated_at)
      VALUES
        (v_new_date, v_bucket.product_type, v_bucket.sales_channel,
         v_bucket.gross_sales, v_bucket.discount, v_bucket.net_sales,
         v_bucket.cogs, v_bucket.gross_profit, NOW())
      ON CONFLICT (date, product, channel) DO UPDATE SET
        gross_sales = public.summary_daily_order_channel.gross_sales + EXCLUDED.gross_sales,
        discount = public.summary_daily_order_channel.discount + EXCLUDED.discount,
        net_sales = public.summary_daily_order_channel.net_sales + EXCLUDED.net_sales,
        cogs = public.summary_daily_order_channel.cogs + EXCLUDED.cogs,
        gross_profit = public.summary_daily_order_channel.gross_profit + EXCLUDED.gross_profit,
        updated_at = NOW();

      PERFORM public.fn_recompute_channel_complete(v_new_date, v_bucket.product_type, v_bucket.sales_channel);
      PERFORM public.fn_recompute_product_complete(v_new_date, v_bucket.product_type);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
