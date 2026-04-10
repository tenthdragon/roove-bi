-- Seed missing permissions for the Financial Report submenu.
-- Parent tab is required for the menu group, and child tabs control page access.

INSERT INTO role_permissions (role, permission_key) VALUES
  ('admin', 'tab:financial-report'),
  ('admin', 'tab:cashflow'),
  ('admin', 'tab:financial-settings'),

  ('direktur_ops', 'tab:financial-report'),
  ('direktur_ops', 'tab:cashflow'),

  ('direktur_finance', 'tab:financial-report'),
  ('direktur_finance', 'tab:cashflow'),
  ('direktur_finance', 'tab:financial-settings'),

  ('staf_finance', 'tab:financial-report'),
  ('staf_finance', 'tab:cashflow'),
  ('staf_finance', 'tab:financial-settings')
ON CONFLICT DO NOTHING;
