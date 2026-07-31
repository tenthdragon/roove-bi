-- ============================================================================
-- 168: Workspace-aware daily summary pipeline
-- ============================================================================
-- The legacy incremental summaries used date/product as a global key. This
-- migration makes the commercial dashboard summaries tenant-local and replaces
-- their hot-path triggers with workspace-aware equivalents.
-- ============================================================================

BEGIN;

ALTER TABLE public.summary_daily_order_channel
  DROP CONSTRAINT IF EXISTS summary_daily_order_channel_pkey;
ALTER TABLE public.summary_daily_order_channel
  ADD PRIMARY KEY (workspace_id, date, product, channel);

ALTER TABLE public.summary_daily_ads_by_brand
  DROP CONSTRAINT IF EXISTS summary_daily_ads_by_brand_pkey;
ALTER TABLE public.summary_daily_ads_by_brand
  ADD PRIMARY KEY (workspace_id, date, product);

ALTER TABLE public.summary_daily_channel_complete
  DROP CONSTRAINT IF EXISTS summary_daily_channel_complete_pkey;
ALTER TABLE public.summary_daily_channel_complete
  ADD PRIMARY KEY (workspace_id, date, product, channel);

ALTER TABLE public.summary_daily_product_complete
  DROP CONSTRAINT IF EXISTS summary_daily_product_complete_pkey;
ALTER TABLE public.summary_daily_product_complete
  ADD PRIMARY KEY (workspace_id, date, product);

ALTER TABLE public.monthly_product_summary
  DROP CONSTRAINT IF EXISTS monthly_product_summary_period_month_period_year_product_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_product_summary_workspace_period_product
  ON public.monthly_product_summary (
    workspace_id,
    period_month,
    period_year,
    product
  );

