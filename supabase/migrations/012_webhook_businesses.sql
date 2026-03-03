-- 012: Webhook businesses table for multi-business Scalev webhook support
-- Stores business code, name, and webhook secret so admin can manage via UI

CREATE TABLE IF NOT EXISTS scalev_webhook_businesses (
  id SERIAL PRIMARY KEY,
  business_code TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups during webhook verification
CREATE INDEX IF NOT EXISTS idx_swb_active ON scalev_webhook_businesses (is_active) WHERE is_active = true;

COMMENT ON TABLE scalev_webhook_businesses IS 'Registered Scalev businesses for webhook verification';
COMMENT ON COLUMN scalev_webhook_businesses.business_code IS 'Short code e.g. RTI, RLB, RLT';
COMMENT ON COLUMN scalev_webhook_businesses.webhook_secret IS 'HMAC-SHA256 secret from Scalev dashboard';
