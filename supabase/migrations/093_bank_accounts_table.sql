-- ============================================================
-- Bank Accounts Registry
-- Daftar rekening bank yang terdaftar per bisnis
-- ============================================================

CREATE TABLE IF NOT EXISTS bank_accounts (
  id           UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  bank         TEXT    NOT NULL,               -- BCA, BRI, MANDIRI, dll
  account_no   TEXT    NOT NULL,
  account_name TEXT    NOT NULL,               -- nama pemilik rekening
  business_name TEXT   NOT NULL,               -- nama bisnis yang menggunakan
  description  TEXT,                           -- keterangan tambahan (opsional)
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  created_by   UUID REFERENCES auth.users(id),
  UNIQUE (bank, account_no)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_bank_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_bank_accounts_updated_at();

-- RLS
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_bank_accounts" ON bank_accounts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_bank_accounts" ON bank_accounts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_bank_accounts" ON bank_accounts FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_bank_accounts" ON bank_accounts FOR DELETE USING (auth.role() = 'authenticated');
