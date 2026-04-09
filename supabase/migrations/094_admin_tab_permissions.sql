-- Add default admin sub-tab permissions
-- admin:* keys control which sub-tabs inside the Admin page each role can access
-- Users and Permissions tabs are always owner-only (not in this table)

INSERT INTO role_permissions (role, permission_key) VALUES
  -- admin: all admin sub-tabs
  ('admin',             'admin:daily'),
  ('admin',             'admin:meta'),
  ('admin',             'admin:financial'),
  ('admin',             'admin:warehouse'),
  ('admin',             'admin:sync'),
  ('admin',             'admin:data_ref'),
  ('admin',             'admin:logs'),

  -- direktur_ops: all except financial
  ('direktur_ops',      'admin:daily'),
  ('direktur_ops',      'admin:meta'),
  ('direktur_ops',      'admin:warehouse'),
  ('direktur_ops',      'admin:sync'),
  ('direktur_ops',      'admin:data_ref'),
  ('direktur_ops',      'admin:logs'),

  -- direktur_finance: financial + sync + logs
  ('direktur_finance',  'admin:financial'),
  ('direktur_finance',  'admin:sync'),
  ('direktur_finance',  'admin:logs'),

  -- staf_finance: financial only
  ('staf_finance',      'admin:financial'),

  -- staf_ops: daily + warehouse upload
  ('staf_ops',          'admin:daily'),
  ('staf_ops',          'admin:warehouse'),

  -- brand_manager: daily + meta
  ('brand_manager',     'admin:daily'),
  ('brand_manager',     'admin:meta'),

  -- warehouse_manager: warehouse upload + logs
  ('warehouse_manager', 'admin:warehouse'),
  ('warehouse_manager', 'admin:logs')

ON CONFLICT DO NOTHING;
