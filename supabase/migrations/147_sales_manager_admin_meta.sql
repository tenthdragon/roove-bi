-- Grant Meta admin capabilities to sales_manager so WABA template management
-- uses the same permission gate as the existing UI and API routes.

INSERT INTO role_permissions (role, permission_key)
VALUES ('sales_manager', 'admin:meta')
ON CONFLICT DO NOTHING;
