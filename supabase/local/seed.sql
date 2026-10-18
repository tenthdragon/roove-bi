-- LOCAL ONLY. Placeholders are real users created by the local Auth Admin API.
-- No unfinished feature records or production BI data are seeded.
UPDATE public.workspaces SET
  name = CASE slug WHEN 'roove' THEN 'Roove Workspace · Lokal' ELSE 'Apurva Workspace · Lokal' END,
  status = 'active',
  settings = settings || jsonb_build_object('local_development',true)
WHERE slug IN ('roove','apurva');

INSERT INTO public.profiles(id,email,full_name,role,active_workspace_id) VALUES
  ('{{owner_id}}','owner@roove.test','Owner Lokal','owner','00000000-0000-4000-8000-000000000001')
ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,
  role=EXCLUDED.role,active_workspace_id=EXCLUDED.active_workspace_id;

INSERT INTO public.workspace_memberships(workspace_id,user_id,role,status,is_default)
SELECT workspace.id,profile.id,CASE WHEN profile.role='owner' THEN 'workspace_owner' ELSE profile.role::text END,
  'active',workspace.slug='roove'
FROM public.workspaces workspace CROSS JOIN public.profiles profile
WHERE workspace.slug IN ('roove','apurva')
  AND profile.email='owner@roove.test'
ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',is_default=EXCLUDED.is_default;

-- Disable every integration/reference record created by historical migrations.
-- Local launcher also blanks all dotenv integration credentials.
UPDATE public.workspace_integrations SET is_active=false;
UPDATE public.scalev_webhook_businesses SET is_active=false,api_key=NULL;
UPDATE public.scalev_config SET is_active=false;
UPDATE public.sheet_connections SET is_active=false;
UPDATE public.financial_sheet_connections SET is_active=false;
UPDATE public.warehouse_sheet_connections SET is_active=false;

