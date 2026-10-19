DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE TYPE public.user_role AS ENUM ('owner','admin','pending','advertiser','brand_manager');
CREATE TABLE public.workspaces(id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'active');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role public.user_role NOT NULL,email text,
 active_workspace_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.workspace_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid REFERENCES public.workspaces(id),user_id uuid REFERENCES public.profiles(id),role text,
 status text DEFAULT 'active',is_default boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
 UNIQUE(workspace_id,user_id));
CREATE UNIQUE INDEX membership_default ON public.workspace_memberships(user_id) WHERE is_default AND status='active';
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='owner');
$$;
CREATE FUNCTION public.workspace_has_role(workspace uuid,roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT public.is_platform_owner() OR EXISTS(SELECT 1 FROM public.workspace_memberships
  WHERE workspace_id=workspace AND user_id=auth.uid() AND status='active' AND role=ANY(roles));
$$;
CREATE FUNCTION public.expect_access_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF position(expected IN SQLERRM)=0 THEN RAISE EXCEPTION 'Wrong rejection: %',SQLERRM; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Statement unexpectedly allowed: %',statement;
END $$;
INSERT INTO public.workspaces(id) VALUES
 ('00000000-0000-4000-8000-000000000101'),('00000000-0000-4000-8000-000000000102');
INSERT INTO public.profiles(id,role,email)
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role::public.user_role,'user-'||n||'@roove.test'
 FROM (VALUES(1,'owner'),(2,'admin'),(3,'advertiser'),(4,'pending'),(5,'pending'),(6,'advertiser'),(7,'advertiser'),(8,'pending'),(9,'pending')) p(n,role);
INSERT INTO public.workspace_memberships(workspace_id,user_id,role,status)
 SELECT ('00000000-0000-4000-8000-'||lpad(w::text,12,'0'))::uuid,
 ('00000000-0000-4000-8000-'||lpad(u::text,12,'0'))::uuid,role,'active'
 FROM (VALUES(101,2,'workspace_owner'),(102,3,'advertiser'),(101,4,'pending'),(101,6,'pending'),(102,6,'advertiser'),(101,7,'advertiser'),(101,9,'pending')) p(w,u,role);

-- MIGRATION

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.list_workspace_users('00000000-0000-4000-8000-000000000101') u WHERE u->>'access_request_scope'='unassigned') THEN
  RAISE EXCEPTION 'Workspace owner saw unassigned global signup'; END IF;
END $$;
SELECT public.expect_access_error($q$SELECT * FROM public.list_workspace_users('00000000-0000-4000-8000-000000000102')$q$,'Hanya owner');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000005','set_role','advertiser')$q$,'tidak terdaftar');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','reject')$q$,'akses sendiri');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000007','reject')$q$,'Hanya permintaan pending');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','made_up_role')$q$,'Role tidak valid');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','advertiser');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000009','set_role','workspace_owner');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000006','reject');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000006','reject');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000006','set_role','advertiser')$q$,'sudah ditolak');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.list_workspace_users('00000000-0000-4000-8000-000000000101') u WHERE u->>'id'='00000000-0000-4000-8000-000000000006') THEN
  RAISE EXCEPTION 'Rejected request still listed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT public.expect_access_error($q$SELECT * FROM public.list_workspace_users('00000000-0000-4000-8000-000000000102')$q$,'Hanya owner');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000007','reject')$q$,'Hanya owner');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.list_workspace_users('00000000-0000-4000-8000-000000000101') u WHERE u->>'access_request_scope'='unassigned')<>2 THEN
  RAISE EXCEPTION 'Platform owner cannot see unassigned signup requests'; END IF;
END $$;
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000005','set_role','advertiser');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000008','reject');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','pending');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.list_workspace_users('00000000-0000-4000-8000-000000000101') u WHERE u->>'id'='00000000-0000-4000-8000-000000000004' AND u->>'role'='pending') THEN
  RAISE EXCEPTION 'Revoked request cannot be managed'; END IF;
END $$;
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004','set_role','advertiser');
-- Reopening a rejected request requires an explicit new invitation; a stale
-- approval above remains rejected. Other workspace memberships are retained.
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000006','invite','admin');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000003','invite','brand_manager');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT role::text FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000004')<>'advertiser'
  OR (SELECT active_workspace_id FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000004')<>'00000000-0000-4000-8000-000000000101'::uuid THEN
  RAISE EXCEPTION 'Approval did not clear global pending login gate'; END IF;
 IF (SELECT role::text FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000009')<>'admin' THEN RAISE EXCEPTION 'Workspace owner gained platform ownership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id='00000000-0000-4000-8000-000000000005' AND role='advertiser' AND status='active' AND is_default) THEN RAISE EXCEPTION 'Orphan signup not assigned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id='00000000-0000-4000-8000-000000000006' AND workspace_id='00000000-0000-4000-8000-000000000102' AND role='advertiser' AND status='active') THEN RAISE EXCEPTION 'Rejection modified another workspace'; END IF;
 IF (SELECT count(*) FROM public.profiles)<>9 THEN RAISE EXCEPTION 'Rejection deleted a global identity'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id='00000000-0000-4000-8000-000000000006' AND workspace_id='00000000-0000-4000-8000-000000000101' AND role='admin' AND status='active') THEN RAISE EXCEPTION 'Explicit reinvitation did not reopen request'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id='00000000-0000-4000-8000-000000000008' AND status='suspended' AND NOT is_default) THEN RAISE EXCEPTION 'Unassigned rejection not archived'; END IF;
 IF has_function_privilege('anon','public.manage_workspace_user_access(uuid,uuid,text,text)','EXECUTE') OR has_function_privilege('anon','public.list_workspace_users(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous access granted'; END IF;
END $$;
SELECT 'PASS: pending approval, rejection, unassigned signup discovery, tenant boundaries, replay, revocation, login compatibility and anonymous denial';
