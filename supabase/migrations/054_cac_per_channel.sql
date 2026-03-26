-- ============================================================================
-- Migration 054: Conservative CAC per channel for Roove
-- ============================================================================
-- Calculates Customer Acquisition Cost per channel group.
-- Conservative approach: ALL ad spend is attributed to new customers only.
-- CAC = Ad spend / New customers, matched to the same date range.
-- Uses the ad spend date range as the common period:
--   earliest ad spend date → latest ad spend date per channel.
-- Only new customers whose first_order_date falls within that range are counted.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_channel_cac()
RETURNS TABLE(
  channel_group TEXT,
  total_spend NUMERIC,
  new_customers BIGINT,
  cac NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
BEGIN
  RETURN QUERY
  WITH ads_raw AS (
    SELECT
      CASE
        WHEN source ILIKE '%cpas%' THEN 'Shopee'
        WHEN source ILIKE '%shopee%' THEN 'Shopee'
        WHEN source ILIKE '%tiktok%' THEN 'TikTok Shop'
        WHEN source ILIKE '%facebook%' THEN 'Scalev'
        WHEN source ILIKE '%whatsapp%' OR source ILIKE '%waba%' THEN 'Scalev'
        ELSE NULL
      END AS cg,
      date,
      spent
    FROM daily_ads_spend
    WHERE store = 'Roove'
      AND spent > 0
  ),
  spend_by_channel AS (
    SELECT
      cg,
      SUM(spent) AS total_spent,
      MIN(date) AS spend_from,
      MAX(date) AS spend_to
    FROM ads_raw
    WHERE cg IS NOT NULL
    GROUP BY cg
  ),
  new_custs_by_channel AS (
    -- Count new customers per channel, within the ad spend date range of that channel
    SELECT
      get_channel_group(sc.first_channel) AS cg,
      COUNT(*)::BIGINT AS num_new
    FROM summary_customer_cohort sc
    JOIN spend_by_channel sp ON get_channel_group(sc.first_channel) = sp.cg
    WHERE sc.first_order_date >= sp.spend_from
      AND sc.first_order_date <= sp.spend_to
      AND sc.customer_phone NOT LIKE 'unidentified:%'
      AND get_channel_group(sc.first_channel) IS NOT NULL
    GROUP BY 1
  )
  SELECT
    s.cg AS channel_group,
    s.total_spent AS total_spend,
    COALESCE(n.num_new, 0) AS new_customers,
    CASE
      WHEN COALESCE(n.num_new, 0) > 0
      THEN ROUND(s.total_spent / n.num_new, 0)
      ELSE NULL
    END AS cac
  FROM spend_by_channel s
  LEFT JOIN new_custs_by_channel n ON s.cg = n.cg
  WHERE s.cg IN ('Scalev', 'Shopee', 'TikTok Shop')
  ORDER BY s.total_spent DESC;
END;
$$;
