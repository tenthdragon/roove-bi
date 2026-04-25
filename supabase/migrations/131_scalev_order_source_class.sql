ALTER TABLE public.scalev_orders
  ADD COLUMN IF NOT EXISTS source_class TEXT,
  ADD COLUMN IF NOT EXISTS source_class_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scalev_orders_source_class_check'
  ) THEN
    ALTER TABLE public.scalev_orders
      ADD CONSTRAINT scalev_orders_source_class_check
      CHECK (
        source_class IS NULL
        OR source_class IN ('marketplace', 'non_marketplace')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_source_class
  ON public.scalev_orders (source_class);

COMMENT ON COLUMN public.scalev_orders.source_class IS
  'Formal order-level source classification derived from the existing marketplace classifier.';

COMMENT ON COLUMN public.scalev_orders.source_class_reason IS
  'Winning signal that produced source_class (financial_entity, platform, external_id, courier, store_type, store_guess, marketplace_api_upload, or fallback_non_marketplace).';
