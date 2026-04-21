CREATE TABLE IF NOT EXISTS public.warehouse_rts_verifications (
  id BIGSERIAL PRIMARY KEY,
  scalev_order_id INT NOT NULL REFERENCES public.scalev_orders(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  business_code TEXT,
  order_status TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('pre_go_live', 'post_go_live')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  expected_total_qty NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scalev_order_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_rts_verifications_status
  ON public.warehouse_rts_verifications(status, triggered_at DESC);

CREATE TABLE IF NOT EXISTS public.warehouse_rts_verification_items (
  id BIGSERIAL PRIMARY KEY,
  verification_id BIGINT NOT NULL REFERENCES public.warehouse_rts_verifications(id) ON DELETE CASCADE,
  warehouse_product_id INT NOT NULL REFERENCES public.warehouse_products(id) ON DELETE RESTRICT,
  scalev_product_summary TEXT,
  expected_qty NUMERIC NOT NULL DEFAULT 0,
  restock_qty NUMERIC,
  damaged_qty NUMERIC,
  target_batch_id INT REFERENCES public.warehouse_batches(id) ON DELETE SET NULL,
  target_batch_code_snapshot TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (verification_id, warehouse_product_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_rts_verification_items_verification
  ON public.warehouse_rts_verification_items(verification_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_rts_verification_items_product
  ON public.warehouse_rts_verification_items(warehouse_product_id);

ALTER TABLE public.warehouse_rts_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_rts_verification_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_rts_verifications_read" ON public.warehouse_rts_verifications;
CREATE POLICY "warehouse_rts_verifications_read"
  ON public.warehouse_rts_verifications
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "warehouse_rts_verifications_manage" ON public.warehouse_rts_verifications;
CREATE POLICY "warehouse_rts_verifications_manage"
  ON public.warehouse_rts_verifications
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "warehouse_rts_verification_items_read" ON public.warehouse_rts_verification_items;
CREATE POLICY "warehouse_rts_verification_items_read"
  ON public.warehouse_rts_verification_items
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "warehouse_rts_verification_items_manage" ON public.warehouse_rts_verification_items;
CREATE POLICY "warehouse_rts_verification_items_manage"
  ON public.warehouse_rts_verification_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.warehouse_rts_verifications IS
  'Queue verifikasi retur RTS. Barang returned tidak otomatis kembali ke stok, tetapi menunggu pengecekan fisik gudang.';

COMMENT ON TABLE public.warehouse_rts_verification_items IS
  'Baris produk per verifikasi RTS, termasuk qty expected, qty layak restock, dan batch tujuan saat verifikasi selesai.';
