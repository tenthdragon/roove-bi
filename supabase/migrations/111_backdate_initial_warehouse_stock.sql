-- Migration 111: backdate seeded initial warehouse stock for cleaner audits
--
-- Problem:
-- Historical seed rows such as "Initial stock from Kartu Stock" were inserted
-- with the timestamp of the migration run, so they appear in the middle of the
-- operational timeline and make audit pages look like sales suddenly increased stock.
--
-- Fix:
-- 1. Backdate all seeded opening-stock rows to the first day of their source period.
-- 2. Backdate the linked batch rows as well for consistency.
-- 3. Recalculate running balances for all affected products.

CREATE OR REPLACE FUNCTION public.warehouse_seed_period_start(
  p_batch_code TEXT,
  p_notes TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_match TEXT[];
  v_token TEXT;
  v_year INT;
  v_month INT;
BEGIN
  v_match := regexp_match(
    UPPER(COALESCE(p_batch_code, '')),
    '^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-([0-9]{4})$'
  );

  IF v_match IS NULL THEN
    v_match := regexp_match(
      UPPER(COALESCE(p_batch_code, '')),
      '^INIT-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)([0-9]{4})$'
    );
  END IF;

  IF v_match IS NULL THEN
    v_match := regexp_match(
      UPPER(COALESCE(p_notes, '')),
      '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|JANUARI|FEBRUARI|MARET|APRIL|MEI|JUNI|JULI|AGUSTUS|SEPTEMBER|OKTOBER|NOVEMBER|DESEMBER)\s+([0-9]{4})'
    );
  END IF;

  IF v_match IS NULL THEN
    RETURN NULL;
  END IF;

  v_token := v_match[1];
  v_year := v_match[2]::INT;
  v_month := CASE
    WHEN v_token LIKE 'JAN%' THEN 1
    WHEN v_token LIKE 'FEB%' THEN 2
    WHEN v_token LIKE 'MAR%' THEN 3
    WHEN v_token LIKE 'APR%' THEN 4
    WHEN v_token IN ('MAY', 'MEI') THEN 5
    WHEN v_token LIKE 'JUN%' THEN 6
    WHEN v_token LIKE 'JUL%' THEN 7
    WHEN v_token LIKE 'AUG%' OR v_token LIKE 'AGU%' THEN 8
    WHEN v_token LIKE 'SEP%' THEN 9
    WHEN v_token LIKE 'OCT%' OR v_token LIKE 'OKT%' THEN 10
    WHEN v_token LIKE 'NOV%' THEN 11
    WHEN v_token LIKE 'DEC%' OR v_token LIKE 'DES%' THEN 12
    ELSE NULL
  END;

  IF v_month IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'Asia/Jakarta');
END;
$$;

COMMENT ON FUNCTION public.warehouse_seed_period_start(TEXT, TEXT) IS
  'Returns the canonical opening-stock timestamp for seeded warehouse rows based on batch code or seed note period labels.';

DO $$
DECLARE
  v_product_ids INT[];
BEGIN
  WITH targets AS (
    SELECT
      l.id,
      l.batch_id,
      l.warehouse_product_id,
      public.warehouse_seed_period_start(b.batch_code, l.notes) AS backdated_at
    FROM public.warehouse_stock_ledger l
    LEFT JOIN public.warehouse_batches b
      ON b.id = l.batch_id
    WHERE l.reference_type = 'manual'
      AND l.movement_type = 'IN'
      AND (
        l.notes = 'Initial stock from Kartu Stock'
        OR l.notes LIKE 'Initial WIP stock from Kartu Stock%'
      )
  )
  SELECT array_agg(DISTINCT warehouse_product_id)
  INTO v_product_ids
  FROM targets
  WHERE backdated_at IS NOT NULL;

  UPDATE public.warehouse_stock_ledger l
  SET created_at = t.backdated_at
  FROM targets t
  WHERE l.id = t.id
    AND t.backdated_at IS NOT NULL
    AND l.created_at IS DISTINCT FROM t.backdated_at;

  UPDATE public.warehouse_batches b
  SET created_at = t.backdated_at
  FROM (
    SELECT DISTINCT batch_id, backdated_at
    FROM targets
    WHERE batch_id IS NOT NULL
      AND backdated_at IS NOT NULL
  ) t
  WHERE b.id = t.batch_id
    AND b.created_at IS DISTINCT FROM t.backdated_at;

  IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
    PERFORM public.warehouse_recalculate_running_balances(v_product_ids);
  END IF;
END;
$$;
