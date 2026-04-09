-- ============================================================
-- Seed bank accounts for 4 businesses
-- RTI, RLT, RLB, JHN — each has BCA, BRI, Mandiri
-- ============================================================

INSERT INTO bank_accounts (bank, account_no, account_name, business_name, is_active)
VALUES
  -- RTI (Roove Tijara Internasional)
  ('Mandiri', '1310000888661', 'RTI Mandiri',  'RTI', true),
  ('BRI',     '38901000959568','RTI BRI',       'RTI', true),
  ('BCA',     '4377662333',    'RTI BCA',       'RTI', true),

  -- RLT
  ('Mandiri', '1310001247776', 'RLT Mandiri',  'RLT', true),
  ('BRI',     '38901001334305','RLT BRI',       'RLT', true),
  ('BCA',     '4375557020',    'RLT BCA',       'RLT', true),

  -- RLB
  ('Mandiri', '1310001236662', 'RLB Mandiri',  'RLB', true),
  ('BRI',     '38901001252309','RLB BRI',       'RLB', true),
  ('BCA',     '4377779010',    'RLB BCA',       'RLB', true),

  -- JHN (Jejak Herba Nusantara)
  ('Mandiri', '1310055597977', 'JHN Mandiri',  'JHN', true),
  ('BRI',     '38901001038569','JHN BRI',       'JHN', true),
  ('BCA',     '4377288989',    'JHN BCA',       'JHN', true)
ON CONFLICT (bank, account_no) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  account_name  = EXCLUDED.account_name,
  is_active     = true;
