-- Increase statement_timeout for refresh_single_mv from 120s to 300s.
-- MV queries like mv_daily_order_channel and mv_customer_cohort
-- regularly exceed 120s on larger datasets.

CREATE OR REPLACE FUNCTION refresh_single_mv(mv_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || quote_ident(mv_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET statement_timeout = '300s';
