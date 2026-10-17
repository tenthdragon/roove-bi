BEGIN;
-- Funnel templates: a saved meta_ad_funnels configuration now describes the
-- stages and result columns of a kind of landing page (transaction, lead, ...).
-- This table assigns landing pages to a template by URL rule. Rules are
-- workspace scoped; a URL matches at most one rule by precedence
-- exact > prefix > domain, then longest pattern. Suggestions derived from
-- observed events are never persisted automatically; an admin confirms them.
CREATE TABLE public.meta_landing_page_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 funnel_id uuid NOT NULL,
 match_kind text NOT NULL CHECK (match_kind IN ('exact','prefix','domain')),
 pattern text NOT NULL CHECK (length(pattern) BETWEEN 1 AND 4096),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,funnel_id) REFERENCES public.meta_ad_funnels(workspace_id,id) ON DELETE CASCADE,
 UNIQUE(workspace_id,match_kind,pattern)
);
CREATE INDEX meta_landing_page_templates_workspace ON public.meta_landing_page_templates(workspace_id,funnel_id);
ALTER TABLE public.meta_landing_page_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_landing_page_templates FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_landing_page_templates TO service_role;
-- Template assignment changes the brand report, so it must invalidate the cache
-- revision the same way facts and mappings do.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meta_landing_page_templates','meta_ad_funnels'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='meta_report_insert' AND tgrelid=('public.'||t)::regclass) THEN
   EXECUTE format('CREATE TRIGGER meta_report_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
   EXECUTE format('CREATE TRIGGER meta_report_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
   EXECUTE format('CREATE TRIGGER meta_report_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
