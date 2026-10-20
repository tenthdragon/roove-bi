-- Extend existing personal preferences. Empty column_order means template defaults.
BEGIN;
ALTER TABLE public.meta_funnel_column_preferences
  ADD COLUMN sort_config jsonb,
  DROP CONSTRAINT meta_column_order_size,
  ADD CONSTRAINT meta_column_order_size CHECK (cardinality(column_order) BETWEEN 0 AND 13),
  ADD CONSTRAINT meta_sort_config_valid CHECK (sort_config IS NULL OR (
    jsonb_typeof(sort_config) = 'object'
    AND sort_config->>'direction' IN ('ascending', 'descending')
    AND sort_config->>'key' ~ '^(name|funnel|metric:[a-zA-Z0-9_-]{1,50})$'
    AND CASE WHEN sort_config->>'key' = 'funnel'
      THEN jsonb_typeof(sort_config->'stage') = 'string' AND length(sort_config->>'stage') BETWEEN 1 AND 50
      ELSE NOT sort_config ? 'stage' END
    AND sort_config ?& ARRAY['key','direction']
    AND jsonb_typeof(sort_config->'key') = 'string'
    AND jsonb_typeof(sort_config->'direction') = 'string'
    AND (sort_config->>'key' <> 'funnel' OR sort_config ? 'stage')
  ) IS TRUE);

-- One atomic patch prevents a sort save from overwriting columns (and vice versa).
-- Only server code can call this function, after verifying viewer/template access.
CREATE FUNCTION public.save_meta_funnel_table_preference(
  p_user_id uuid, p_funnel_id uuid, p_kind text,
  p_columns jsonb DEFAULT NULL, p_sort jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE saved public.meta_funnel_column_preferences;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('columns', 'sort') THEN
    RAISE EXCEPTION 'Invalid preference kind';
  END IF;
  INSERT INTO public.meta_funnel_column_preferences AS current (
    user_id, funnel_id, column_order, hidden_columns, sort_config
  ) VALUES (
    p_user_id, p_funnel_id,
    CASE WHEN p_kind = 'columns' THEN ARRAY(SELECT jsonb_array_elements_text(p_columns->'order')) ELSE '{}'::text[] END,
    CASE WHEN p_kind = 'columns' THEN ARRAY(SELECT jsonb_array_elements_text(p_columns->'hidden')) ELSE '{}'::text[] END,
    CASE WHEN p_kind = 'sort' THEN p_sort ELSE NULL END
  ) ON CONFLICT (user_id, funnel_id) DO UPDATE SET
    column_order = CASE WHEN p_kind = 'columns' THEN excluded.column_order ELSE current.column_order END,
    hidden_columns = CASE WHEN p_kind = 'columns' THEN excluded.hidden_columns ELSE current.hidden_columns END,
    sort_config = CASE WHEN p_kind = 'columns' THEN
      CASE WHEN current.sort_config->>'key' = ANY(excluded.hidden_columns) THEN NULL ELSE current.sort_config END
      ELSE CASE WHEN p_sort->>'key' = ANY(current.hidden_columns) THEN NULL ELSE p_sort END END,
    updated_at = now()
  RETURNING * INTO saved;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.save_meta_funnel_table_preference(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_meta_funnel_table_preference(uuid, uuid, text, jsonb, jsonb) TO service_role;
COMMENT ON TABLE public.meta_funnel_column_preferences IS 'Private per-user/per-template Meta result column visibility, order and row sorting. No report or alert semantics.';
NOTIFY pgrst, 'reload schema';
COMMIT;
