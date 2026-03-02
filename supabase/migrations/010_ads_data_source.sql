-- ============================================================
-- Add data_source column to daily_ads_spend
-- ============================================================
-- Tracks the origin of each row so Google Sheets sync and Meta API sync
-- don't overwrite each other's data.
--   'google_sheets' = imported from Google Sheets (manual)
--   'meta_api'      = pulled from Meta Marketing API

ALTER TABLE daily_ads_spend
  ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'google_sheets';

-- Tag existing Meta-sourced rows (rows with Facebook/CPAS sources that were already synced)
-- This is a best-effort migration for rows inserted before this column existed.
UPDATE daily_ads_spend
  SET data_source = 'meta_api'
  WHERE source IN ('Facebook Ads', 'Facebook CPAS')
    AND impressions > 0;

COMMENT ON COLUMN daily_ads_spend.data_source IS 'Origin: google_sheets or meta_api';
