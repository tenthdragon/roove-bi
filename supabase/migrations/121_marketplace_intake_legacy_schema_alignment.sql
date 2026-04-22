-- ============================================================
-- Marketplace intake legacy schema alignment
-- ============================================================
-- Earlier iterations of marketplace intake depended on
-- marketplace source mapping tables. The current Shopee RLT
-- intake flow is opinionated and no longer requires those
-- foreign keys or NOT NULL constraints.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ALTER COLUMN source_id DROP NOT NULL;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ALTER COLUMN final_source_store_id DROP NOT NULL;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ALTER COLUMN matched_rule_id DROP NOT NULL,
  ALTER COLUMN mapped_source_store_id DROP NOT NULL;

ALTER TABLE IF EXISTS marketplace_intake_batches
  DROP CONSTRAINT IF EXISTS marketplace_intake_batches_source_id_fkey;

ALTER TABLE IF EXISTS marketplace_intake_orders
  DROP CONSTRAINT IF EXISTS marketplace_intake_orders_final_source_store_id_fkey;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  DROP CONSTRAINT IF EXISTS marketplace_intake_order_lines_matched_rule_id_fkey;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  DROP CONSTRAINT IF EXISTS marketplace_intake_order_lines_mapped_source_store_id_fkey;

COMMENT ON COLUMN marketplace_intake_batches.source_id IS
  'Legacy source reference kept nullable for backward compatibility; current Shopee RLT intake flow does not require it.';

COMMENT ON COLUMN marketplace_intake_orders.final_source_store_id IS
  'Legacy nullable store reference kept for compatibility; current intake flow resolves store by opinionated classifier.';

COMMENT ON COLUMN marketplace_intake_order_lines.matched_rule_id IS
  'Legacy nullable rule reference kept for compatibility; current intake flow does not depend on mapping rules.';

COMMENT ON COLUMN marketplace_intake_order_lines.mapped_source_store_id IS
  'Legacy nullable source-store reference kept for compatibility; current intake flow stores mapped_store_name directly.';
