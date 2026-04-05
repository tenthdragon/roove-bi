-- ============================================================
-- Backfill: Resolve generic product_name from raw_data Variant keys
-- ============================================================
-- Generic names like "Roove", "Purvu", "Osgard" etc. are parent product
-- names in ScaleV. The actual variant is stored in raw_data as:
--   "Variant: Roove Blueberry - 20 Sc" → "1" (quantity)
--
-- This migration:
-- 1. For single-variant orders: updates product_name to the variant
-- 2. For multi-variant orders: updates first line + inserts additional lines
-- ============================================================

CREATE OR REPLACE FUNCTION _backfill_generic_names()
RETURNS TABLE(updated INT, split INT, skipped INT) AS $$
DECLARE
  rec RECORD;
  variant_name TEXT;
  variant_qty INT;
  variants JSONB;
  v_key TEXT;
  v_val TEXT;
  first_done BOOLEAN;
  cnt_updated INT := 0;
  cnt_split INT := 0;
  cnt_skipped INT := 0;
  original_line RECORD;
BEGIN
  -- Process each generic order line
  FOR rec IN
    SELECT ol.id AS line_id, ol.scalev_order_id, ol.product_name, ol.quantity,
           ol.product_price_bt, ol.discount_bt, ol.cogs_bt, ol.tax_rate,
           ol.product_type, ol.sales_channel, ol.variant_sku,
           ol.is_purchase_fb, ol.is_purchase_tiktok, ol.is_purchase_kwai,
           ol.synced_at, ol.order_id,
           o.raw_data
    FROM scalev_order_lines ol
    JOIN scalev_orders o ON o.id = ol.scalev_order_id
    WHERE ol.product_name IN ('Roove', 'Purvu', 'Osgard', 'Globite', 'Pluve', 'Calmara', 'YUV',
                              'Almona', 'Roove Coklat', 'Roove Mixberry')
      AND o.raw_data IS NOT NULL
  LOOP
    -- Extract Variant: keys with non-empty values
    variants := '{}'::JSONB;
    FOR v_key, v_val IN
      SELECT key, value::TEXT
      FROM jsonb_each_text(rec.raw_data::JSONB)
      WHERE key LIKE 'Variant:%'
        AND value IS NOT NULL
        AND value != ''
        AND value != '0'
    LOOP
      variant_name := TRIM(REPLACE(v_key, 'Variant: ', ''));
      variant_name := TRIM(REPLACE(variant_name, 'Variant:', ''));
      variant_qty := 0;
      BEGIN
        variant_qty := v_val::INT;
      EXCEPTION WHEN OTHERS THEN
        variant_qty := 1;
      END;
      IF variant_qty > 0 THEN
        variants := variants || jsonb_build_object(variant_name, variant_qty);
      END IF;
    END LOOP;

    -- Skip if no variants found
    IF variants = '{}'::JSONB THEN
      cnt_skipped := cnt_skipped + 1;
      CONTINUE;
    END IF;

    -- Single variant: just update product_name and quantity
    IF (SELECT COUNT(*) FROM jsonb_object_keys(variants)) = 1 THEN
      SELECT key, value::TEXT::INT INTO variant_name, variant_qty
      FROM jsonb_each_text(variants) LIMIT 1;

      UPDATE scalev_order_lines
      SET product_name = variant_name,
          quantity = variant_qty
      WHERE id = rec.line_id;

      cnt_updated := cnt_updated + 1;

    -- Multi variant: update first, insert rest
    ELSE
      first_done := FALSE;
      FOR variant_name, v_val IN
        SELECT key, value::TEXT FROM jsonb_each_text(variants)
      LOOP
        variant_qty := v_val::INT;

        IF NOT first_done THEN
          -- Update existing line
          UPDATE scalev_order_lines
          SET product_name = variant_name,
              quantity = variant_qty
          WHERE id = rec.line_id;
          first_done := TRUE;
          cnt_updated := cnt_updated + 1;
        ELSE
          -- Insert additional line
          INSERT INTO scalev_order_lines (
            scalev_order_id, order_id, product_name, product_type,
            variant_sku, quantity, product_price_bt, discount_bt,
            cogs_bt, tax_rate, sales_channel,
            is_purchase_fb, is_purchase_tiktok, is_purchase_kwai, synced_at
          ) VALUES (
            rec.scalev_order_id, rec.order_id, variant_name, rec.product_type,
            rec.variant_sku, variant_qty, 0, 0,
            0, rec.tax_rate, rec.sales_channel,
            rec.is_purchase_fb, rec.is_purchase_tiktok, rec.is_purchase_kwai, rec.synced_at
          );
          cnt_split := cnt_split + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN QUERY SELECT cnt_updated, cnt_split, cnt_skipped;
END;
$$ LANGUAGE plpgsql;

-- Run backfill
SELECT * FROM _backfill_generic_names();

-- Cleanup
DROP FUNCTION _backfill_generic_names();

-- Re-sync mapping table with new product names
SELECT warehouse_sync_scalev_names();
