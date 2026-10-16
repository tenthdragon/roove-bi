BEGIN;
-- Negative results are cached independently of the registry of positive proof.
CREATE TABLE public.meta_product_set_verification_attempts (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
 product_set_id text NOT NULL CHECK(product_set_id ~ '^[0-9]+$'),
 checked_at timestamptz NOT NULL, retry_after timestamptz NOT NULL,
 error_message text NOT NULL,
 PRIMARY KEY(workspace_id,account_id,product_set_id),
 CHECK(retry_after > checked_at)
);
ALTER TABLE public.meta_product_set_verification_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_product_set_verification_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_product_set_verification_attempts TO service_role;

-- Update classification only when the metadata used to compute it is still
-- current. Never replace a fresh creative/ad set observation with an old one.
CREATE FUNCTION public.apply_meta_product_set_classifications(p_workspace_id uuid,p_account_id text,p_product_set_id text,p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_product_set_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM meta_shopee_product_sets s WHERE s.workspace_id=p_workspace_id AND s.account_id=p_account_id AND s.product_set_id=p_product_set_id)
  OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Invalid product set classification scope'; END IF;
 IF jsonb_array_length(p_rows)>500 OR EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'ad_id' IS NULL OR r->>'ad_id' !~ '^[0-9]+$'
   OR r->>'classification' IS NULL OR r->>'classification' NOT IN ('cpas','unknown')
   OR r->'metadata' IS NULL OR jsonb_typeof(r->'metadata')<>'object'
   OR r->'evidence' IS NULL OR jsonb_typeof(r->'evidence')<>'array'
 ) THEN RAISE EXCEPTION 'Invalid product set classification rows'; END IF;
 UPDATE meta_ad_destination_metadata d SET classification=r.classification,evidence=r.evidence
 FROM jsonb_to_recordset(p_rows) AS r(ad_id text,classification text,evidence jsonb,metadata jsonb)
 WHERE d.workspace_id=p_workspace_id AND d.account_id=p_account_id AND d.ad_id=r.ad_id
  AND d.metadata @> jsonb_build_object('product_set_ids',jsonb_build_array(p_product_set_id))
  AND d.metadata=r.metadata;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.apply_meta_product_set_classifications(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_meta_product_set_classifications(uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
