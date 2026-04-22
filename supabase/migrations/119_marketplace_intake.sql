-- ============================================================
-- Marketplace intake review snapshot
-- ============================================================
-- Stage-1 marketplace intake flow:
-- upload marketplace file -> parse -> classify -> review ->
-- confirm save snapshot. No outbound Scalev order creation yet.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS marketplace_intake_batches (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT,
  source_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopee', 'tiktok', 'lazada', 'blibli')),
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size_bytes BIGINT,
  review_status TEXT NOT NULL CHECK (review_status IN ('confirmed', 'confirmed_with_issues')) DEFAULT 'confirmed',
  total_orders INT NOT NULL DEFAULT 0,
  total_lines INT NOT NULL DEFAULT 0,
  ready_orders INT NOT NULL DEFAULT 0,
  needs_review_orders INT NOT NULL DEFAULT 0,
  mixed_store_orders INT NOT NULL DEFAULT 0,
  identified_lines INT NOT NULL DEFAULT 0,
  classified_lines INT NOT NULL DEFAULT 0,
  unidentified_lines INT NOT NULL DEFAULT 0,
  unresolved_store_lines INT NOT NULL DEFAULT 0,
  uploaded_by_email TEXT,
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace_intake_batches IS
  'Saved stage-1 marketplace intake review batches, before orders are posted to Scalev.';

CREATE TABLE IF NOT EXISTS marketplace_intake_orders (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES marketplace_intake_batches(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  order_status TEXT NOT NULL CHECK (order_status IN ('ready', 'needs_review')),
  final_source_store_id BIGINT,
  final_store_name TEXT,
  final_store_resolution TEXT NOT NULL CHECK (
    final_store_resolution IN ('single_store', 'dominant_amount', 'unclassified', 'ambiguous')
  ) DEFAULT 'unclassified',
  issue_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  line_count INT NOT NULL DEFAULT 0,
  identified_line_count INT NOT NULL DEFAULT 0,
  classified_line_count INT NOT NULL DEFAULT 0,
  issue_count INT NOT NULL DEFAULT 0,
  is_mixed_store BOOLEAN NOT NULL DEFAULT false,
  has_unidentified BOOLEAN NOT NULL DEFAULT false,
  customer_label TEXT,
  recipient_name TEXT,
  tracking_number TEXT,
  payment_method_label TEXT,
  shipping_provider TEXT,
  delivery_option TEXT,
  order_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_meta JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, external_order_id)
);

COMMENT ON TABLE marketplace_intake_orders IS
  'Order-level marketplace intake review results grouped by marketplace external order id.';

CREATE TABLE IF NOT EXISTS marketplace_intake_order_lines (
  id BIGSERIAL PRIMARY KEY,
  intake_order_id BIGINT NOT NULL REFERENCES marketplace_intake_orders(id) ON DELETE CASCADE,
  line_index INT NOT NULL,
  line_status TEXT NOT NULL CHECK (
    line_status IN ('identified', 'not_identified', 'store_unmapped', 'entity_mismatch')
  ),
  issue_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  mp_sku TEXT,
  mp_product_name TEXT NOT NULL,
  mp_variation TEXT,
  quantity INT NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  detected_custom_id TEXT,
  matched_entity_type TEXT CHECK (matched_entity_type IN ('product', 'variant', 'bundle')),
  matched_entity_key TEXT,
  matched_entity_label TEXT,
  matched_entity_source TEXT,
  matched_scalev_product_id INT,
  matched_scalev_variant_id INT,
  matched_scalev_bundle_id INT,
  matched_rule_id BIGINT,
  mapped_source_store_id BIGINT,
  mapped_store_name TEXT,
  raw_row JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (intake_order_id, line_index)
);

COMMENT ON TABLE marketplace_intake_order_lines IS
  'Line-level marketplace intake review results including exact entity match and mapped Scalev store.';

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_source
  ON marketplace_intake_batches (source_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_business
  ON marketplace_intake_batches (business_code, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_orders_batch
  ON marketplace_intake_orders (batch_id, order_status, external_order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_orders_store
  ON marketplace_intake_orders (batch_id, final_store_name);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_order_lines_order
  ON marketplace_intake_order_lines (intake_order_id, line_status, line_index);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_order_lines_store
  ON marketplace_intake_order_lines (mapped_store_name, detected_custom_id);

ALTER TABLE marketplace_intake_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_intake_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_intake_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_intake_batches_owner_read" ON marketplace_intake_batches;
CREATE POLICY "marketplace_intake_batches_owner_read" ON marketplace_intake_batches
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_batches_owner_manage" ON marketplace_intake_batches;
CREATE POLICY "marketplace_intake_batches_owner_manage" ON marketplace_intake_batches
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_orders_owner_read" ON marketplace_intake_orders;
CREATE POLICY "marketplace_intake_orders_owner_read" ON marketplace_intake_orders
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_orders_owner_manage" ON marketplace_intake_orders;
CREATE POLICY "marketplace_intake_orders_owner_manage" ON marketplace_intake_orders
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_order_lines_owner_read" ON marketplace_intake_order_lines;
CREATE POLICY "marketplace_intake_order_lines_owner_read" ON marketplace_intake_order_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_order_lines_owner_manage" ON marketplace_intake_order_lines;
CREATE POLICY "marketplace_intake_order_lines_owner_manage" ON marketplace_intake_order_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_batches ON marketplace_intake_batches;
CREATE TRIGGER set_updated_at_marketplace_intake_batches
  BEFORE UPDATE ON marketplace_intake_batches
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_orders ON marketplace_intake_orders;
CREATE TRIGGER set_updated_at_marketplace_intake_orders
  BEFORE UPDATE ON marketplace_intake_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_order_lines ON marketplace_intake_order_lines;
CREATE TRIGGER set_updated_at_marketplace_intake_order_lines
  BEFORE UPDATE ON marketplace_intake_order_lines
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
