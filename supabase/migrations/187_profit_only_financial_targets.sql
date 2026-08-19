-- Simplify profitability planning so operating profit is the only manual target.
-- CM3 is derived from overhead + profit. Revenue uses a revenue-weighted CM3
-- margin from the three completed months before the target month.

BEGIN;

ALTER TABLE public.workspace_financial_targets
  ALTER COLUMN planned_cm3_margin DROP NOT NULL;

COMMENT ON COLUMN public.workspace_financial_targets.planned_cm3_margin IS
  'Automatically calculated revenue-weighted CM3 margin from the three completed months before the target month.';

COMMENT ON COLUMN public.workspace_financial_targets.target_revenue_override IS
  'Deprecated legacy input. New targets leave this null because target revenue is calculated automatically.';

COMMIT;
