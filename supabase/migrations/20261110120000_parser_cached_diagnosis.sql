-- Additive catalog metadata; legacy rows stay explicitly incomplete until sync.
ALTER TABLE public.scalev_webhook_businesses ADD COLUMN IF NOT EXISTS scalev_business_uid text;
ALTER TABLE public.scalev_catalog_bundles
  ADD COLUMN IF NOT EXISTS scalev_owner_uid text,
  ADD COLUMN IF NOT EXISTS scalev_owner_name text,
  ADD COLUMN IF NOT EXISTS price_options jsonb CHECK (price_options IS NULL OR jsonb_typeof(price_options) = 'array');
CREATE INDEX IF NOT EXISTS scalev_bundle_workspace_identifier_idx
  ON public.scalev_catalog_bundles(workspace_id, custom_id, business_id);

-- One budget per credential, shared by web requests and background workers.
-- Only a one-way hash of the credential is stored; no keys or API payloads.
CREATE TABLE IF NOT EXISTS public.scalev_api_request_budget (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  blocked_until timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.scalev_api_request_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scalev_api_request_budget FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.scalev_api_request_budget TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_scalev_api_request(p_key_hash text, p_blocked_until timestamptz DEFAULT NULL, p_check_only boolean DEFAULT false)
RETURNS double precision LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE state public.scalev_api_request_budget; at_time timestamptz; slot timestamptz;
BEGIN
  IF p_key_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid credential hash'; END IF;
  INSERT INTO public.scalev_api_request_budget(key_hash) VALUES (p_key_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO state FROM public.scalev_api_request_budget WHERE key_hash=p_key_hash FOR UPDATE;
  at_time := clock_timestamp();
  IF p_check_only THEN RETURN greatest(0,extract(epoch FROM (state.blocked_until-at_time))*1000); END IF;
  IF p_blocked_until IS NOT NULL THEN
    UPDATE public.scalev_api_request_budget SET blocked_until=greatest(blocked_until,p_blocked_until)
      WHERE key_hash=p_key_hash;
    RETURN greatest(0,extract(epoch FROM (greatest(state.blocked_until,p_blocked_until)-at_time))*1000);
  END IF;
  slot := greatest(at_time,state.next_at,state.blocked_until);
  -- Long cooldowns do not accumulate reservations from repeated button clicks.
  IF slot-at_time <= interval '20 seconds' THEN
    UPDATE public.scalev_api_request_budget SET next_at=slot+interval '250 milliseconds' WHERE key_hash=p_key_hash;
  END IF;
  RETURN greatest(0,extract(epoch FROM (slot-at_time))*1000);
END $$;
REVOKE ALL ON FUNCTION public.reserve_scalev_api_request(text,timestamptz,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_scalev_api_request(text,timestamptz,boolean) TO service_role;
