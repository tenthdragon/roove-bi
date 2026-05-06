-- ============================================================
-- Remove exact duplicate Google Sheets ads rows
-- ============================================================
-- A rolling Google Sheet can span multiple months. Older sync logic deleted
-- only the month inferred from the first row, then re-inserted newer rows
-- without clearing them first. That produced exact duplicate google_sheets
-- rows in daily_ads_spend and inflated marketing fee across the dashboard.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        date,
        COALESCE(ad_account, ''),
        spent,
        COALESCE(objective, ''),
        COALESCE(source, ''),
        COALESCE(store, ''),
        COALESCE(advertiser, ''),
        COALESCE(data_source, ''),
        COALESCE(impressions, 0),
        COALESCE(cpm, 0),
        COALESCE(business_code, '')
      ORDER BY id
    ) AS row_num
  FROM public.daily_ads_spend
  WHERE data_source = 'google_sheets'
)
DELETE FROM public.daily_ads_spend AS spend
USING ranked
WHERE spend.id = ranked.id
  AND ranked.row_num > 1;
