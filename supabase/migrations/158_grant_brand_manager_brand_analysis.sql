-- Ensure Brand Manager can access the Brand Analysis dashboard tab.
INSERT INTO role_permissions (role, permission_key)
VALUES ('brand_manager', 'tab:brand-analysis')
ON CONFLICT (role, permission_key) DO NOTHING;
