RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$;
CREATE TABLE public.brands(id integer PRIMARY KEY,workspace_id uuid REFERENCES public.workspaces(id),name text);
INSERT INTO brands VALUES(1,'00000000-0000-4000-8000-000000000101','A'),(2,'00000000-0000-4000-8000-000000000101','B'),(3,'00000000-0000-4000-8000-000000000102','Foreign');
INSERT INTO profiles(id,role) VALUES('00000000-0000-4000-8000-000000000011','admin');
INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000011','workspace_owner');
-- The disposable authorization fixture has no Meta data; the full projection
-- and real invalidation triggers are covered in the local report parity test.
CREATE FUNCTION public.bump_meta_ad_report_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
-- BRAND_MIGRATION

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[2,1,2]);
SELECT expect_access_error($q$SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[1,3])$q$,'luar workspace');
SELECT expect_access_error($q$SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[NULL]::integer[])$q$,'tidak valid');
SELECT expect_access_error($q$SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000003',ARRAY[1])$q$,'bukan advertiser aktif');
SELECT expect_access_error($q$SELECT * FROM workspace_advertiser_brands$q$,'permission denied');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
SELECT expect_access_error($q$SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[1,2])$q$,'Hanya owner');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
-- This user owns workspace 102 only.
SELECT expect_access_error($q$SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[1])$q$,'Hanya owner');
SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000003',ARRAY[3]);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT array_agg(brand_id ORDER BY brand_id) FROM workspace_advertiser_brands WHERE user_id='00000000-0000-4000-8000-000000000004')<>ARRAY[1,2] THEN RAISE EXCEPTION 'Atomic multi-brand assignment failed'; END IF;
 IF has_table_privilege('authenticated','workspace_advertiser_brands','INSERT') OR has_function_privilege('anon','set_workspace_advertiser_brands(uuid,uuid,integer[])','EXECUTE') OR has_function_privilege('authenticated','get_meta_brand_overview_report_scoped(uuid,date,date,jsonb,integer[])','EXECUTE') THEN RAISE EXCEPTION 'Permission leak'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_advertiser_brand_audit WHERE after_brand_ids=ARRAY[1,2]) THEN RAISE EXCEPTION 'Missing audit'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
SET ROLE authenticated;
SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[]::integer[]);
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM workspace_advertiser_brands WHERE user_id='00000000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'Empty scope did not revoke all'; END IF; END $$;
SET ROLE authenticated;
SELECT set_workspace_advertiser_brands('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',ARRAY[1]);
SELECT manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','brand_manager');
SELECT manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','advertiser');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workspace_advertiser_brands WHERE user_id='00000000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'Role cycling resurrected grants'; END IF;
 IF (SELECT count(*) FROM workspace_advertiser_brands WHERE workspace_id='00000000-0000-4000-8000-000000000102')<>1 THEN RAISE EXCEPTION 'Other tenant changed'; END IF;
END $$;
SELECT 'PASS: multi-brand allocation, empty/revoked grants, tenant isolation, owner-only writes, anonymous denial, role lifecycle and audit';
