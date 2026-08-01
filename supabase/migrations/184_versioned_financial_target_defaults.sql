-- Version workspace target defaults by effective month.
-- This prevents a new default from silently changing historical dashboards.

BEGIN;

ALTER TABLE public.workspace_financial_targets
  ADD COLUMN IF NOT EXISTS effective_from DATE;

UPDATE public.workspace_financial_targets
SET effective_from = COALESCE(
  target_month,
  date_trunc('month', created_at)::DATE,
  date_trunc('month', CURRENT_DATE)::DATE
)
WHERE effective_from IS NULL;

ALTER TABLE public.workspace_financial_targets
  ALTER COLUMN effective_from SET NOT NULL;

ALTER TABLE public.workspace_financial_targets
  DROP CONSTRAINT IF EXISTS workspace_financial_targets_effective_from_check;
ALTER TABLE public.workspace_financial_targets
  ADD CONSTRAINT workspace_financial_targets_effective_from_check
  CHECK (effective_from = date_trunc('month', effective_from)::DATE);

DROP INDEX IF EXISTS public.idx_workspace_financial_target_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_financial_target_default_version
  ON public.workspace_financial_targets (workspace_id, effective_from)
  WHERE target_month IS NULL;

DROP INDEX IF EXISTS public.idx_workspace_financial_targets_lookup;
CREATE INDEX IF NOT EXISTS idx_workspace_financial_targets_lookup
  ON public.workspace_financial_targets (
    workspace_id,
    target_month,
    effective_from DESC,
    updated_at DESC
  );

COMMENT ON COLUMN public.workspace_financial_targets.effective_from IS
  'First month that a default applies; monthly overrides use their own month. Defaults are versioned so historical targets remain stable.';

COMMIT;
