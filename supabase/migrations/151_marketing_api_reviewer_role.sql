-- Add a dedicated role for external/internal platform reviewers who should
-- only access Admin > Marketing APIs without broader dashboard exposure.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketing_api_reviewer';

INSERT INTO role_permissions (role, permission_key)
VALUES ('marketing_api_reviewer', 'admin:meta')
ON CONFLICT DO NOTHING;
