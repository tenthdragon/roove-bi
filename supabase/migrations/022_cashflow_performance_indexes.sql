-- ============================================================
-- 022: Add indexes on scalev_orders for cash flow performance
-- ============================================================
-- The get_live_cashflow RPC runs 4 queries filtering on shipped_time,
-- completed_time, and status. Without indexes, each query does a full
-- table scan on 30K+ rows, taking ~7 seconds total — causing timeouts
-- on Vercel serverless functions.
--
-- These indexes bring total RPC time from ~7s to <500ms.
-- ============================================================

-- Primary filter: shipped_time range (used in all 4 queries)
CREATE INDEX IF NOT EXISTS idx_scalev_orders_shipped_time
  ON scalev_orders (shipped_time)
  WHERE shipped_time IS NOT NULL;

-- Secondary filter: completed_time (used in spill_over, in_progress, overdue)
CREATE INDEX IF NOT EXISTS idx_scalev_orders_completed_time
  ON scalev_orders (completed_time)
  WHERE completed_time IS NOT NULL;

-- Status filter (used in all 4 queries to exclude canceled/failed/returned)
CREATE INDEX IF NOT EXISTS idx_scalev_orders_status
  ON scalev_orders (status);

-- Composite index for the most common query pattern:
-- shipped in date range + status not canceled + check completed
CREATE INDEX IF NOT EXISTS idx_scalev_orders_cashflow
  ON scalev_orders (shipped_time, status, completed_time)
  WHERE shipped_time IS NOT NULL
    AND status NOT IN ('canceled', 'cancelled', 'failed', 'returned');
