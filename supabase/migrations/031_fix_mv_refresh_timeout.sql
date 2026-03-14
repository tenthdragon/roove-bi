-- Fix: refresh_single_mv times out on PostgREST default statement_timeout (8s).
-- Set 120s timeout within the function.

CREATE OR REPLACE FUNCTION refresh_single_mv(mv_name TEXT)
RETURNS void AS $$
BEGIN
  SET LOCAL statement_timeout = '120s';
  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || quote_ident(mv_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
