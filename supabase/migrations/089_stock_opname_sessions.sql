-- Migration 089: Stock Opname Sessions
-- Adds session tracking for the stock opname workflow:
-- counting → reviewing → completed/canceled

CREATE TABLE warehouse_stock_opname_sessions (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('RTI','RLB','JHN','RLT')),
  warehouse TEXT NOT NULL DEFAULT 'BTN',
  opname_date DATE NOT NULL,
  opname_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'counting'
    CHECK (status IN ('counting','reviewing','completed','canceled')),
  created_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity, opname_date, opname_label)
);

-- Link existing warehouse_stock_opname rows to sessions
ALTER TABLE warehouse_stock_opname
  ADD COLUMN IF NOT EXISTS session_id INT REFERENCES warehouse_stock_opname_sessions(id),
  ADD COLUMN IF NOT EXISTS warehouse_product_id INT REFERENCES warehouse_products(id);

-- Index for quick session lookups
CREATE INDEX IF NOT EXISTS idx_wso_session ON warehouse_stock_opname(session_id);
CREATE INDEX IF NOT EXISTS idx_wso_sessions_status ON warehouse_stock_opname_sessions(status);

-- RLS
ALTER TABLE warehouse_stock_opname_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage SO sessions"
  ON warehouse_stock_opname_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
