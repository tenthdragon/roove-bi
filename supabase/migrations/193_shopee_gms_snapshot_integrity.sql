-- Keep every item snapshot attached to the campaign snapshot for the same
-- shop and exact reporting period. This complements the shop identity trigger.
ALTER TABLE public.shopee_gms_item_period_metrics
  DROP CONSTRAINT IF EXISTS shopee_gms_item_period_campaign_fkey;
ALTER TABLE public.shopee_gms_item_period_metrics
  ADD CONSTRAINT shopee_gms_item_period_campaign_fkey
  FOREIGN KEY (
    workspace_id,
    shop_config_id,
    campaign_id,
    period_start,
    period_end
  )
  REFERENCES public.shopee_gms_campaign_period_metrics (
    workspace_id,
    shop_config_id,
    campaign_id,
    period_start,
    period_end
  )
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE public.shopee_gms_item_period_metrics
  VALIDATE CONSTRAINT shopee_gms_item_period_campaign_fkey;

-- `campaign_not_found` is an authoritative response from Shopee for an exact
-- range. Clear only that range atomically; unavailable/whitelist errors never
-- call this function and therefore preserve the last valid snapshot.
CREATE OR REPLACE FUNCTION public.clear_shopee_gms_period_snapshot(
  p_workspace_id UUID,
  p_shop_config_id INT,
  p_shop_id BIGINT,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_count INT := 0;
  v_campaign_count INT := 0;
BEGIN
  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'Shop GMV Max snapshot requires at least two dates';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.shopee_shops shop
    WHERE shop.id = p_shop_config_id
      AND shop.workspace_id = p_workspace_id
      AND shop.shop_id = p_shop_id
  ) THEN
    RAISE EXCEPTION 'Shopee shop does not match the requested workspace';
  END IF;

  DELETE FROM public.shopee_gms_item_period_metrics
  WHERE workspace_id = p_workspace_id
    AND shop_config_id = p_shop_config_id
    AND period_start = p_period_start
    AND period_end = p_period_end;
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  DELETE FROM public.shopee_gms_campaign_period_metrics
  WHERE workspace_id = p_workspace_id
    AND shop_config_id = p_shop_config_id
    AND period_start = p_period_start
    AND period_end = p_period_end;
  GET DIAGNOSTICS v_campaign_count = ROW_COUNT;

  RETURN v_campaign_count + v_item_count;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_shopee_gms_period_snapshot(
  UUID, INT, BIGINT, DATE, DATE
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_shopee_gms_period_snapshot(
  UUID, INT, BIGINT, DATE, DATE
) TO service_role;
