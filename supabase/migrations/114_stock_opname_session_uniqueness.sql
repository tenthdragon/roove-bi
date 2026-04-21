BEGIN;

DO $$
DECLARE
  legacy_constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO legacy_constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.warehouse_stock_opname'::regclass
    AND con.contype = 'u'
    AND ARRAY(
      SELECT att.attname
      FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = cols.attnum
      ORDER BY cols.ord
    ) = ARRAY['warehouse', 'opname_date', 'opname_label', 'product_name'];

  IF legacy_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.warehouse_stock_opname DROP CONSTRAINT %I',
      legacy_constraint_name
    );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wso_session_product_unique
  ON public.warehouse_stock_opname (session_id, warehouse_product_id)
  WHERE session_id IS NOT NULL
    AND warehouse_product_id IS NOT NULL;

COMMENT ON INDEX public.idx_wso_session_product_unique IS
  'Ensures stock opname item uniqueness per active session instead of per date/label, so the same day+label can exist across different entities.';

COMMIT;
