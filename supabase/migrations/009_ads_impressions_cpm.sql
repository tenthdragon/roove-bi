-- ============================================================
-- Add impressions and CPM columns to daily_ads_spend
-- ============================================================
-- These fields are pulled from Meta Marketing API insights.
-- For Google Sheets-sourced rows, these will remain 0 (default).

ALTER TABLE daily_ads_spend
  ADD COLUMN IF NOT EXISTS impressions BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpm NUMERIC NOT NULL DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN daily_ads_spend.impressions IS 'Number of times ads were shown (from Meta API)';
COMMENT ON COLUMN daily_ads_spend.cpm IS 'Cost per 1000 impressions in account currency (from Meta API)';
