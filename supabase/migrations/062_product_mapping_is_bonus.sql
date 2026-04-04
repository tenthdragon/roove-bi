-- 062: Add is_bonus flag to product_mapping for bonus/free items
-- Bonus items (Shaker, Jam Tangan, etc.) get prorated revenue from ScaleV.
-- This flag lets the app reassign their revenue to the dominant brand in the order.

-- 1. Add is_bonus column
ALTER TABLE product_mapping ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT false;

-- 2. Mark bonus items
UPDATE product_mapping SET is_bonus = true
WHERE product_name IN (
  'Shaker Mini',
  'Shaker Roove Bulat',
  'Shaker Almona Bulat',
  'Shaker Pluve Bulat',
  'Shaker Orlando ungu',
  'Shaker Miami Roove - Biru Muda',
  'Shaker Drhyun - Kuning',
  'Shaker Drhyun - Hijau',
  'Shaker Drhyun - Biru',
  'Shaker Drhyun - Pink',
  'Jam Tangan Roove Bulat',
  'Jam Tangan Roove Kotak',
  'Brosur Roove',
  'Baby Gold'
);

-- 3. Remove shaker/jam tangan from Roove brand keywords (no longer needed)
UPDATE brands SET keywords = 'roove' WHERE LOWER(name) = 'roove';

-- 4. Backfill: reassign bonus order lines to dominant brand in their order
CREATE OR REPLACE FUNCTION fn_reassign_bonus_items()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec RECORD;
  v_dominant TEXT;
BEGIN
  -- Find all order lines whose product_name is a bonus item
  FOR rec IN
    SELECT l.id, l.scalev_order_id, l.order_id, l.product_type AS old_type
    FROM scalev_order_lines l
    JOIN product_mapping pm ON LOWER(pm.product_name) = LOWER(l.product_name)
    WHERE pm.is_bonus = true
  LOOP
    -- Find dominant non-bonus brand among sibling lines in the same order
    SELECT l2.product_type INTO v_dominant
    FROM scalev_order_lines l2
    LEFT JOIN product_mapping pm2 ON LOWER(pm2.product_name) = LOWER(l2.product_name)
    WHERE l2.order_id = rec.order_id
      AND l2.id != rec.id
      AND l2.product_type IS NOT NULL
      AND l2.product_type != 'Unknown'
      AND (pm2.is_bonus IS NULL OR pm2.is_bonus = false)
    GROUP BY l2.product_type
    ORDER BY SUM(l2.product_price_bt - l2.discount_bt) DESC
    LIMIT 1;

    -- If no dominant brand found (order is all bonus), keep as Other
    IF v_dominant IS NULL THEN
      v_dominant := 'Other';
    END IF;

    -- Update if different (trigger will auto-recompute summaries)
    IF rec.old_type IS DISTINCT FROM v_dominant THEN
      UPDATE scalev_order_lines SET product_type = v_dominant WHERE id = rec.id;
    END IF;
  END LOOP;
END;
$$;

-- Run the backfill
SELECT fn_reassign_bonus_items();

-- Clean up
DROP FUNCTION fn_reassign_bonus_items();
