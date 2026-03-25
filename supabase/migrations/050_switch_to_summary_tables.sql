-- ============================================================================
-- Migration 050: Switch Wrapper Views to Summary Tables
-- ============================================================================
-- Points all wrapper views to the new summary tables instead of MVs.
-- Dashboard pages query these wrapper views, so no frontend code changes needed.
--
-- After validation, the MVs can be dropped in a future migration (051).
-- ============================================================================

-- ── Switch daily_channel_data to summary table ──
CREATE OR REPLACE VIEW daily_channel_data AS
SELECT
  NULL::INT AS id,
  date,
  product,
  channel,
  gross_sales,
  discount,
  net_sales,
  cogs,
  gross_profit,
  mkt_cost,
  mp_admin_cost,
  net_after_mkt,
  NULL::INT AS import_id
FROM summary_daily_channel_complete;

-- ── Switch daily_product_summary to summary table ──
CREATE OR REPLACE VIEW daily_product_summary AS
SELECT
  NULL::INT AS id,
  date,
  product,
  net_sales,
  gross_profit,
  mp_admin_cost,
  net_after_mkt,
  mkt_cost,
  NULL::INT AS import_id
FROM summary_daily_product_complete;

-- ── v_daily_totals and v_channel_totals auto-update via the chain ──
-- (They SELECT FROM daily_product_summary / daily_channel_data)

-- ── Switch customer views to summary tables ──
CREATE OR REPLACE VIEW v_customer_first_order AS
SELECT * FROM summary_customer_first_order;

CREATE OR REPLACE VIEW v_daily_customer_type AS
SELECT * FROM summary_daily_customer_type;

CREATE OR REPLACE VIEW v_customer_cohort AS
SELECT * FROM summary_customer_cohort;

CREATE OR REPLACE VIEW v_monthly_cohort AS
SELECT * FROM summary_monthly_cohort;
