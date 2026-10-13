BEGIN;
-- Explicitly verified destinations for ads whose public creative fields are opaque.
-- Bind to a creative version so a later creative change cannot inherit an old URL.
CREATE TABLE public.meta_ad_verified_destinations (
 workspace_id uuid NOT NULL, account_id text NOT NULL, ad_id text NOT NULL,
 creative_id text NOT NULL, landing_page_url text NOT NULL,
 verified_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,ad_id),
 FOREIGN KEY(workspace_id,account_id,ad_id) REFERENCES public.meta_ad_creatives(workspace_id,account_id,ad_id) ON DELETE CASCADE,
 CHECK (ad_id ~ '^[0-9]+$' AND creative_id ~ '^[0-9]+$'),
 CHECK (length(landing_page_url)<=4096 AND landing_page_url ~ '^https?://')
);
ALTER TABLE public.meta_ad_verified_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_verified_destinations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_verified_destinations TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