-- Natural-key constraints on these configuration/report tables predated
-- workspaces. Their IDs remain globally unique, while business keys become
-- tenant-local.
DO $$
DECLARE
  v_table TEXT;
  v_constraint RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brands',
    'financial_pl_monthly',
    'financial_cf_monthly',
    'financial_ratios_monthly',
    'financial_bs_monthly'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_constraint IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || v_table)
        AND contype = 'u'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I',
        v_table,
        v_constraint.conname
      );
    END LOOP;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_workspace_name
  ON public.brands (workspace_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_workspace_sheet
  ON public.brands (workspace_id, sheet_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_pl_workspace_line
  ON public.financial_pl_monthly (workspace_id, month, line_item);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_cf_workspace_line
  ON public.financial_cf_monthly (workspace_id, month, line_item);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ratio_workspace_name
  ON public.financial_ratios_monthly (workspace_id, month, ratio_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_bs_workspace_line
  ON public.financial_bs_monthly (workspace_id, month, line_item);

CREATE OR REPLACE FUNCTION public.calculate_workspace_channel_mp_admin_cost(
  p_workspace_id UUID,
  p_date DATE,
  p_product TEXT,
  p_channel TEXT,
  p_net_sales NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cutover_date CONSTANT DATE := DATE '2026-05-01';
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_rate NUMERIC := 0;
  v_amount NUMERIC := 0;
BEGIN
  IF p_date IS NULL OR p_product IS NULL OR p_channel IS NULL THEN
    RETURN 0;
  END IF;

  IF p_date < v_cutover_date THEN
    SELECT rate
    INTO v_rate
    FROM public.marketplace_commission_rates
    WHERE workspace_id = p_workspace_id
      AND channel = p_channel
      AND effective_from <= p_date
    ORDER BY effective_from DESC
    LIMIT 1;
    RETURN ROUND(COALESCE(p_net_sales, 0) * COALESCE(v_rate, 0));
  END IF;

  SELECT rate
  INTO v_rate
  FROM public.marketplace_fee_estimate_rates
  WHERE workspace_id = p_workspace_id
    AND setting_key = CASE
      WHEN p_channel = 'Shopee' THEN 'shopee_fallback'
      WHEN p_channel = 'TikTok Shop' THEN 'tiktok_estimated'
      ELSE 'others_estimated'
    END
    AND effective_from <= p_date
  ORDER BY effective_from DESC
  LIMIT 1;

  IF p_channel = 'Shopee' THEN
    v_day_start := p_date::TIMESTAMP AT TIME ZONE 'Asia/Jakarta';
    v_day_end := (p_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta';

    WITH candidate_orders AS (
      SELECT DISTINCT o.id, o.marketplace_fee_amount
      FROM public.scalev_order_lines match_line
      JOIN public.scalev_orders o
        ON o.id = match_line.scalev_order_id
       AND o.workspace_id = p_workspace_id
      WHERE match_line.workspace_id = p_workspace_id
        AND match_line.product_type = p_product
        AND match_line.sales_channel = p_channel
        AND o.status IN ('shipped', 'completed')
        AND o.shipped_time >= v_day_start
        AND o.shipped_time < v_day_end
    ),
    allocation AS (
      SELECT
        candidate.id,
        candidate.marketplace_fee_amount,
        SUM(
          CASE
            WHEN line.product_type IS NOT NULL
             AND line.product_type <> 'Unknown'
              THEN COALESCE(line.product_price_bt, 0)
                 - COALESCE(line.discount_bt, 0)
            ELSE 0
          END
        ) AS order_net_sales,
        SUM(
          CASE
            WHEN line.product_type = p_product
             AND line.sales_channel = p_channel
              THEN COALESCE(line.product_price_bt, 0)
                 - COALESCE(line.discount_bt, 0)
            ELSE 0
          END
        ) AS bucket_net_sales
      FROM candidate_orders candidate
      JOIN public.scalev_order_lines line
        ON line.workspace_id = p_workspace_id
       AND line.scalev_order_id = candidate.id
      GROUP BY candidate.id, candidate.marketplace_fee_amount
    )
    SELECT COALESCE(SUM(
      CASE
        WHEN order_net_sales = 0 OR bucket_net_sales = 0 THEN 0
        WHEN marketplace_fee_amount IS NULL
          THEN bucket_net_sales * COALESCE(v_rate, 0)
        ELSE marketplace_fee_amount * bucket_net_sales / order_net_sales
      END
    ), 0)
    INTO v_amount
    FROM allocation;

    RETURN ROUND(COALESCE(v_amount, 0));
  END IF;

  IF p_channel = 'TikTok Shop'
     OR EXISTS (
       SELECT 1
       FROM public.marketplace_commission_rates
       WHERE workspace_id = p_workspace_id
         AND channel = p_channel
         AND effective_from <= p_date
     ) THEN
    RETURN ROUND(COALESCE(p_net_sales, 0) * COALESCE(v_rate, 0));
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recompute_workspace_channel_complete(
  p_workspace_id UUID,
  p_date DATE,
  p_product TEXT,
  p_channel TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.summary_daily_order_channel%ROWTYPE;
  v_mp_admin NUMERIC;
BEGIN
  SELECT *
  INTO v_row
  FROM public.summary_daily_order_channel
  WHERE workspace_id = p_workspace_id
    AND date = p_date
    AND product = p_product
    AND channel = p_channel;

  IF NOT FOUND THEN
    DELETE FROM public.summary_daily_channel_complete
    WHERE workspace_id = p_workspace_id
      AND date = p_date
      AND product = p_product
      AND channel = p_channel;
    RETURN;
  END IF;

  v_mp_admin := public.calculate_workspace_channel_mp_admin_cost(
    p_workspace_id,
    p_date,
    p_product,
    p_channel,
    COALESCE(v_row.net_sales, 0)
  );

  INSERT INTO public.summary_daily_channel_complete (
    workspace_id,
    date,
    product,
    channel,
    gross_sales,
    discount,
    net_sales,
    cogs,
    gross_profit,
    mp_admin_cost,
    mkt_cost,
    net_after_mkt,
    updated_at
  )
  VALUES (
    p_workspace_id,
    p_date,
    p_product,
    p_channel,
    ROUND(v_row.gross_sales),
    ROUND(v_row.discount),
    ROUND(v_row.net_sales),
    ROUND(v_row.cogs),
    ROUND(v_row.gross_profit),
    v_mp_admin,
    v_mp_admin,
    ROUND(v_row.gross_profit) - v_mp_admin,
    NOW()
  )
  ON CONFLICT (workspace_id, date, product, channel) DO UPDATE SET
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

CREATE OR REPLACE FUNCTION public.fn_recompute_workspace_product_complete(
  p_workspace_id UUID,
  p_date DATE,
  p_product TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_net_sales NUMERIC;
  v_gross_profit NUMERIC;
  v_mp_admin NUMERIC;
  v_ads_spend NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(net_sales), 0),
    COALESCE(SUM(gross_profit), 0),
    COALESCE(SUM(mp_admin_cost), 0)
  INTO v_net_sales, v_gross_profit, v_mp_admin
  FROM public.summary_daily_channel_complete
  WHERE workspace_id = p_workspace_id
    AND date = p_date
    AND product = p_product;

  SELECT COALESCE(total_ads_spend, 0)
  INTO v_ads_spend
  FROM public.summary_daily_ads_by_brand
  WHERE workspace_id = p_workspace_id
    AND date = p_date
    AND product = p_product;
  IF NOT FOUND THEN
    v_ads_spend := 0;
  END IF;

  IF v_net_sales = 0
     AND v_gross_profit = 0
     AND v_mp_admin = 0
     AND v_ads_spend = 0 THEN
    DELETE FROM public.summary_daily_product_complete
    WHERE workspace_id = p_workspace_id
      AND date = p_date
      AND product = p_product;
    RETURN;
  END IF;

  INSERT INTO public.summary_daily_product_complete (
    workspace_id,
    date,
    product,
    net_sales,
    gross_profit,
    mkt_cost,
    mp_admin_cost,
    net_after_mkt,
    updated_at
  )
  VALUES (
    p_workspace_id,
    p_date,
    p_product,
    v_net_sales,
    v_gross_profit,
    v_mp_admin + v_ads_spend,
    v_mp_admin,
    v_gross_profit - v_mp_admin - v_ads_spend,
    NOW()
  )
  ON CONFLICT (workspace_id, date, product) DO UPDATE SET
    net_sales = EXCLUDED.net_sales,
    gross_profit = EXCLUDED.gross_profit,
    mkt_cost = EXCLUDED.mkt_cost,
    mp_admin_cost = EXCLUDED.mp_admin_cost,
    net_after_mkt = EXCLUDED.net_after_mkt,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_apply_workspace_order_summary_delta(
  p_workspace_id UUID,
  p_date DATE,
  p_product TEXT,
  p_channel TEXT,
  p_gross_sales NUMERIC,
  p_discount NUMERIC,
  p_cogs NUMERIC,
  p_multiplier NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_gross NUMERIC := COALESCE(p_gross_sales, 0) * p_multiplier;
  v_discount NUMERIC := COALESCE(p_discount, 0) * p_multiplier;
  v_cogs NUMERIC := COALESCE(p_cogs, 0) * p_multiplier;
BEGIN
  IF p_date IS NULL
     OR p_product IS NULL
     OR p_product = 'Unknown'
     OR p_channel IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.summary_daily_order_channel (
    workspace_id,
    date,
    product,
    channel,
    gross_sales,
    discount,
    net_sales,
    cogs,
    gross_profit,
    updated_at
  )
  VALUES (
    p_workspace_id,
    p_date,
    p_product,
    p_channel,
    v_gross,
    v_discount,
    v_gross - v_discount,
    v_cogs,
    v_gross - v_discount - v_cogs,
    NOW()
  )
  ON CONFLICT (workspace_id, date, product, channel) DO UPDATE SET
    gross_sales = public.summary_daily_order_channel.gross_sales
      + EXCLUDED.gross_sales,
    discount = public.summary_daily_order_channel.discount
      + EXCLUDED.discount,
    net_sales = public.summary_daily_order_channel.net_sales
      + EXCLUDED.net_sales,
    cogs = public.summary_daily_order_channel.cogs + EXCLUDED.cogs,
    gross_profit = public.summary_daily_order_channel.gross_profit
      + EXCLUDED.gross_profit,
    updated_at = NOW();

  DELETE FROM public.summary_daily_order_channel
  WHERE workspace_id = p_workspace_id
    AND date = p_date
    AND product = p_product
    AND channel = p_channel
    AND ABS(gross_sales) < 0.000001
    AND ABS(net_sales) < 0.000001
    AND ABS(cogs) < 0.000001;

  PERFORM public.fn_recompute_workspace_channel_complete(
    p_workspace_id,
    p_date,
    p_product,
    p_channel
  );
  PERFORM public.fn_recompute_workspace_product_complete(
    p_workspace_id,
    p_date,
    p_product
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_workspace_order_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order public.scalev_orders%ROWTYPE;
  v_date DATE;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    SELECT *
    INTO v_order
    FROM public.scalev_orders
    WHERE id = OLD.scalev_order_id
      AND workspace_id = OLD.workspace_id;

    IF FOUND
       AND v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL THEN
      v_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM public.fn_apply_workspace_order_summary_delta(
        OLD.workspace_id,
        v_date,
        OLD.product_type,
        OLD.sales_channel,
        OLD.product_price_bt,
        OLD.discount_bt,
        OLD.cogs_bt,
        -1
      );
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT *
    INTO v_order
    FROM public.scalev_orders
    WHERE id = NEW.scalev_order_id
      AND workspace_id = NEW.workspace_id;

    IF FOUND
       AND v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL THEN
      v_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM public.fn_apply_workspace_order_summary_delta(
        NEW.workspace_id,
        v_date,
        NEW.product_type,
        NEW.sales_channel,
        NEW.product_price_bt,
        NEW.discount_bt,
        NEW.cogs_bt,
        1
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_line_summaries ON public.scalev_order_lines;
CREATE TRIGGER trg_order_line_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON public.scalev_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_workspace_order_summaries();

CREATE OR REPLACE FUNCTION public.fn_update_workspace_order_status_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_old_date DATE;
  v_new_date DATE;
  v_bucket RECORD;
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed')
    AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed')
    AND NEW.shipped_time IS NOT NULL;

  IF v_old_qualifying = v_new_qualifying
     AND OLD.shipped_time IS NOT DISTINCT FROM NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  v_old_date := DATE(OLD.shipped_time AT TIME ZONE 'Asia/Jakarta');
  v_new_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');

  FOR v_bucket IN
    SELECT
      line.product_type,
      line.sales_channel,
      SUM(COALESCE(line.product_price_bt, 0)) AS gross_sales,
      SUM(COALESCE(line.discount_bt, 0)) AS discount,
      SUM(COALESCE(line.cogs_bt, 0)) AS cogs
    FROM public.scalev_order_lines line
    WHERE line.workspace_id = NEW.workspace_id
      AND line.scalev_order_id = NEW.id
      AND line.product_type IS NOT NULL
      AND line.product_type <> 'Unknown'
    GROUP BY line.product_type, line.sales_channel
  LOOP
    IF v_old_qualifying THEN
      PERFORM public.fn_apply_workspace_order_summary_delta(
        OLD.workspace_id,
        v_old_date,
        v_bucket.product_type,
        v_bucket.sales_channel,
        v_bucket.gross_sales,
        v_bucket.discount,
        v_bucket.cogs,
        -1
      );
    END IF;
    IF v_new_qualifying THEN
      PERFORM public.fn_apply_workspace_order_summary_delta(
        NEW.workspace_id,
        v_new_date,
        v_bucket.product_type,
        v_bucket.sales_channel,
        v_bucket.gross_sales,
        v_bucket.discount,
        v_bucket.cogs,
        1
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_summaries ON public.scalev_orders;
CREATE TRIGGER trg_order_status_summaries
  AFTER UPDATE OF status, shipped_time
  ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_workspace_order_status_summaries();

CREATE OR REPLACE FUNCTION public.fn_update_workspace_ads_summaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_brand TEXT;
  v_workspace_id UUID;
  v_date DATE;
  v_spent NUMERIC;
  v_multiplier NUMERIC;
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') AND COALESCE(OLD.spent, 0) > 0 THEN
    v_workspace_id := OLD.workspace_id;
    v_date := OLD.date;
    v_spent := OLD.spent;
    v_multiplier := -1;

    SELECT mapping.brand
    INTO v_brand
    FROM public.ads_store_brand_mapping mapping
    WHERE mapping.workspace_id = v_workspace_id
      AND LOWER(OLD.store) = LOWER(mapping.store_pattern)
    LIMIT 1;

    IF v_brand IS NOT NULL THEN
      INSERT INTO public.summary_daily_ads_by_brand (
        workspace_id, date, product, total_ads_spend, updated_at
      )
      VALUES (
        v_workspace_id, v_date, v_brand, v_spent * v_multiplier, NOW()
      )
      ON CONFLICT (workspace_id, date, product) DO UPDATE SET
        total_ads_spend = public.summary_daily_ads_by_brand.total_ads_spend
          + EXCLUDED.total_ads_spend,
        updated_at = NOW();

      DELETE FROM public.summary_daily_ads_by_brand
      WHERE workspace_id = v_workspace_id
        AND date = v_date
        AND product = v_brand
        AND total_ads_spend <= 0;
      PERFORM public.fn_recompute_workspace_product_complete(
        v_workspace_id, v_date, v_brand
      );
    END IF;
  END IF;

  v_brand := NULL;
  IF TG_OP IN ('INSERT', 'UPDATE') AND COALESCE(NEW.spent, 0) > 0 THEN
    v_workspace_id := NEW.workspace_id;
    v_date := NEW.date;
    v_spent := NEW.spent;

    SELECT mapping.brand
    INTO v_brand
    FROM public.ads_store_brand_mapping mapping
    WHERE mapping.workspace_id = v_workspace_id
      AND LOWER(NEW.store) = LOWER(mapping.store_pattern)
    LIMIT 1;

    IF v_brand IS NOT NULL THEN
      INSERT INTO public.summary_daily_ads_by_brand (
        workspace_id, date, product, total_ads_spend, updated_at
      )
      VALUES (
        v_workspace_id, v_date, v_brand, v_spent, NOW()
      )
      ON CONFLICT (workspace_id, date, product) DO UPDATE SET
        total_ads_spend = public.summary_daily_ads_by_brand.total_ads_spend
          + EXCLUDED.total_ads_spend,
        updated_at = NOW();
      PERFORM public.fn_recompute_workspace_product_complete(
        v_workspace_id, v_date, v_brand
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ads_summaries ON public.daily_ads_spend;
CREATE TRIGGER trg_ads_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON public.daily_ads_spend
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_workspace_ads_summaries();

CREATE OR REPLACE FUNCTION public.fn_workspace_fee_config_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_from DATE;
  v_row RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_workspace_id := OLD.workspace_id;
    v_from := OLD.effective_from;
  ELSIF TG_OP = 'INSERT' THEN
    v_workspace_id := NEW.workspace_id;
    v_from := NEW.effective_from;
  ELSE
    v_workspace_id := NEW.workspace_id;
    v_from := LEAST(OLD.effective_from, NEW.effective_from);
  END IF;

  FOR v_row IN
    SELECT date, product, channel
    FROM public.summary_daily_order_channel
    WHERE workspace_id = v_workspace_id
      AND date >= v_from
  LOOP
    PERFORM public.fn_recompute_workspace_channel_complete(
      v_workspace_id, v_row.date, v_row.product, v_row.channel
    );
    PERFORM public.fn_recompute_workspace_product_complete(
      v_workspace_id, v_row.date, v_row.product
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commission_rate_summaries
  ON public.marketplace_commission_rates;
CREATE TRIGGER trg_commission_rate_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON public.marketplace_commission_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspace_fee_config_change();

DROP TRIGGER IF EXISTS trg_marketplace_fee_estimate_rate_summaries
  ON public.marketplace_fee_estimate_rates;
CREATE TRIGGER trg_marketplace_fee_estimate_rate_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON public.marketplace_fee_estimate_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspace_fee_config_change();

CREATE OR REPLACE FUNCTION public.fn_workspace_marketplace_fee_amount_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date DATE;
  v_row RECORD;
BEGIN
  IF NEW.status NOT IN ('shipped', 'completed')
     OR NEW.shipped_time IS NULL THEN
    RETURN NEW;
  END IF;

  v_date := DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta');
  FOR v_row IN
    SELECT DISTINCT product_type AS product, sales_channel AS channel
    FROM public.scalev_order_lines
    WHERE workspace_id = NEW.workspace_id
      AND scalev_order_id = NEW.id
      AND product_type IS NOT NULL
      AND product_type <> 'Unknown'
  LOOP
    PERFORM public.fn_recompute_workspace_channel_complete(
      NEW.workspace_id, v_date, v_row.product, v_row.channel
    );
    PERFORM public.fn_recompute_workspace_product_complete(
      NEW.workspace_id, v_date, v_row.product
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_marketplace_fee_summaries
  ON public.scalev_orders;
CREATE TRIGGER trg_order_marketplace_fee_summaries
  AFTER INSERT OR UPDATE OF marketplace_fee_amount
  ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_workspace_marketplace_fee_amount_change();

CREATE OR REPLACE FUNCTION public.recalculate_workspace_summaries(
  p_workspace_id UUID,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
DECLARE
  v_from DATE;
  v_to DATE;
  v_row RECORD;
BEGIN
  IF (p_from IS NULL) <> (p_to IS NULL) THEN
    RAISE EXCEPTION 'p_from and p_to must both be provided or both be null';
  END IF;

  IF p_from IS NULL THEN
    SELECT
      COALESCE(
        MIN(DATE(shipped_time AT TIME ZONE 'Asia/Jakarta')),
        CURRENT_DATE
      ),
      COALESCE(
        MAX(DATE(shipped_time AT TIME ZONE 'Asia/Jakarta')),
        CURRENT_DATE
      )
    INTO v_from, v_to
    FROM public.scalev_orders
    WHERE workspace_id = p_workspace_id
      AND shipped_time IS NOT NULL;

    DELETE FROM public.summary_daily_order_channel
    WHERE workspace_id = p_workspace_id;
    DELETE FROM public.summary_daily_ads_by_brand
    WHERE workspace_id = p_workspace_id;
    DELETE FROM public.summary_daily_channel_complete
    WHERE workspace_id = p_workspace_id;
    DELETE FROM public.summary_daily_product_complete
    WHERE workspace_id = p_workspace_id;
  ELSE
    v_from := LEAST(p_from, p_to);
    v_to := GREATEST(p_from, p_to);

    DELETE FROM public.summary_daily_order_channel
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to;
    DELETE FROM public.summary_daily_ads_by_brand
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to;
    DELETE FROM public.summary_daily_channel_complete
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to;
    DELETE FROM public.summary_daily_product_complete
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to;
  END IF;

  INSERT INTO public.summary_daily_order_channel (
    workspace_id,
    date,
    product,
    channel,
    gross_sales,
    discount,
    net_sales,
    cogs,
    gross_profit
  )
  SELECT
    p_workspace_id,
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    line.product_type,
    line.sales_channel,
    SUM(COALESCE(line.product_price_bt, 0)),
    SUM(COALESCE(line.discount_bt, 0)),
    SUM(
      COALESCE(line.product_price_bt, 0)
      - COALESCE(line.discount_bt, 0)
    ),
    SUM(COALESCE(line.cogs_bt, 0)),
    SUM(
      COALESCE(line.product_price_bt, 0)
      - COALESCE(line.discount_bt, 0)
      - COALESCE(line.cogs_bt, 0)
    )
  FROM public.scalev_orders o
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = o.id
  WHERE o.workspace_id = p_workspace_id
    AND o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND line.product_type IS NOT NULL
    AND line.product_type <> 'Unknown'
    AND DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta')
      BETWEEN v_from AND v_to
  GROUP BY
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    line.product_type,
    line.sales_channel;

  INSERT INTO public.summary_daily_ads_by_brand (
    workspace_id,
    date,
    product,
    total_ads_spend
  )
  SELECT
    p_workspace_id,
    ads.date,
    mapping.brand,
    SUM(ads.spent)
  FROM public.daily_ads_spend ads
  JOIN public.ads_store_brand_mapping mapping
    ON mapping.workspace_id = p_workspace_id
   AND LOWER(ads.store) = LOWER(mapping.store_pattern)
  WHERE ads.workspace_id = p_workspace_id
    AND ads.spent > 0
    AND ads.date BETWEEN v_from AND v_to
  GROUP BY ads.date, mapping.brand;

  FOR v_row IN
    SELECT date, product, channel
    FROM public.summary_daily_order_channel
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to
  LOOP
    PERFORM public.fn_recompute_workspace_channel_complete(
      p_workspace_id,
      v_row.date,
      v_row.product,
      v_row.channel
    );
  END LOOP;

  FOR v_row IN
    SELECT date, product
    FROM public.summary_daily_channel_complete
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to
    UNION
    SELECT date, product
    FROM public.summary_daily_ads_by_brand
    WHERE workspace_id = p_workspace_id
      AND date BETWEEN v_from AND v_to
  LOOP
    PERFORM public.fn_recompute_workspace_product_complete(
      p_workspace_id,
      v_row.date,
      v_row.product
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_workspace_summaries(
  UUID,
  DATE,
  DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_workspace_summaries(
  UUID,
  DATE,
  DATE
) TO service_role;

-- Customer, PPIC and Commercial Moments summaries remain Roove-only during
-- this rollout. Their Apurva pages are server-blocked, and these WHEN clauses
-- ensure Apurva writes cannot mutate Roove's legacy aggregates.
DROP TRIGGER IF EXISTS trg_order_customer_summaries ON public.scalev_orders;
CREATE TRIGGER trg_order_customer_summaries
  AFTER UPDATE OF status, shipped_time, customer_identifier
  ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_customer_summaries();

DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_insert_delete
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_insert
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_delete
  ON public.scalev_orders;
CREATE TRIGGER zz_trg_customer_first_order_exact_insert
  AFTER INSERT ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.sync_customer_first_order_exact();
CREATE TRIGGER zz_trg_customer_first_order_exact_delete
  AFTER DELETE ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    OLD.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.sync_customer_first_order_exact();

DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_update
  ON public.scalev_orders;
CREATE TRIGGER zz_trg_customer_first_order_exact_update
  AFTER UPDATE OF
    status,
    shipped_time,
    customer_identifier,
    customer_name,
    customer_phone,
    platform,
    order_id
  ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.shipped_time IS DISTINCT FROM NEW.shipped_time
      OR OLD.customer_identifier IS DISTINCT FROM NEW.customer_identifier
    )
  )
  EXECUTE FUNCTION public.sync_customer_first_order_exact();

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_insert
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_update
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_delete
  ON public.scalev_order_lines;
CREATE TRIGGER trg_scalev_daily_product_demand_line_insert
  AFTER INSERT ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_scalev_daily_product_demand();
CREATE TRIGGER trg_scalev_daily_product_demand_line_update
  AFTER UPDATE ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_scalev_daily_product_demand();
CREATE TRIGGER trg_scalev_daily_product_demand_line_delete
  AFTER DELETE ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    OLD.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_scalev_daily_product_demand();

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_status
  ON public.scalev_orders;
CREATE TRIGGER trg_scalev_daily_product_demand_order_status
  AFTER UPDATE OF status, shipped_time
  ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_scalev_daily_product_demand_order_status_change();

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_delete
  ON public.scalev_orders;
CREATE TRIGGER trg_scalev_daily_product_demand_order_delete
  BEFORE DELETE ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    OLD.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_scalev_daily_product_demand_order_delete();

DROP TRIGGER IF EXISTS trg_scalev_monthly_movement_insert
  ON public.scalev_order_lines;
CREATE TRIGGER trg_scalev_monthly_movement_insert
  AFTER INSERT ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.trg_update_scalev_monthly_movement();

DROP TRIGGER IF EXISTS trg_commercial_revenue_line
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_insert
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_update
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_delete
  ON public.scalev_order_lines;
CREATE TRIGGER trg_commercial_revenue_line_insert
  AFTER INSERT ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_line();
CREATE TRIGGER trg_commercial_revenue_line_update
  AFTER UPDATE ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_line();
CREATE TRIGGER trg_commercial_revenue_line_delete
  AFTER DELETE ON public.scalev_order_lines
  FOR EACH ROW
  WHEN (
    OLD.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_line();

DROP TRIGGER IF EXISTS trg_commercial_revenue_order
  ON public.scalev_orders;
CREATE TRIGGER trg_commercial_revenue_order
  AFTER UPDATE OF status, draft_time, shipped_time
  ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    NEW.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_update_commercial_revenue_from_order();

DROP TRIGGER IF EXISTS trg_commercial_revenue_order_delete
  ON public.scalev_orders;
CREATE TRIGGER trg_commercial_revenue_order_delete
  BEFORE DELETE ON public.scalev_orders
  FOR EACH ROW
  WHEN (
    OLD.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
  )
  EXECUTE FUNCTION public.fn_delete_commercial_revenue_from_order();

COMMIT;
