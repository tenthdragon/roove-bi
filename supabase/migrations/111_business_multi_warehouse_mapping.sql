-- Migration 111: allow multiple warehouse targets per business
-- Business settings now act as a whitelist of allowed warehouse targets,
-- with one primary target kept for UI anchoring and deterministic fallback.

BEGIN;

ALTER TABLE public.warehouse_business_mapping
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

UPDATE public.warehouse_business_mapping
SET is_primary = true
WHERE business_code IN (
  SELECT business_code
  FROM public.warehouse_business_mapping
  GROUP BY business_code
  HAVING COUNT(*) = 1
);

ALTER TABLE public.warehouse_business_mapping
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_business_code_key;

ALTER TABLE public.warehouse_business_mapping
  ADD CONSTRAINT warehouse_business_mapping_business_target_key
  UNIQUE (business_code, deduct_entity, deduct_warehouse);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wbm_primary_per_business
  ON public.warehouse_business_mapping (business_code)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_wbm_business_active
  ON public.warehouse_business_mapping (business_code, is_active);

COMMENT ON TABLE public.warehouse_business_mapping IS
  'Whitelist of allowed warehouse targets for each ScaleV business. One row may be marked primary for UI anchoring and deterministic fallback.';

COMMENT ON COLUMN public.warehouse_business_mapping.is_primary IS
  'Marks the primary/default warehouse target for a business. Only one primary row is allowed per business.';

COMMIT;
