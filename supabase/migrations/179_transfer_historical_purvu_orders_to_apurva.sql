-- Transfer the 40 historical Purvu sales that crossed the 19 June 2026
-- workspace cutover from Roove to Apurva.
--
-- Sales ownership moves with the ScaleV order and its lines. Historical
-- warehouse ledger rows intentionally stay in Roove because they describe
-- where the physical fulfillment actually happened.

BEGIN;

CREATE TABLE IF NOT EXISTS public.scalev_order_workspace_transfers (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  source_workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  target_workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  source_business_id INT
    REFERENCES public.scalev_webhook_businesses(id) ON DELETE SET NULL,
  source_business_code TEXT NOT NULL,
  target_business_id INT
    REFERENCES public.scalev_webhook_businesses(id) ON DELETE SET NULL,
  target_business_code TEXT NOT NULL,
  transferred_order_id INT
    REFERENCES public.scalev_orders(id) ON DELETE SET NULL,
  original_status TEXT,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_workspace_id, source_business_code, order_id)
);

COMMENT ON TABLE public.scalev_order_workspace_transfers IS
  'Durable routing tombstones for ScaleV orders whose sales ownership moved between workspaces. The source integration must route later events to the target row instead of recreating the order.';

CREATE INDEX IF NOT EXISTS idx_scalev_order_workspace_transfers_source_order
  ON public.scalev_order_workspace_transfers (
    source_workspace_id,
    order_id
  )
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_scalev_order_workspace_transfers_target_order
  ON public.scalev_order_workspace_transfers (
    target_workspace_id,
    transferred_order_id
  )
  WHERE is_active;

ALTER TABLE public.scalev_order_workspace_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scalev_order_workspace_transfers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scalev_order_workspace_transfers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scalev_order_workspace_transfers_id_seq TO service_role;

