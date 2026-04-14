-- ============================================================
-- 103: Warehouse stock reclassification requests
-- Adds auditable FG <-> BONUS reclassification flow with
-- request, approval, and immutable ledger application.
-- ============================================================

ALTER TABLE warehouse_stock_ledger
  DROP CONSTRAINT IF EXISTS warehouse_stock_ledger_reference_type_check;

ALTER TABLE warehouse_stock_ledger
  ADD CONSTRAINT warehouse_stock_ledger_reference_type_check
  CHECK (reference_type IN ('scalev_order','manual','purchase_order','transfer','dispose','opname','rts','reclass'));

CREATE TABLE IF NOT EXISTS warehouse_stock_reclass_requests (
  id BIGSERIAL PRIMARY KEY,
  source_warehouse_product_id INT NOT NULL
    CONSTRAINT wsr_source_product_fkey REFERENCES warehouse_products(id) ON DELETE RESTRICT,
  source_batch_id INT
    CONSTRAINT wsr_source_batch_fkey REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  target_warehouse_product_id INT NOT NULL
    CONSTRAINT wsr_target_product_fkey REFERENCES warehouse_products(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','applied','rejected')),
  requested_by UUID
    CONSTRAINT wsr_requested_by_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID
    CONSTRAINT wsr_approved_by_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID
    CONSTRAINT wsr_rejected_by_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  applied_by UUID
    CONSTRAINT wsr_applied_by_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  ledger_reference_id TEXT,
  source_product_name_snapshot TEXT NOT NULL,
  source_category_snapshot TEXT NOT NULL,
  source_entity_snapshot TEXT NOT NULL,
  source_warehouse_snapshot TEXT NOT NULL,
  target_product_name_snapshot TEXT NOT NULL,
  target_category_snapshot TEXT NOT NULL,
  target_entity_snapshot TEXT NOT NULL,
  target_warehouse_snapshot TEXT NOT NULL,
  source_batch_code_snapshot TEXT,
  source_expired_date_snapshot DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_warehouse_product_id <> target_warehouse_product_id)
);

CREATE INDEX IF NOT EXISTS idx_wsr_status_requested_at
  ON warehouse_stock_reclass_requests(status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_wsr_source_product
  ON warehouse_stock_reclass_requests(source_warehouse_product_id);

CREATE INDEX IF NOT EXISTS idx_wsr_target_product
  ON warehouse_stock_reclass_requests(target_warehouse_product_id);

ALTER TABLE warehouse_stock_reclass_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_warehouse_stock_reclass_requests"
  ON warehouse_stock_reclass_requests
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "manage_warehouse_stock_reclass_requests"
  ON warehouse_stock_reclass_requests
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

INSERT INTO role_permissions (role, permission_key) VALUES
  ('admin', 'wh:reclass_request'),
  ('admin', 'wh:reclass_approve'),
  ('direktur_ops', 'wh:reclass_request'),
  ('direktur_ops', 'wh:reclass_approve'),
  ('warehouse_manager', 'wh:reclass_request')
ON CONFLICT DO NOTHING;
