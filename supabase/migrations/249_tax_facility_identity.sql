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

-- Serialize the preflight, cleanup and constraint creation with facility writes.
LOCK TABLE public.tax_counterparty_facilities IN ACCESS EXCLUSIVE MODE;

UPDATE public.tax_counterparty_facilities
SET document_number = NULL
WHERE document_number IS NOT NULL AND btrim(document_number) = '';

-- Rows with the same identity can contain different tax instructions. Never
-- choose one arbitrarily: abort the whole transaction for explicit reconciliation.
DO $$
DECLARE conflicting_ids TEXT;
BEGIN
  SELECT format('%s / %s', duplicate.id, kept.id) INTO conflicting_ids
  FROM public.tax_counterparty_facilities duplicate
  JOIN public.tax_counterparty_facilities kept
    ON duplicate.id > kept.id
   AND duplicate.counterparty_id = kept.counterparty_id
   AND duplicate.facility_code = kept.facility_code
   AND duplicate.document_number IS NOT DISTINCT FROM kept.document_number
   AND duplicate.valid_from IS NOT DISTINCT FROM kept.valid_from
  WHERE ROW(duplicate.workspace_id, duplicate.applies_to, duplicate.rate_override, duplicate.valid_to, duplicate.notes)
    IS DISTINCT FROM ROW(kept.workspace_id, kept.applies_to, kept.rate_override, kept.valid_to, kept.notes)
  LIMIT 1;
  IF conflicting_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Conflicting tax facility rows (%); reconcile payloads before migration 249', conflicting_ids;
  END IF;
END $$;

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