-- Fail closed if an older worker or ops script tries to recreate an order in
-- its source workspace before the transfer-aware application code is deployed.
CREATE OR REPLACE FUNCTION public.prevent_transferred_scalev_order_recreation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.scalev_order_workspace_transfers transfer
    WHERE transfer.is_active
      AND transfer.source_workspace_id = NEW.workspace_id
      AND transfer.order_id = NEW.order_id
      AND (
        NEW.business_code IS NULL
        OR transfer.source_business_code = NEW.business_code
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'ScaleV order %s was transferred out of workspace %s and cannot be recreated',
        NEW.order_id,
        NEW.workspace_id
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_transferred_scalev_order_recreation
  ON public.scalev_orders;
CREATE TRIGGER prevent_transferred_scalev_order_recreation
  BEFORE INSERT ON public.scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_transferred_scalev_order_recreation();

CREATE TEMP TABLE expected_purvu_transfer (
  scalev_order_id INT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  source_business_code TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO expected_purvu_transfer (
  scalev_order_id,
  order_id,
  source_business_code
)
VALUES
  (352786, '260423RPSWHHN', 'JHN'),
  (381901, '260607BMCTNUR', 'JHN'),
  (386957, '260615JYUGXHB', 'JHN'),
  (386954, '260615YZPDUKM', 'JHN'),
  (389202, '260617IUZRWLV', 'JHN'),
  (389815, '260618AOCHJMO', 'JHN'),
  (389493, '260618AZEWCHY', 'JHN'),
  (389752, '260618CHDTVBJ', 'JHN'),
  (389424, '260618EIAUBPC', 'JHN'),
  (389478, '260618EPDNXOM', 'JHN'),
  (389936, '260618INACULE', 'JHN'),
  (390049, '260618KHNGFQY', 'JHN'),
  (389589, '260618LJBHNQC', 'JHN'),
  (389428, '260618QBTMYLU', 'JHN'),
  (389390, '260618QQRWMOM', 'JHN'),
  (389747, '260618XRECHKD', 'JHN'),
  (390272, '260619BOZNCQE', 'JHN'),
  (390273, '260619EODKKIQ', 'JHN'),
  (390414, '260619HPOMNGN', 'RLT'),
  (390508, '260619IQJUKXM', 'RTI'),
  (390321, '260619RTMUXTI', 'RLT'),
  (391579, '260621SHKUGJY', 'JHN'),
  (392523, '260622QLAGRQV', 'JHN'),
  (392306, '260622YWDTKDD', 'RTI'),
  (392640, '260623JXSOSEL', 'JHN'),
  (393109, '260624DFXSBWD', 'JHN'),
  (393427, '260624JDPWKPV', 'RTI'),
  (393702, '260625IVEJSPC', 'JHN'),
  (394381, '260626ZIPWJTE', 'RLT'),
  (395560, '260628UCOEAJR', 'JHN'),
  (396922, '260630QWWGAQN', 'RTI'),
  (397058, '260630VJNQPNE', 'RTI'),
  (397442, '260701BVSCCRU', 'RLT'),
  (402023, '260708NRCHRIR', 'JHN'),
  (402122, '260708RCCYMCO', 'RLT'),
  (404892, '260713WFUPOAN', 'RTI'),
  (409734, '260722VDSSKFU', 'RTI'),
  (411412, '260725TTCOQUU', 'JHN'),
  (412679, '260727KZLMJVW', 'RTI'),
  (413078, '260727SFDCBDX', 'RTI');

DO $$
DECLARE
  v_source_count INT;
  v_line_count INT;
  v_ledger_count INT;
  v_target_collision_count INT;
  v_rts_count INT;
  v_target_business_count INT;
BEGIN
  SELECT COUNT(*)
  INTO v_source_count
  FROM public.scalev_orders orders
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = orders.id
   AND expected.order_id = orders.order_id
   AND expected.source_business_code = orders.business_code
  WHERE orders.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
    AND orders.status IN ('shipped', 'completed')
    AND orders.shipped_time IS NOT NULL
    AND DATE(orders.shipped_time AT TIME ZONE 'Asia/Jakarta') >= DATE '2026-06-19';

  IF v_source_count <> 40 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: expected 40 qualifying Roove orders, found %',
      v_source_count;
  END IF;

  SELECT COUNT(*)
  INTO v_line_count
  FROM public.scalev_order_lines lines
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = lines.scalev_order_id
  WHERE lines.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID;

  IF v_line_count <> 63 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: expected 63 order lines, found %',
      v_line_count;
  END IF;

  SELECT COUNT(*)
  INTO v_ledger_count
  FROM public.warehouse_stock_ledger ledger
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = ledger.scalev_order_id;

  IF v_ledger_count <> 46 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: expected 46 historical ledger rows, found %',
      v_ledger_count;
  END IF;

  SELECT COUNT(*)
  INTO v_rts_count
  FROM public.warehouse_rts_verifications verification
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = verification.scalev_order_id;

  IF v_rts_count <> 0 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: % target orders have RTS verification dependencies',
      v_rts_count;
  END IF;

  SELECT COUNT(*)
  INTO v_target_collision_count
  FROM public.scalev_orders target_order
  JOIN expected_purvu_transfer expected
    ON expected.order_id = target_order.order_id
  WHERE target_order.workspace_id = '00000000-0000-4000-8000-000000000002'::UUID;

  IF v_target_collision_count <> 0 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: % order IDs already exist in Apurva',
      v_target_collision_count;
  END IF;

  SELECT COUNT(*)
  INTO v_target_business_count
  FROM public.scalev_webhook_businesses business
  WHERE business.workspace_id = '00000000-0000-4000-8000-000000000002'::UUID
    AND business.business_code = 'PRVA'
    AND business.is_active;

  IF v_target_business_count <> 1 THEN
    RAISE EXCEPTION
      'Purvu transfer aborted: active Apurva PRVA business count is %',
      v_target_business_count;
  END IF;
END;
$$;

INSERT INTO public.scalev_order_workspace_transfers (
  order_id,
  source_workspace_id,
  target_workspace_id,
  source_business_id,
  source_business_code,
  target_business_id,
  target_business_code,
  transferred_order_id,
  original_status,
  reason,
  metadata
)
SELECT
  orders.order_id,
  orders.workspace_id,
  '00000000-0000-4000-8000-000000000002'::UUID,
  source_business.id,
  orders.business_code,
  target_business.id,
  target_business.business_code,
  orders.id,
  orders.status,
  'Purvu sales ownership cutover effective 2026-06-19',
  jsonb_build_object(
    'source_seller_business_code', orders.seller_business_code,
    'source_origin_operator_business_code', orders.origin_operator_business_code,
    'source_origin_registry_id', orders.origin_registry_id,
    'source_store_name', orders.store_name,
    'historical_warehouse_ledger_retained_in_source', TRUE
  )
FROM public.scalev_orders orders
JOIN expected_purvu_transfer expected
  ON expected.scalev_order_id = orders.id
JOIN public.scalev_webhook_businesses source_business
  ON source_business.workspace_id = orders.workspace_id
 AND source_business.business_code = orders.business_code
JOIN public.scalev_webhook_businesses target_business
  ON target_business.workspace_id = '00000000-0000-4000-8000-000000000002'::UUID
 AND target_business.business_code = 'PRVA';

UPDATE public.scalev_orders orders
SET
  workspace_id = '00000000-0000-4000-8000-000000000002'::UUID,
  business_code = 'PRVA',
  seller_business_code = 'PRVA',
  -- The old registry row belongs to Roove. Raw origin fields and the canonical
  -- origin operator are retained as the historical fulfillment trace.
  origin_registry_id = NULL
FROM expected_purvu_transfer expected
WHERE orders.id = expected.scalev_order_id
  AND orders.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID;

UPDATE public.scalev_order_lines lines
SET
  workspace_id = '00000000-0000-4000-8000-000000000002'::UUID,
  product_type = 'Purvu',
  stock_owner_business_code = 'PRVA'
FROM expected_purvu_transfer expected
WHERE lines.scalev_order_id = expected.scalev_order_id
  AND lines.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID;

-- Updating the parent first means the old-workspace line trigger cannot see
-- the parent while each line moves. Rebuild both sales summary windows from
-- source-of-truth rows so Roove is subtracted and Apurva is added exactly once.
SELECT public.recalculate_workspace_summaries(
  '00000000-0000-4000-8000-000000000001'::UUID,
  DATE '2026-06-19',
  DATE '2026-07-27'
);
SELECT public.recalculate_workspace_summaries(
  '00000000-0000-4000-8000-000000000002'::UUID,
  DATE '2026-06-19',
  DATE '2026-07-27'
);

DO $$
DECLARE
  v_target_orders INT;
  v_target_lines INT;
  v_source_orders INT;
  v_retained_ledger_rows INT;
  v_transfer_rows INT;
BEGIN
  SELECT COUNT(*)
  INTO v_target_orders
  FROM public.scalev_orders orders
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = orders.id
  WHERE orders.workspace_id = '00000000-0000-4000-8000-000000000002'::UUID
    AND orders.business_code = 'PRVA';

  SELECT COUNT(*)
  INTO v_target_lines
  FROM public.scalev_order_lines lines
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = lines.scalev_order_id
  WHERE lines.workspace_id = '00000000-0000-4000-8000-000000000002'::UUID
    AND lines.product_type = 'Purvu';

  SELECT COUNT(*)
  INTO v_source_orders
  FROM public.scalev_orders orders
  JOIN expected_purvu_transfer expected
    ON expected.order_id = orders.order_id
  WHERE orders.workspace_id = '00000000-0000-4000-8000-000000000001'::UUID;

  SELECT COUNT(*)
  INTO v_retained_ledger_rows
  FROM public.warehouse_stock_ledger ledger
  JOIN expected_purvu_transfer expected
    ON expected.scalev_order_id = ledger.scalev_order_id;

  SELECT COUNT(*)
  INTO v_transfer_rows
  FROM public.scalev_order_workspace_transfers transfer
  JOIN expected_purvu_transfer expected
    ON expected.order_id = transfer.order_id
   AND expected.source_business_code = transfer.source_business_code
  WHERE transfer.source_workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
    AND transfer.target_workspace_id = '00000000-0000-4000-8000-000000000002'::UUID
    AND transfer.is_active;

  IF v_target_orders <> 40
     OR v_target_lines <> 63
     OR v_source_orders <> 0
     OR v_retained_ledger_rows <> 46
     OR v_transfer_rows <> 40 THEN
    RAISE EXCEPTION
      'Purvu transfer verification failed: target_orders=%, target_lines=%, source_orders=%, retained_ledger=%, transfer_rows=%',
      v_target_orders,
      v_target_lines,
      v_source_orders,
      v_retained_ledger_rows,
      v_transfer_rows;
  END IF;
END;
$$;

COMMIT;
