-- ============================================================================
-- Migration 049: Enable Summary Triggers
-- ============================================================================
-- Creates triggers on base tables (scalev_order_lines, scalev_orders,
-- daily_ads_spend, marketplace_commission_rates) to incrementally update
-- the summary tables created in migration 048.
--
-- After this migration, both MVs and summary tables are maintained.
-- The wrapper views still point to MVs (switched in migration 050).
-- ============================================================================

-- ── Trigger on scalev_order_lines: update order summaries ──
DROP TRIGGER IF EXISTS trg_order_line_summaries ON scalev_order_lines;
CREATE TRIGGER trg_order_line_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON scalev_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_order_summaries();

-- ── Trigger on scalev_orders: handle status/shipped_time changes (order summaries) ──
DROP TRIGGER IF EXISTS trg_order_status_summaries ON scalev_orders;
CREATE TRIGGER trg_order_status_summaries
  AFTER UPDATE OF status, shipped_time
  ON scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_order_status_change();

-- ── Trigger on scalev_orders: handle status/shipped_time changes (customer summaries) ──
DROP TRIGGER IF EXISTS trg_order_customer_summaries ON scalev_orders;
CREATE TRIGGER trg_order_customer_summaries
  AFTER UPDATE OF status, shipped_time, customer_identifier
  ON scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_customer_summaries();

-- ── Trigger on daily_ads_spend: update ads summaries ──
DROP TRIGGER IF EXISTS trg_ads_summaries ON daily_ads_spend;
CREATE TRIGGER trg_ads_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON daily_ads_spend
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_ads_summaries();

-- ── Trigger on marketplace_commission_rates: recompute channel/product complete ──
DROP TRIGGER IF EXISTS trg_commission_rate_summaries ON marketplace_commission_rates;
CREATE TRIGGER trg_commission_rate_summaries
  AFTER INSERT OR UPDATE OR DELETE
  ON marketplace_commission_rates
  FOR EACH ROW
  EXECUTE FUNCTION fn_commission_rate_change();
