-- ============================================================
-- 023: Cash flow breakdown by sales channel
-- ============================================================
-- Returns the same 4 categories as get_live_cashflow, but grouped
-- by raw order columns (platform, is_purchase_fb, payment_method)
-- so the frontend can derive channel names and show per-channel breakdown.
--
-- Performance note: GROUP BY on raw columns instead of function calls
-- keeps query time at ~0.3s (same as get_live_cashflow). Channel name
-- derivation happens in TypeScript using derive_cashflow_channel logic.
-- ============================================================

-- Helper for future use (not called in the RPC to avoid GROUP BY penalty)
CREATE OR REPLACE FUNCTION derive_cashflow_channel(
  p_platform TEXT,
  p_is_purchase_fb BOOLEAN,
  p_payment_method TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN LOWER(COALESCE(p_platform, '')) = 'tiktokshop'                      THEN 'TikTok Shop'
    WHEN LOWER(COALESCE(p_platform, '')) = 'shopee'                          THEN 'Shopee'
    WHEN LOWER(COALESCE(p_platform, '')) IN ('lazada','blibli','tokopedia')   THEN 'MP Lainnya'
    WHEN is_bank_transfer(p_payment_method) AND p_is_purchase_fb = true      THEN 'Scalev Ads (Transfer)'
    WHEN is_bank_transfer(p_payment_method)                                  THEN 'CS Manual (Transfer)'
    WHEN p_is_purchase_fb = true                                             THEN 'Scalev Ads (COD)'
    ELSE                                                                          'CS Manual (COD)'
  END;
$$;

-- UNION ALL version: 4 indexed scans (same as get_live_cashflow) + GROUP BY raw columns
-- Returns raw columns for channel derivation in TypeScript (~0.3s warm)
DROP FUNCTION IF EXISTS get_live_cashflow_by_channel(integer, integer);

CREATE OR REPLACE FUNCTION get_live_cashflow_by_channel(p_month INT, p_year INT)
RETURNS TABLE(category TEXT, platform TEXT, is_fb BOOLEAN, pay_method TEXT, total NUMERIC, order_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_prev_start DATE;
  v_prev_end   DATE;
BEGIN
  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + INTERVAL '1 month')::DATE;
  v_prev_start := (v_start - INTERVAL '1 month')::DATE;
  v_prev_end   := v_start;

  -- 1. Cash Received: shipped this month AND (completed OR bank_transfer)
  RETURN QUERY
  SELECT 'cash_received'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM scalev_orders o
  WHERE o.shipped_time >= v_start AND o.shipped_time < v_end
    AND (o.completed_time IS NOT NULL OR is_bank_transfer(o.payment_method))
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  -- 2. Spill Over: shipped last month, completed this month, not bank transfer
  RETURN QUERY
  SELECT 'spill_over'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM scalev_orders o
  WHERE o.shipped_time >= v_prev_start AND o.shipped_time < v_prev_end
    AND o.completed_time >= v_start AND o.completed_time < v_end
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  -- 3. In Progress: shipped this month, not completed, not bank transfer
  RETURN QUERY
  SELECT 'in_progress'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM scalev_orders o
  WHERE o.shipped_time >= v_start AND o.shipped_time < v_end
    AND o.completed_time IS NULL
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  -- 4. Overdue: shipped last month, not completed, not bank transfer
  RETURN QUERY
  SELECT 'overdue'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM scalev_orders o
  WHERE o.shipped_time >= v_prev_start AND o.shipped_time < v_prev_end
    AND o.completed_time IS NULL
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;
END;
$$;
