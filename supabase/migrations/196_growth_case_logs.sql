BEGIN;
-- P0.1 is independent of the preserved portfolio/mandate P0 model.
CREATE TABLE public.growth_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','solved')),
 problem jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
 attempts jsonb NOT NULL CHECK(jsonb_typeof(attempts)='array' AND jsonb_array_length(attempts) BETWEEN 1 AND 50),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX growth_cases_owner_workspace ON public.growth_cases(workspace_id,owner_id,updated_at DESC);
ALTER TABLE public.growth_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_cases FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.growth_cases TO authenticated;
GRANT ALL ON public.growth_cases TO service_role;
CREATE POLICY growth_cases_read ON public.growth_cases FOR SELECT TO authenticated USING (
 owner_id=auth.uid() AND public.growth_has_permission(workspace_id,'tab:growth-work'));

CREATE FUNCTION public.growth_case_document_valid(n jsonb,c uuid,depth integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE child jsonb; k text; t text:=n->>'type';
BEGIN
 IF depth>20 OR n IS NULL OR jsonb_typeof(n)<>'object' OR length(n::text)>200000 THEN RETURN false; END IF;
 IF t IS NULL OR t NOT IN ('doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','image','table','tableRow','tableCell','tableHeader') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(n) key WHERE key NOT IN ('type','text','attrs','marks','content')) THEN RETURN false; END IF;
 IF n ? 'text' AND (t<>'text' OR jsonb_typeof(n->'text')<>'string') THEN RETURN false; END IF;
 IF n ? 'attrs' THEN
  IF jsonb_typeof(n->'attrs')<>'object' THEN RETURN false; END IF;
  FOR k IN SELECT jsonb_object_keys(n->'attrs') LOOP
   IF NOT ((t='image' AND k IN ('src','alt','title','width','height')) OR (t IN ('tableCell','tableHeader') AND k IN ('colspan','rowspan','colwidth')) OR (t='heading' AND k='level') OR (t='orderedList' AND k IN ('start','type'))) THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF t='image' AND coalesce(n->'attrs'->>'src','') !~ ('^/api/growth-cases/'||c::text||'/images/[0-9a-f-]{36}\.(png|jpg|webp|gif)$') THEN RETURN false; END IF;
 IF n ? 'marks' THEN
  IF jsonb_typeof(n->'marks')<>'array' THEN RETURN false; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(n->'marks') LOOP
   IF jsonb_typeof(child)<>'object' OR coalesce(child->>'type','') NOT IN ('bold','italic','strike','code','underline') OR EXISTS(SELECT 1 FROM jsonb_object_keys(child) key WHERE key<>'type') THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF n ? 'content' THEN
  IF jsonb_typeof(n->'content')<>'array' THEN RETURN false; END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(n->'content') LOOP
   IF NOT public.growth_case_document_valid(child,c,depth+1) THEN RETURN false; END IF;
  END LOOP;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.growth_case_create(w uuid,c uuid,a uuid) RETURNS public.growth_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.growth_cases; d jsonb:='{"type":"doc","content":[{"type":"paragraph"}]}';
BEGIN
 IF auth.uid() IS NULL OR NOT public.growth_has_permission(w,'tab:growth-work') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 INSERT INTO public.growth_cases(id,workspace_id,owner_id,title,attempts) VALUES(c,w,auth.uid(),'Kasus baru',jsonb_build_array(jsonb_build_object('id',a,'hypothesis',d,'action',d,'result',d))) RETURNING * INTO r;
 RETURN r;
END $$;

CREATE FUNCTION public.growth_case_save(w uuid,c uuid,expected integer,t text,s text,p jsonb,a jsonb) RETURNS public.growth_cases
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.growth_cases; attempt jsonb; old_attempt jsonb; i integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.growth_has_permission(w,'tab:growth-work') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT * INTO r FROM public.growth_cases WHERE id=c AND workspace_id=w AND owner_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF expected IS NULL OR r.version<>expected THEN RAISE EXCEPTION 'Conflict: kasus sudah diubah. Muat ulang sebelum menyimpan.'; END IF;
 IF length(btrim(t)) NOT BETWEEN 1 AND 160 OR s NOT IN ('open','solved') OR p->>'type'<>'doc' OR NOT public.growth_case_document_valid(p,c) THEN RAISE EXCEPTION 'Invalid case'; END IF;
 IF a IS NULL OR jsonb_typeof(a)<>'array' OR jsonb_array_length(a)<jsonb_array_length(r.attempts) OR jsonb_array_length(a)>50 THEN RAISE EXCEPTION 'Attempts cannot be removed'; END IF;
 FOR i IN 0..jsonb_array_length(a)-1 LOOP
  attempt:=a->i; old_attempt:=r.attempts->i;
  IF jsonb_typeof(attempt)<>'object' OR (attempt->>'id') IS NULL OR (attempt->>'id') !~ '^[0-9a-f-]{36}$' OR (old_attempt IS NOT NULL AND attempt->>'id' IS DISTINCT FROM old_attempt->>'id') THEN RAISE EXCEPTION 'Invalid attempt identity'; END IF;
  IF attempt->'hypothesis'->>'type' IS DISTINCT FROM 'doc' OR attempt->'action'->>'type' IS DISTINCT FROM 'doc' OR attempt->'result'->>'type' IS DISTINCT FROM 'doc' OR NOT public.growth_case_document_valid(attempt->'hypothesis',c) OR NOT public.growth_case_document_valid(attempt->'action',c) OR NOT public.growth_case_document_valid(attempt->'result',c) THEN RAISE EXCEPTION 'Invalid attempt document'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(a))<>jsonb_array_length(a) THEN RAISE EXCEPTION 'Duplicate attempt'; END IF;
 UPDATE public.growth_cases SET title=btrim(t),status=s,problem=p,attempts=a,version=version+1,updated_at=now() WHERE id=c RETURNING * INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.growth_case_create(uuid,uuid,uuid), public.growth_case_save(uuid,uuid,integer,text,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.growth_case_create(uuid,uuid,uuid), public.growth_case_save(uuid,uuid,integer,text,text,jsonb,jsonb) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('growth-case-images','growth-case-images',false,5242880,ARRAY['image/png','image/jpeg','image/webp','image/gif']);
CREATE FUNCTION public.growth_case_image_access(path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.growth_cases c WHERE c.workspace_id::text=split_part(path,'/',1)
 AND c.owner_id::text=split_part(path,'/',2) AND c.id::text=split_part(path,'/',3)
 AND c.owner_id=auth.uid() AND public.growth_has_permission(c.workspace_id,'tab:growth-work'));
$$;
REVOKE ALL ON FUNCTION public.growth_case_image_access(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.growth_case_image_access(text) TO authenticated;
CREATE POLICY growth_case_image_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='growth-case-images' AND public.growth_case_image_access(name));
CREATE POLICY growth_case_image_create ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='growth-case-images' AND public.growth_case_image_access(name));
-- No update/delete grants for normal clients: saved history keeps its images.
NOTIFY pgrst,'reload schema';
COMMIT;
