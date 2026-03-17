-- Tax Formula Config: per-channel PPN formula selection
-- Allows configuring different PPN calculation methods per store type:
--   'divisor'        → BT = price / (1 + rate/100)     e.g. price / 1.11
--   'dpp_nilai_lain' → BT = price × rate / (rate + 1)  e.g. price × 11/12

CREATE TABLE IF NOT EXISTS tax_formula_config (
  store_type TEXT PRIMARY KEY,           -- 'marketplace', 'scalev', 'reseller'
  formula TEXT NOT NULL DEFAULT 'divisor', -- 'divisor' | 'dpp_nilai_lain'
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default config
INSERT INTO tax_formula_config (store_type, formula) VALUES
  ('marketplace', 'divisor'),
  ('scalev', 'dpp_nilai_lain'),
  ('reseller', 'divisor')
ON CONFLICT (store_type) DO NOTHING;

-- Grant access for service role
GRANT ALL ON tax_formula_config TO service_role;
GRANT SELECT ON tax_formula_config TO authenticated;
