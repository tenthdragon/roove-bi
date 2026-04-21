BEGIN;

ALTER TABLE public.warehouse_stock_opname
  DROP CONSTRAINT IF EXISTS warehouse_stock_opname_warehouse_opname_date_opname_label_p_key;

ALTER TABLE public.warehouse_stock_opname
  DROP CONSTRAINT IF EXISTS warehouse_stock_opname_warehouse_opname_date_opname_label_product_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wso_session_product_unique
  ON public.warehouse_stock_opname (session_id, warehouse_product_id)
  WHERE session_id IS NOT NULL
    AND warehouse_product_id IS NOT NULL;

COMMENT ON INDEX public.idx_wso_session_product_unique IS
  'Ensures stock opname item uniqueness per active session instead of per date/label, so the same day+label can exist across different entities.';

COMMIT;
