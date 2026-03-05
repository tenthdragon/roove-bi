-- ══════════════════════════════════════════════════════════════
-- 013: Tax Rates table + Brand keywords for dynamic detection
-- ══════════════════════════════════════════════════════════════

-- ── 1. Tax Rates (PPN etc.) ──
-- Similar pattern to marketplace_commission_rates:
-- supports effective dates so rate changes are tracked historically.
CREATE TABLE IF NOT EXISTS tax_rates (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                 -- e.g. "PPN"
  rate          NUMERIC NOT NULL,              -- percentage value e.g. 11 for 11%
  effective_from DATE NOT NULL DEFAULT '2024-01-01',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, effective_from)
);

-- Seed current PPN rate
INSERT INTO tax_rates (name, rate, effective_from) VALUES
  ('PPN', 11, '2024-01-01')
ON CONFLICT (name, effective_from) DO NOTHING;

-- ── 2. Brand keywords column ──
-- Stores comma-separated keywords used to detect brand from product name.
-- e.g. "osgard" or "purvu,secret" or "drhyun,dr hyun"
-- NULL means use the brand name itself (lowercased) as the single keyword.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS keywords TEXT;

-- Seed keywords for existing brands (matching current hardcoded logic)
UPDATE brands SET keywords = 'osgard' WHERE LOWER(name) = 'osgard' AND keywords IS NULL;
UPDATE brands SET keywords = 'purvu,secret' WHERE LOWER(name) = 'purvu' AND keywords IS NULL;
UPDATE brands SET keywords = 'pluve' WHERE LOWER(name) = 'pluve' AND keywords IS NULL;
UPDATE brands SET keywords = 'globite' WHERE LOWER(name) = 'globite' AND keywords IS NULL;
UPDATE brands SET keywords = 'drhyun,dr hyun' WHERE LOWER(name) = 'drhyun' AND keywords IS NULL;
UPDATE brands SET keywords = 'calmara' WHERE LOWER(name) = 'calmara' AND keywords IS NULL;
UPDATE brands SET keywords = 'almona' WHERE LOWER(name) = 'almona' AND keywords IS NULL;
UPDATE brands SET keywords = 'yuv' WHERE LOWER(name) = 'yuv' AND keywords IS NULL;
UPDATE brands SET keywords = 'veminine' WHERE LOWER(name) = 'veminine' AND keywords IS NULL;
UPDATE brands SET keywords = 'orelif' WHERE LOWER(name) = 'orelif' AND keywords IS NULL;
UPDATE brands SET keywords = 'roove,shaker,jam tangan' WHERE LOWER(name) = 'roove' AND keywords IS NULL;
