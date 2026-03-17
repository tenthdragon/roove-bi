-- Fix: refresh_single_mv still times out because SET LOCAL inside the function
-- body is overridden by PostgREST's connection-level statement_timeout.
-- Solution: use function-level SET clause which forces the GUC for the
-- entire function execution regardless of caller's settings.

CREATE OR REPLACE FUNCTION refresh_single_mv(mv_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || quote_ident(mv_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET statement_timeout = '120s';
