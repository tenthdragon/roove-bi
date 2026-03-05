-- ============================================================
-- Fix: Bank transfer orders counted as received when shipped
-- ============================================================
-- Payment method nuances:
--   Bank Transfer / Manual / Transfer → cash in hand at shipping
--   COD / Marketplace → cash received only after completion
-- This migration recreates get_live_cashflow to handle this.
-- ============================================================

-- Helper: returns TRUE if payment_method is a bank transfer variant
-- (cash is already in hand when order ships)
CREATE OR REPLACE FUNCTION is_bank_transfer(pm TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT LOWER(COALESCE(pm, '')) LIKE '%bank%transfer%'
      OR LOWER(COALESCE(pm, '')) LIKE '%manual%'
      OR LOWER(COALESCE(pm, '')) IN ('transfer', 'bank_transfer');
$$;

CREATE OR REPLACE FUNCTION get_live_cashflow(p_month INT, p_year INT)
RETURNS TABLE(category TEXT, total NUMERIC, order_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_prev_start DATE;
  v_prev_end   DATE;
BEGIN
  -- Current period boundaries
  v_start := make_date(p_year, p_month, 1);
  v_end   := (v_start + INTERVAL '1 month')::DATE;

  -- Previous period boundaries
  v_prev_start := (v_start - INTERVAL '1 month')::DATE;
  v_prev_end   := v_start;

  -- ── 1. Cash Received (bulan ini) ──
  -- a) Shipped & completed this month (any payment method — incl COD & MP)
  -- b) Bank transfer shipped this month (cash already in hand, even if not completed)
  RETURN QUERY
  SELECT 'cash_received'::TEXT,
         COALESCE(SUM(ABS(o.net_revenue)), 0),
         COUNT(*)
  FROM scalev_orders o
  WHERE o.shipped_time >= v_start
    AND o.shipped_time < v_end
    AND (
      o.completed_time IS NOT NULL          -- completed (any method)
      OR is_bank_transfer(o.payment_method) -- bank transfer = received on ship
    )
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  -- ── 2. Spill Over (shipped bulan lalu, cair bulan ini) ──
  -- COD & MP: shipped prev month, completed this month
  -- Bank transfer: already counted as received last month → excluded
  RETURN QUERY
  SELECT 'spill_over'::TEXT,
         COALESCE(SUM(ABS(o.net_revenue)), 0),
         COUNT(*)
  FROM scalev_orders o
  WHERE o.shipped_time >= v_prev_start
    AND o.shipped_time < v_prev_end
    AND o.completed_time >= v_start
    AND o.completed_time < v_end
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  -- ── 3. In Progress (shipped bulan ini, belum cair) ──
  -- COD & MP: shipped this month, not yet completed
  -- Bank transfer excluded (already in received)
  RETURN QUERY
  SELECT 'in_progress'::TEXT,
         COALESCE(SUM(ABS(o.net_revenue)), 0),
         COUNT(*)
  FROM scalev_orders o
  WHERE o.shipped_time >= v_start
    AND o.shipped_time < v_end
    AND o.completed_time IS NULL
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  -- ── 4. Overdue (shipped bulan lalu, belum juga cair) ──
  -- COD & MP: shipped prev month, still not completed
  -- Bank transfer excluded (already in received last month)
  RETURN QUERY
  SELECT 'overdue'::TEXT,
         COALESCE(SUM(ABS(o.net_revenue)), 0),
         COUNT(*)
  FROM scalev_orders o
  WHERE o.shipped_time >= v_prev_start
    AND o.shipped_time < v_prev_end
    AND o.completed_time IS NULL
    AND NOT is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');
END;
$$;
