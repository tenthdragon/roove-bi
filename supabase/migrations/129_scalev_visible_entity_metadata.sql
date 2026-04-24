BEGIN;

ALTER TABLE public.scalev_catalog_products
  ADD COLUMN IF NOT EXISTS visibility_kind TEXT,
  ADD COLUMN IF NOT EXISTS owner_business_id INT,
  ADD COLUMN IF NOT EXISTS owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS processor_business_id INT,
  ADD COLUMN IF NOT EXISTS processor_business_code TEXT;

ALTER TABLE public.scalev_catalog_variants
  ADD COLUMN IF NOT EXISTS visibility_kind TEXT,
  ADD COLUMN IF NOT EXISTS owner_business_id INT,
  ADD COLUMN IF NOT EXISTS owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS processor_business_id INT,
  ADD COLUMN IF NOT EXISTS processor_business_code TEXT;

ALTER TABLE public.scalev_catalog_bundles
  ADD COLUMN IF NOT EXISTS visibility_kind TEXT,
  ADD COLUMN IF NOT EXISTS owner_business_id INT,
  ADD COLUMN IF NOT EXISTS owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS processor_business_id INT,
  ADD COLUMN IF NOT EXISTS processor_business_code TEXT;

ALTER TABLE public.scalev_catalog_identifiers
  ADD COLUMN IF NOT EXISTS visibility_kind TEXT,
  ADD COLUMN IF NOT EXISTS owner_business_id INT,
  ADD COLUMN IF NOT EXISTS owner_business_code TEXT,
  ADD COLUMN IF NOT EXISTS processor_business_id INT,
  ADD COLUMN IF NOT EXISTS processor_business_code TEXT;

UPDATE public.scalev_catalog_products
SET
  visibility_kind = COALESCE(NULLIF(visibility_kind, ''), 'owned'),
  owner_business_id = COALESCE(owner_business_id, business_id),
  owner_business_code = COALESCE(NULLIF(owner_business_code, ''), business_code),
  processor_business_id = COALESCE(processor_business_id, owner_business_id, business_id),
  processor_business_code = COALESCE(NULLIF(processor_business_code, ''), owner_business_code, business_code);

UPDATE public.scalev_catalog_variants
SET
  visibility_kind = COALESCE(NULLIF(visibility_kind, ''), 'owned'),
  owner_business_id = COALESCE(owner_business_id, business_id),
  owner_business_code = COALESCE(NULLIF(owner_business_code, ''), business_code),
  processor_business_id = COALESCE(processor_business_id, owner_business_id, business_id),
  processor_business_code = COALESCE(NULLIF(processor_business_code, ''), owner_business_code, business_code);

UPDATE public.scalev_catalog_bundles
SET
  visibility_kind = COALESCE(NULLIF(visibility_kind, ''), 'owned'),
  owner_business_id = COALESCE(owner_business_id, business_id),
  owner_business_code = COALESCE(NULLIF(owner_business_code, ''), business_code),
  processor_business_id = COALESCE(processor_business_id, owner_business_id, business_id),
  processor_business_code = COALESCE(NULLIF(processor_business_code, ''), owner_business_code, business_code);

UPDATE public.scalev_catalog_identifiers
SET
  visibility_kind = COALESCE(NULLIF(visibility_kind, ''), 'owned'),
  owner_business_id = COALESCE(owner_business_id, business_id),
  owner_business_code = COALESCE(NULLIF(owner_business_code, ''), business_code),
  processor_business_id = COALESCE(processor_business_id, owner_business_id, business_id),
  processor_business_code = COALESCE(NULLIF(processor_business_code, ''), owner_business_code, business_code);

ALTER TABLE public.scalev_catalog_products
  ALTER COLUMN visibility_kind SET DEFAULT 'owned',
  ALTER COLUMN visibility_kind SET NOT NULL,
  ALTER COLUMN owner_business_id SET NOT NULL,
  ALTER COLUMN owner_business_code SET NOT NULL,
  ALTER COLUMN processor_business_id SET NOT NULL,
  ALTER COLUMN processor_business_code SET NOT NULL;

ALTER TABLE public.scalev_catalog_variants
  ALTER COLUMN visibility_kind SET DEFAULT 'owned',
  ALTER COLUMN visibility_kind SET NOT NULL,
  ALTER COLUMN owner_business_id SET NOT NULL,
  ALTER COLUMN owner_business_code SET NOT NULL,
  ALTER COLUMN processor_business_id SET NOT NULL,
  ALTER COLUMN processor_business_code SET NOT NULL;

ALTER TABLE public.scalev_catalog_bundles
  ALTER COLUMN visibility_kind SET DEFAULT 'owned',
  ALTER COLUMN visibility_kind SET NOT NULL,
  ALTER COLUMN owner_business_id SET NOT NULL,
  ALTER COLUMN owner_business_code SET NOT NULL,
  ALTER COLUMN processor_business_id SET NOT NULL,
  ALTER COLUMN processor_business_code SET NOT NULL;

