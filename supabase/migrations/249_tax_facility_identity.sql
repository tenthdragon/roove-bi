-- ============================================================================
-- 249: Enforce the facility import identity in the database
-- ============================================================================
-- The master import de-duplicates facilities in memory before inserting, which
-- two concurrent imports can both pass. A facility is identified by its
-- counterparty, facility code, document number and start date; the start date
-- keeps legitimate history (a renewed SKB without a number, a new period of
-- the same certificate) while rejecting exact duplicates. NULLS NOT DISTINCT
-- makes a missing number or date compare equal, so the import can rely on
-- ON CONFLICT DO NOTHING.
-- ============================================================================

BEGIN;

UPDATE public.tax_counterparty_facilities
SET document_number = NULL
WHERE document_number IS NOT NULL AND btrim(document_number) = '';

DELETE FROM public.tax_counterparty_facilities duplicate
USING public.tax_counterparty_facilities kept
WHERE duplicate.id > kept.id
  AND duplicate.counterparty_id = kept.counterparty_id
  AND duplicate.facility_code = kept.facility_code
  AND duplicate.document_number IS NOT DISTINCT FROM kept.document_number
  AND duplicate.valid_from IS NOT DISTINCT FROM kept.valid_from;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tax_counterparty_facilities_identity_key'
      AND conrelid = 'public.tax_counterparty_facilities'::regclass
  ) THEN
    ALTER TABLE public.tax_counterparty_facilities
      ADD CONSTRAINT tax_counterparty_facilities_identity_key
      UNIQUE NULLS NOT DISTINCT (counterparty_id, facility_code, document_number, valid_from);
  END IF;
END $$;

COMMIT;
