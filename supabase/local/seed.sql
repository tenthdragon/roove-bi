-- LOCAL ONLY. Placeholders are real users created by the local Auth Admin API.
-- All Growth samples are explicitly dummy work, not production plans or BI data.
UPDATE public.workspaces SET
  name = CASE slug WHEN 'roove' THEN 'Roove Workspace · Lokal' ELSE 'Apurva Workspace · Lokal' END,
  status = 'active',
  settings = settings || jsonb_build_object('local_development',true,
    'growth_execution_enabled',slug='roove')
WHERE slug IN ('roove','apurva');

INSERT INTO public.profiles(id,email,full_name,role,active_workspace_id) VALUES
  ('{{owner_id}}','owner@roove.test','Owner Lokal','owner','00000000-0000-4000-8000-000000000001'),
  ('{{growth_id}}','growth@roove.test','Growth Lead Lokal','brand_manager','00000000-0000-4000-8000-000000000001'),
  ('{{creative_id}}','creative@roove.test','Creative Lokal','manager','00000000-0000-4000-8000-000000000001'),
  ('{{reviewer_id}}','reviewer@roove.test','Reviewer Lokal','manager','00000000-0000-4000-8000-000000000001')
ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name,
  role=EXCLUDED.role,active_workspace_id=EXCLUDED.active_workspace_id;

INSERT INTO public.workspace_memberships(workspace_id,user_id,role,status,is_default)
SELECT workspace.id,profile.id,CASE WHEN profile.role='owner' THEN 'workspace_owner' ELSE profile.role::text END,
  'active',workspace.slug='roove'
FROM public.workspaces workspace CROSS JOIN public.profiles profile
WHERE workspace.slug IN ('roove','apurva')
  AND profile.email IN ('owner@roove.test','growth@roove.test','creative@roove.test','reviewer@roove.test')
ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',is_default=EXCLUDED.is_default;

INSERT INTO public.workspace_role_permissions(workspace_id,role,permission_key)
SELECT '00000000-0000-4000-8000-000000000001'::uuid,'brand_manager',permission
FROM unnest(ARRAY['tab:growth-work','growth:team-read','growth:manage','growth:update-own',
  'growth:review','growth:decide','growth:weekly-finalize','growth:configure',
  'growth:metrics-read','growth:financial-target-read']) permission
ON CONFLICT DO NOTHING;
INSERT INTO public.workspace_role_permissions(workspace_id,role,permission_key)
SELECT '00000000-0000-4000-8000-000000000001'::uuid,'manager',permission
FROM unnest(ARRAY['tab:growth-work','growth:update-own','growth:review']) permission
ON CONFLICT DO NOTHING;

INSERT INTO public.brands(name,sheet_name,is_active,workspace_id)
SELECT 'Roove Demo','roove-local-demo',true,'00000000-0000-4000-8000-000000000001'
WHERE NOT EXISTS(SELECT 1 FROM public.brands WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND name='Roove Demo');

-- Disable every integration/reference record created by historical migrations.
-- Local launcher also blanks all dotenv integration credentials.
UPDATE public.workspace_integrations SET is_active=false;
UPDATE public.scalev_webhook_businesses SET is_active=false,api_key=NULL;
UPDATE public.scalev_config SET is_active=false;
UPDATE public.sheet_connections SET is_active=false;
UPDATE public.financial_sheet_connections SET is_active=false;
UPDATE public.warehouse_sheet_connections SET is_active=false;

SELECT set_config('request.jwt.claim.sub','{{owner_id}}',true);
SELECT set_config('request.jwt.claims','{"sub":"{{owner_id}}","role":"authenticated"}',true);
SELECT public.growth_configure(
  '00000000-0000-4000-8000-000000000001',NULL,'10000000-0000-4000-8000-000000000001',0,
  gen_random_uuid(),'portfolio','{"name":"Growth Pilot · Data Contoh Lokal"}');
SELECT public.growth_configure(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',0,gen_random_uuid(),'membership',
  '{"user_id":"{{owner_id}}","functions":["growth","creative","acquisition","sales","ceo"],"visibility_mode":"team","managed_functions":["growth","creative","acquisition","sales","ceo"],"company_scope":true}');
SELECT public.growth_configure(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',0,gen_random_uuid(),'membership',
  '{"user_id":"{{growth_id}}","functions":["growth"],"visibility_mode":"team","managed_functions":["creative","acquisition"],"company_scope":true}');
SELECT public.growth_configure(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',0,gen_random_uuid(),'membership',
  '{"user_id":"{{creative_id}}","functions":["creative"],"visibility_mode":"own_or_involved","company_scope":true}');
SELECT public.growth_configure(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000005',0,gen_random_uuid(),'membership',
  '{"user_id":"{{reviewer_id}}","functions":["creative"],"visibility_mode":"own_or_involved","company_scope":true}');

SELECT public.growth_save_record(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',0,gen_random_uuid(),
  '{"kind":"priority","title":"[CONTOH LOKAL] Uji alur kerja Growth","status":"active","pic_id":"{{growth_id}}","payload":{"diagnosis":"Data dummy untuk menguji alur koordinasi; bukan diagnosis bisnis aktual.","success_criteria":"PIC menerima tugas, memberi bukti, lalu reviewer menerima hasil."}}');
SELECT public.growth_save_record(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',0,gen_random_uuid(),
  jsonb_build_object('kind','work','title','[CONTOH LOKAL] Buat aset untuk pengujian',
    'status','assigned','pic_id','{{creative_id}}','reviewer_id','{{reviewer_id}}',
    'parent_id','20000000-0000-4000-8000-000000000001','due_at',now()+interval '7 days',
    'payload',jsonb_build_object('acceptance_criteria','Lampirkan bukti teks/URL dummy dan minta review.')));
SELECT public.growth_save_record(
  '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003',0,gen_random_uuid(),
  '{"kind":"work","title":"[CONTOH LOKAL] Draft pekerjaan berikutnya","status":"draft","pic_id":"{{growth_id}}","payload":{}}');