ALTER TABLE public.scalev_catalog_identifiers
  ALTER COLUMN visibility_kind SET DEFAULT 'owned',
  ALTER COLUMN visibility_kind SET NOT NULL,
  ALTER COLUMN owner_business_id SET NOT NULL,
  ALTER COLUMN owner_business_code SET NOT NULL,
  ALTER COLUMN processor_business_id SET NOT NULL,
  ALTER COLUMN processor_business_code SET NOT NULL;

ALTER TABLE public.scalev_catalog_products
  DROP CONSTRAINT IF EXISTS scalev_catalog_products_visibility_kind_check;
ALTER TABLE public.scalev_catalog_products
  ADD CONSTRAINT scalev_catalog_products_visibility_kind_check
  CHECK (visibility_kind IN ('owned', 'shared'));

ALTER TABLE public.scalev_catalog_variants
  DROP CONSTRAINT IF EXISTS scalev_catalog_variants_visibility_kind_check;
ALTER TABLE public.scalev_catalog_variants
  ADD CONSTRAINT scalev_catalog_variants_visibility_kind_check
  CHECK (visibility_kind IN ('owned', 'shared'));

ALTER TABLE public.scalev_catalog_bundles
  DROP CONSTRAINT IF EXISTS scalev_catalog_bundles_visibility_kind_check;
ALTER TABLE public.scalev_catalog_bundles
  ADD CONSTRAINT scalev_catalog_bundles_visibility_kind_check
  CHECK (visibility_kind IN ('owned', 'shared'));

ALTER TABLE public.scalev_catalog_identifiers
  DROP CONSTRAINT IF EXISTS scalev_catalog_identifiers_visibility_kind_check;
ALTER TABLE public.scalev_catalog_identifiers
  ADD CONSTRAINT scalev_catalog_identifiers_visibility_kind_check
  CHECK (visibility_kind IN ('owned', 'shared'));

CREATE INDEX IF NOT EXISTS idx_scalev_catalog_products_business_visibility
  ON public.scalev_catalog_products (business_id, visibility_kind);
CREATE INDEX IF NOT EXISTS idx_scalev_catalog_products_business_processor
  ON public.scalev_catalog_products (business_id, processor_business_id);

CREATE INDEX IF NOT EXISTS idx_scalev_catalog_variants_business_visibility
  ON public.scalev_catalog_variants (business_id, visibility_kind);
CREATE INDEX IF NOT EXISTS idx_scalev_catalog_variants_business_processor
  ON public.scalev_catalog_variants (business_id, processor_business_id);

CREATE INDEX IF NOT EXISTS idx_scalev_catalog_bundles_business_visibility
  ON public.scalev_catalog_bundles (business_id, visibility_kind);
CREATE INDEX IF NOT EXISTS idx_scalev_catalog_bundles_business_processor
  ON public.scalev_catalog_bundles (business_id, processor_business_id);

CREATE INDEX IF NOT EXISTS idx_scalev_catalog_identifiers_business_visibility
  ON public.scalev_catalog_identifiers (business_id, visibility_kind);
CREATE INDEX IF NOT EXISTS idx_scalev_catalog_identifiers_business_processor
  ON public.scalev_catalog_identifiers (business_id, processor_business_id);

COMMENT ON COLUMN public.scalev_catalog_products.visibility_kind IS
  'Whether the viewer business owns this entity directly or receives it as a shared-visible entity from another business.';
COMMENT ON COLUMN public.scalev_catalog_products.owner_business_code IS
  'Business code that owns the visible entity in ScaleV.';
COMMENT ON COLUMN public.scalev_catalog_products.processor_business_code IS
  'Business code whose warehouse mapping becomes canonical for deduction.';

COMMENT ON COLUMN public.scalev_catalog_variants.visibility_kind IS
  'Whether the viewer business owns this entity directly or receives it as a shared-visible entity from another business.';
COMMENT ON COLUMN public.scalev_catalog_variants.owner_business_code IS
  'Business code that owns the visible entity in ScaleV.';
COMMENT ON COLUMN public.scalev_catalog_variants.processor_business_code IS
  'Business code whose warehouse mapping becomes canonical for deduction.';

COMMENT ON COLUMN public.scalev_catalog_bundles.visibility_kind IS
  'Whether the viewer business owns this bundle directly or receives it as a shared-visible entity from another business.';
COMMENT ON COLUMN public.scalev_catalog_bundles.owner_business_code IS
  'Business code that owns the visible bundle in ScaleV.';
COMMENT ON COLUMN public.scalev_catalog_bundles.processor_business_code IS
  'Business code whose warehouse mapping becomes canonical for deduction.';

COMMENT ON COLUMN public.scalev_catalog_identifiers.visibility_kind IS
  'Visibility metadata copied from the visible entity so resolver can determine processor business without extra joins.';
COMMENT ON COLUMN public.scalev_catalog_identifiers.owner_business_code IS
  'Business code that owns the entity referenced by this identifier.';
COMMENT ON COLUMN public.scalev_catalog_identifiers.processor_business_code IS
  'Business code whose warehouse mapping becomes canonical for deduction.';

COMMIT;
