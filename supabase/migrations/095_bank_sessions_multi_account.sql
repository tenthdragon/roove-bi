-- ============================================================
-- Support multiple accounts per bank per period
-- Change UNIQUE from (bank, period_label) → (bank, account_no, period_label)
-- Add account_no to bank_transactions for easier filtering
-- ============================================================

-- 1. Drop old unique constraint
ALTER TABLE bank_upload_sessions
  DROP CONSTRAINT IF EXISTS bank_upload_sessions_bank_period_label_key;

-- 2. Ensure account_no is NOT NULL (backfill blanks first)
UPDATE bank_upload_sessions SET account_no = 'UNKNOWN' WHERE account_no IS NULL OR account_no = '';

-- 3. Add new unique constraint (skip if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_upload_sessions_bank_acct_period_key'
  ) THEN
    ALTER TABLE bank_upload_sessions
      ADD CONSTRAINT bank_upload_sessions_bank_acct_period_key
      UNIQUE (bank, account_no, period_label);
  END IF;
END $$;

-- 4. Add account_no column to bank_transactions
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS account_no TEXT;

-- 5. Backfill account_no from sessions
UPDATE bank_transactions bt
  SET account_no = bus.account_no
  FROM bank_upload_sessions bus
  WHERE bt.session_id = bus.id AND (bt.account_no IS NULL OR bt.account_no = '');

-- 6. Index for filtering
CREATE INDEX IF NOT EXISTS bank_txn_account_idx ON bank_transactions (account_no);
