-- ============================================================
-- Transaction Tags — auto-classify + manual override
-- ============================================================

-- tag = active tag (displayed/filtered)
-- tag_auto = original auto-assigned tag (never changes, for audit)
-- tag_updated_at / tag_updated_by = manual override tracking
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'n/a';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tag_auto TEXT DEFAULT 'n/a';
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tag_updated_at TIMESTAMPTZ;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tag_updated_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS bank_txn_tag_idx ON bank_transactions (tag);

-- Allow authenticated users to update tags
CREATE POLICY "auth_update_txn" ON bank_transactions FOR UPDATE USING (auth.role() = 'authenticated');
