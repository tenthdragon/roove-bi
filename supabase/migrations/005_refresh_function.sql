-- ============================================================
-- Phase 3: Refresh Function for Materialized Views
-- ============================================================

-- Refreshes all 4 MVs in dependency order.
-- CONCURRENTLY requires unique indexes (created in 004).
-- First refresh must NOT use CONCURRENTLY (tables are empty).

CREATE OR REPLACE FUNCTION refresh_order_views(use_concurrent BOOLEAN DEFAULT TRUE)
RETURNS void AS $$
BEGIN
  IF use_concurrent THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_customer_cohort;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_cohort;
  ELSE
    REFRESH MATERIALIZED VIEW mv_daily_order_channel;
    REFRESH MATERIALIZED VIEW mv_daily_ads_by_brand;
    REFRESH MATERIALIZED VIEW mv_daily_channel_complete;
    REFRESH MATERIALIZED VIEW mv_daily_product_complete;
    REFRESH MATERIALIZED VIEW mv_daily_customer_type;
    REFRESH MATERIALIZED VIEW mv_customer_cohort;
    REFRESH MATERIALIZED VIEW mv_monthly_cohort;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Single-MV refresh function — called by the API route one MV at a time
-- to avoid PostgREST statement timeout when refreshing all 7 MVs.
CREATE OR REPLACE FUNCTION refresh_single_mv(mv_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || quote_ident(mv_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Initial population (non-concurrent since MVs are empty) ──
SELECT refresh_order_views(FALSE);
