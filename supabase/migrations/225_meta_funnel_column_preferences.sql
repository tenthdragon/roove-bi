-- Personal display settings only; never modify funnel formulas or monitoring.
-- Workspace ownership is inherited from funnel_id, so it cannot disagree with
-- the template. Server actions verify the authenticated viewer and workspace.
BEGIN;
CREATE TABLE public.meta_funnel_column_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES public.meta_ad_funnels(id) ON DELETE CASCADE,
  column_order text[] NOT NULL,
  hidden_columns text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, funnel_id),
  CONSTRAINT meta_column_order_size CHECK (cardinality(column_order) BETWEEN 1 AND 13),
  CONSTRAINT meta_hidden_columns_size CHECK (cardinality(hidden_columns) <= 13),
  CONSTRAINT meta_hidden_columns_subset CHECK (hidden_columns <@ column_order),
  CONSTRAINT meta_column_order_no_null CHECK (array_position(column_order, NULL) IS NULL),
  CONSTRAINT meta_hidden_columns_no_null CHECK (array_position(hidden_columns, NULL) IS NULL)
);
CREATE INDEX meta_funnel_column_preferences_funnel_idx ON public.meta_funnel_column_preferences(funnel_id);
ALTER TABLE public.meta_funnel_column_preferences ENABLE ROW LEVEL SECURITY;
-- No direct client access: all operations go through authenticated server actions
-- which derive user_id from the verified session (including advertiser users).
REVOKE ALL ON public.meta_funnel_column_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_funnel_column_preferences TO service_role;
COMMENT ON TABLE public.meta_funnel_column_preferences IS 'Private per-user/per-template Meta result column visibility and order. No report or alert semantics.';
NOTIFY pgrst, 'reload schema';
COMMIT;
