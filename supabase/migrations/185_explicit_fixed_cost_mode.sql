-- ============================================================================
-- 185: Explicit fixed-cost calculation mode
-- ============================================================================
-- Both detailed fixed costs and legacy monthly totals may coexist. The
-- workspace setting decides which source is active; switching modes never
-- deletes either dataset.
-- ============================================================================

BEGIN;

-- Lock in the behavior that pre-dates this toggle for workspaces without an
-- explicit setting: detailed when detail rows exist, otherwise monthly total.
UPDATE public.workspaces workspace
SET settings = COALESCE(workspace.settings, '{}'::jsonb) || jsonb_build_object(
      'cost_model',
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.fixed_cost_items item
          WHERE item.workspace_id = workspace.id
        ) THEN 'detailed_fixed_costs'
        ELSE 'legacy_monthly_overhead'
      END
    ),
    updated_at = NOW()
WHERE COALESCE(workspace.settings->>'cost_model', '') NOT IN (
  'legacy_monthly_overhead',
  'detailed_fixed_costs'
);

CREATE OR REPLACE FUNCTION public.get_workspace_monthly_overhead(
  p_workspace_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (
  year_month TEXT,
  amount NUMERIC,
  source TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months AS (
    SELECT month_start::DATE
    FROM generate_series(
      date_trunc('month', p_date_from)::DATE,
      date_trunc('month', p_date_to)::DATE,
      INTERVAL '1 month'
    ) AS series(month_start)
  ),
  authorized AS (
    SELECT (
      public.workspace_can_access(p_workspace_id)
      OR auth.role() = 'service_role'
    ) AS allowed
  ),
  selected_model AS (
    SELECT CASE
      WHEN workspace.settings->>'cost_model' IN (
        'legacy_monthly_overhead',
        'detailed_fixed_costs'
      ) THEN workspace.settings->>'cost_model'
      WHEN EXISTS (
        SELECT 1
        FROM public.fixed_cost_items item
        WHERE item.workspace_id = p_workspace_id
      ) THEN 'detailed_fixed_costs'
      ELSE 'legacy_monthly_overhead'
    END AS cost_model
    FROM public.workspaces workspace
    WHERE workspace.id = p_workspace_id
  ),
  detailed AS (
    SELECT
      to_char(month.month_start, 'YYYY-MM') AS year_month,
      COALESCE(SUM(public.fixed_cost_monthly_equivalent(
        item.amount,
        item.quantity,
        item.recurrence_unit,
        item.recurrence_interval
      )), 0)::NUMERIC AS amount,
      'detailed'::TEXT AS source
    FROM months month
    CROSS JOIN authorized access
    CROSS JOIN selected_model model
    LEFT JOIN public.fixed_cost_items item
      ON item.workspace_id = p_workspace_id
     AND item.is_active = TRUE
     AND item.start_date < (month.month_start + INTERVAL '1 month')::DATE
     AND (item.end_date IS NULL OR item.end_date >= month.month_start)
    WHERE access.allowed
      AND model.cost_model = 'detailed_fixed_costs'
    GROUP BY month.month_start
  ),
  legacy AS (
    SELECT
      overhead.year_month,
      overhead.amount::NUMERIC,
      'legacy'::TEXT AS source
    FROM public.monthly_overhead overhead
    CROSS JOIN authorized access
    CROSS JOIN selected_model model
    WHERE overhead.workspace_id = p_workspace_id
      AND access.allowed
      AND model.cost_model = 'legacy_monthly_overhead'
      AND overhead.year_month >= to_char(date_trunc('month', p_date_from), 'YYYY-MM')
      AND overhead.year_month <= to_char(date_trunc('month', p_date_to), 'YYYY-MM')
  )
  SELECT * FROM detailed
  UNION ALL
  SELECT * FROM legacy;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_monthly_overhead(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_monthly_overhead(UUID, DATE, DATE) TO authenticated, service_role;

COMMIT;
