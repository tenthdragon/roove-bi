BEGIN;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'advertiser';

-- Roles and permission keys are text here, so the new enum value is not used
-- until this transaction commits. Never grant the parent Marketing Channel or
-- admin:meta: advertisers can read Meta Ads without finance or admin access.
INSERT INTO public.role_permissions (role, permission_key)
VALUES ('advertiser', 'tab:meta-funnels')
ON CONFLICT DO NOTHING;

INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
SELECT id, 'advertiser', 'tab:meta-funnels'
FROM public.workspaces
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
