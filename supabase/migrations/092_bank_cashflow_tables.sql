-- ============================================================
-- Bank Cash Flow Tables
-- Upload mutasi rekening BCA, BRI, Mandiri → RTI Cash Flow
-- ============================================================

-- Upload sessions: one row per bank per period upload
CREATE TABLE IF NOT EXISTS bank_upload_sessions (
  id                UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  bank              TEXT    NOT NULL CHECK (bank IN ('BCA', 'BRI', 'MANDIRI')),
  period_label      TEXT    NOT NULL,          -- e.g. "APRIL 2026"
  period_start      DATE,
  period_end        DATE,
  account_no        TEXT,
  opening_balance   NUMERIC(18, 2),
  closing_balance   NUMERIC(18, 2),
  total_credit      NUMERIC(18, 2),
  total_debit       NUMERIC(18, 2),
  transaction_count INT,
  uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by       UUID REFERENCES auth.users(id),
  UNIQUE (bank, period_label)
);

-- Individual transaction rows
CREATE TABLE IF NOT EXISTS bank_transactions (
  id               UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id       UUID    REFERENCES bank_upload_sessions(id) ON DELETE CASCADE,
  bank             TEXT    NOT NULL CHECK (bank IN ('BCA', 'BRI', 'MANDIRI')),
  period_label     TEXT    NOT NULL,
  transaction_date DATE    NOT NULL,
  transaction_time TIME,
  description      TEXT,
  credit_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
  debit_amount     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  running_balance  NUMERIC(18, 2)
);

CREATE INDEX IF NOT EXISTS bank_txn_date_idx    ON bank_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS bank_txn_bank_idx    ON bank_transactions (bank);
CREATE INDEX IF NOT EXISTS bank_txn_session_idx ON bank_transactions (session_id);
CREATE INDEX IF NOT EXISTS bank_txn_period_idx  ON bank_transactions (period_label);

-- RLS
ALTER TABLE bank_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_sessions" ON bank_upload_sessions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_sessions" ON bank_upload_sessions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_sessions" ON bank_upload_sessions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_sessions" ON bank_upload_sessions FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "auth_select_txn" ON bank_transactions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_txn" ON bank_transactions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_txn" ON bank_transactions FOR DELETE USING (auth.role() = 'authenticated');
