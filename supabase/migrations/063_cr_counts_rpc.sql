-- 063: Simple RPC for CR counts (leads vs shipped)
-- Uses timestamp range for index efficiency.

-- Index for draft_time (leads)
CREATE INDEX IF NOT EXISTS idx_scalev_orders_draft_time ON scalev_orders (draft_time);

CREATE OR REPLACE FUNCTION get_cr_counts(p_from DATE, p_to DATE)
RETURNS TABLE (total_leads BIGINT, total_shipped BIGINT)
LANGUAGE sql STABLE
AS $$
  WITH params AS (
    SELECT
      (p_from::timestamp - interval '7 hours') AS ts_from,
      ((p_to + 1)::timestamp - interval '7 hours') AS ts_to
  )
  SELECT
    (SELECT COUNT(*) FROM scalev_orders, params
     WHERE draft_time >= params.ts_from
       AND draft_time < params.ts_to
       AND store_name NOT ILIKE '%marketplace%'
       AND store_name NOT ILIKE '%shopee%'
       AND store_name NOT ILIKE '%tiktok%'
    ) AS total_leads,
    (SELECT COUNT(*) FROM scalev_orders, params
     WHERE shipped_time >= params.ts_from
       AND shipped_time < params.ts_to
       AND status IN ('shipped', 'completed')
       AND store_name NOT ILIKE '%marketplace%'
       AND store_name NOT ILIKE '%shopee%'
       AND store_name NOT ILIKE '%tiktok%'
    ) AS total_shipped;
$$;
