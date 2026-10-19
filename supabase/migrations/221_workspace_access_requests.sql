BEGIN;

-- Signup creates a global pending profile before a workspace is assigned.
-- Only platform owners may see those unassigned requests. Workspace owners
-- see requests/members belonging to their own workspace only.
CREATE OR REPLACE FUNCTION public.list_workspace_users(p_workspace_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.workspace_has_role(p_workspace_id,ARRAY['workspace_owner']) THEN
  RAISE EXCEPTION 'Hanya owner workspace yang bisa melihat daftar user.';
 END IF;
 RETURN QUERY
 SELECT to_jsonb(p)||jsonb_build_object(
   'role',CASE WHEN p.role::text='pending' THEN 'pending' WHEN wm.role='workspace_owner' THEN 'owner' ELSE COALESCE(wm.role,p.role::text) END,
   'access_request_scope',CASE WHEN wm.id IS NULL THEN 'unassigned' ELSE 'workspace' END)
 FROM public.profiles p
 LEFT JOIN public.workspace_memberships wm ON wm.user_id=p.id AND wm.workspace_id=p_workspace_id
 WHERE (wm.status='active' OR (wm.status='invited' AND wm.role='pending'))
 OR (public.is_platform_owner() AND p.role::text='pending'
     AND NOT EXISTS(SELECT 1 FROM public.workspace_memberships other WHERE other.user_id=p.id))
 ORDER BY COALESCE(wm.created_at,p.created_at),p.id;
END $$;

-- Keep approval/rejection atomic and serialize against each other by locking
-- the target profile. Rejection archives the request, never deletes an auth
-- identity or memberships in other workspaces.
CREATE OR REPLACE FUNCTION public.manage_workspace_user_access(
 p_workspace_id uuid,p_user_id uuid,p_action text,p_role text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 target public.profiles;
 member public.workspace_memberships;
 platform_owner boolean;
 unassigned boolean;
 was_pending boolean;
 next_status text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.workspace_has_role(p_workspace_id,ARRAY['workspace_owner']) THEN
  RAISE EXCEPTION 'Hanya owner workspace yang bisa mengelola akses user.';
 END IF;
 IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'Anda tidak dapat mengubah akses sendiri.'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('set_role','reject','invite') THEN RAISE EXCEPTION 'Aksi akses tidak valid.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND status IN ('active','provisioning')) THEN
  RAISE EXCEPTION 'Workspace tidak tersedia.';
 END IF;
 IF p_action IN ('set_role','invite') AND (p_role IS NULL OR p_role NOT IN (
  'workspace_owner','admin','advertiser','marketing_api_reviewer','direktur_ops','staf_ops',
  'direktur_finance','staf_finance','brand_manager','sales_manager','warehouse_manager','ppic_manager',
  'pending','finance','staff','direktur_operasional','ppic'
 )) THEN RAISE EXCEPTION 'Role tidak valid.'; END IF;

 SELECT * INTO target FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profil user tidak ditemukan.'; END IF;
 IF target.role::text='owner' THEN RAISE EXCEPTION 'Akses platform owner tidak dapat diubah dari workspace.'; END IF;
 platform_owner:=public.is_platform_owner();
 SELECT * INTO member FROM public.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
 unassigned:=member.id IS NULL AND target.role::text='pending'
  AND NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id=p_user_id);
 IF member.id IS NULL AND NOT (platform_owner AND unassigned) AND p_action<>'invite' THEN
  RAISE EXCEPTION 'User tidak terdaftar di workspace aktif.';
 END IF;
 IF member.id IS NOT NULL AND member.status='suspended' AND p_action<>'invite' THEN
  IF p_action='reject' AND member.role='pending' THEN RETURN jsonb_build_object('success',true,'rejected',true); END IF;
  RAISE EXCEPTION 'Permintaan sudah ditolak atau akses ditangguhkan. Muat ulang daftar user.';
 END IF;
 IF member.id IS NOT NULL AND member.status NOT IN ('active','invited') AND p_action<>'invite' THEN
  RAISE EXCEPTION 'Status membership tidak valid.';
 END IF;
 was_pending:=target.role::text='pending' OR unassigned OR COALESCE(member.role='pending',false);
 IF p_action='reject' THEN
  IF NOT was_pending THEN RAISE EXCEPTION 'Hanya permintaan pending yang dapat ditolak.'; END IF;
  IF unassigned THEN
   INSERT INTO public.workspace_memberships(workspace_id,user_id,role,status,is_default)
   VALUES(p_workspace_id,p_user_id,'pending','suspended',false);
  ELSE
   UPDATE public.workspace_memberships SET role='pending',status='suspended',is_default=false,updated_at=now() WHERE id=member.id;
  END IF;
  RETURN jsonb_build_object('success',true,'rejected',true);
 END IF;

 next_status:=CASE WHEN p_role='pending' THEN 'invited' ELSE 'active' END;
 IF member.id IS NULL THEN
  INSERT INTO public.workspace_memberships(workspace_id,user_id,role,status,is_default)
  VALUES(p_workspace_id,p_user_id,p_role,next_status,p_role<>'pending'
   AND NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id=p_user_id AND status='active' AND is_default));
 ELSE
  UPDATE public.workspace_memberships SET role=p_role,status=next_status,
   is_default=CASE WHEN p_role='pending' THEN false ELSE is_default END,updated_at=now()
  WHERE id=member.id;
 END IF;
 -- A legacy global pending profile is a separate login gate. Clear it only
 -- when granting access; workspace ownership never grants platform ownership.
 IF target.role::text='pending' AND p_role<>'pending' THEN
  UPDATE public.profiles SET role=(CASE WHEN p_role='workspace_owner' THEN 'admin' ELSE p_role END)::public.user_role,
   active_workspace_id=p_workspace_id,updated_at=now() WHERE id=p_user_id;
 END IF;
 RETURN jsonb_build_object('success',true,'approved',was_pending AND p_role<>'pending','role',p_role);
END $$;

REVOKE ALL ON FUNCTION public.list_workspace_users(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.manage_workspace_user_access(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_workspace_users(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manage_workspace_user_access(uuid,uuid,text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
