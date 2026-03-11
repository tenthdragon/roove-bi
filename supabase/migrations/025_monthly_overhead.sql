-- Monthly overhead configuration table
-- Stores a single overhead amount per month (e.g., salaries, rent, utilities)
-- Used in Tren Harian to compute Estimated Net Profit

CREATE TABLE IF NOT EXISTS monthly_overhead (
  id SERIAL PRIMARY KEY,
  year_month TEXT NOT NULL UNIQUE,        -- format: '2026-03'
  amount NUMERIC NOT NULL DEFAULT 0,      -- monthly overhead in Rupiah
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE monthly_overhead ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read monthly_overhead"
  ON monthly_overhead FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owner manage monthly_overhead"
  ON monthly_overhead FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
