-- ============================================================================
-- Migration 058: Monthly CAC per channel with brand filter
-- ============================================================================
-- Returns monthly ad spend, new customers, and CAC per channel group.
-- Conservative: all ad spend attributed to new customers only.
-- Optional brand_filter: filters both ad spend (by store) and new customers.
-- ============================================================================

DROP FUNCTION IF EXISTS get_monthly_cac();
DROP FUNCTION IF EXISTS get_monthly_cac(TEXT);

CREATE OR REPLACE FUNCTION get_monthly_cac(brand_filter TEXT DEFAULT NULL)
RETURNS TABLE(
  month TEXT,
  channel_group TEXT,
  ad_spend NUMERIC,
  new_customers BIGINT,
  cac NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '30s'
AS $$
BEGIN
  RETURN QUERY
  WITH spend AS (
    SELECT
      TO_CHAR(date, 'YYYY-MM') AS m,
      CASE
        WHEN source ILIKE '%cpas%' THEN 'Shopee'
        WHEN source ILIKE '%shopee%' THEN 'Shopee'
        WHEN source ILIKE '%tiktok%' THEN 'TikTok Shop'
        WHEN source ILIKE '%facebook%' THEN 'Scalev'
        WHEN source ILIKE '%whatsapp%' OR source ILIKE '%waba%' THEN 'Scalev'
        ELSE NULL
      END AS cg,
      SUM(spent) AS total_spent
    FROM daily_ads_spend
    WHERE spent > 0
      -- Filter by brand via store column (normStore: 'Purvu Store' → 'Purvu')
      AND (brand_filter IS NULL OR
           store = brand_filter OR
           (brand_filter = 'Purvu' AND store = 'Purvu Store'))
    GROUP BY 1, 2
    HAVING CASE
      WHEN source ILIKE '%cpas%' THEN 'Shopee'
      WHEN source ILIKE '%shopee%' THEN 'Shopee'
      WHEN source ILIKE '%tiktok%' THEN 'TikTok Shop'
      WHEN source ILIKE '%facebook%' THEN 'Scalev'
      WHEN source ILIKE '%whatsapp%' OR source ILIKE '%waba%' THEN 'Scalev'
      ELSE NULL
    END IS NOT NULL
  ),
  new_custs AS (
    SELECT m, cg, COUNT(DISTINCT cp)::BIGINT AS num_new
    FROM (
      -- Without brand filter: count from summary_customer_cohort
      SELECT
        TO_CHAR(sc.first_order_date, 'YYYY-MM') AS m,
        get_channel_group(sc.first_channel) AS cg,
        sc.customer_phone AS cp
      FROM summary_customer_cohort sc
      WHERE sc.customer_phone NOT LIKE 'unidentified:%'
        AND get_channel_group(sc.first_channel) IS NOT NULL
        AND brand_filter IS NULL

      UNION ALL

      -- With brand filter: count from summary_customer_ltv
      SELECT
        s.cohort_month AS m,
        s.channel_group AS cg,
        s.customer_phone AS cp
      FROM summary_customer_ltv s
      WHERE s.channel_group IS NOT NULL
        AND brand_filter IS NOT NULL
        AND s.brand = brand_filter
    ) sub
    GROUP BY m, cg
  )
  SELECT
    COALESCE(s.m, n.m),
    COALESCE(s.cg, n.cg),
    COALESCE(s.total_spent, 0),
    COALESCE(n.num_new, 0),
    CASE
      WHEN COALESCE(n.num_new, 0) > 0
      THEN ROUND(COALESCE(s.total_spent, 0) / n.num_new, 0)
      ELSE NULL
    END
  FROM spend s
  FULL OUTER JOIN new_custs n ON s.m = n.m AND s.cg = n.cg
  WHERE COALESCE(s.cg, n.cg) IN ('Scalev', 'Shopee', 'TikTok Shop')
  ORDER BY 1, 2;
END;
$$;
