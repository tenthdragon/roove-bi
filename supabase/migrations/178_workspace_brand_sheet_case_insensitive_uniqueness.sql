-- Sheet identifiers follow the same tenant-local uniqueness rule as brand
-- names. The legacy expression index was still global.

BEGIN;

DROP INDEX IF EXISTS public.idx_brands_sheet_ci;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_workspace_sheet_ci
  ON public.brands (workspace_id, LOWER(sheet_name));

COMMIT;
