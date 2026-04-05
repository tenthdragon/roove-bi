-- ============================================================
-- Add warehouse roles + per-user telegram_chat_id
-- ============================================================

-- New roles
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'direktur_operasional';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'warehouse_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ppic';

-- Per-user Telegram chat ID for notifications
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

COMMENT ON COLUMN profiles.telegram_chat_id IS 'Telegram chat ID for receiving warehouse notifications. Set via admin page.';
