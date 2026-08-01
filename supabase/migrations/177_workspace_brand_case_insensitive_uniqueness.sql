-- Brand names may repeat across independent workspaces. Keep the original
-- case-insensitive protection, but scope it to the owning workspace.

BEGIN;

DROP INDEX IF EXISTS public.idx_brands_name_ci;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_workspace_name_ci
  ON public.brands (workspace_id, LOWER(name));

COMMIT;
