-- ============================================================
-- Fix duplicate scalev_order_lines inflating revenue
--
-- Root cause: No UNIQUE constraint on (scalev_order_id, product_name).
-- Webhook handler uses non-atomic delete-insert pattern, and race
-- conditions from multiple webhook fires create duplicate rows.
--
-- Impact: 284 extra rows across 279 orders, inflating revenue by ~Rp 67.8M
-- ============================================================

-- Step 1: Delete duplicate rows, keeping the one with the lowest id
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY scalev_order_id, product_name ORDER BY id) AS rn
  FROM scalev_order_lines
)
DELETE FROM scalev_order_lines
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: Add unique constraint to prevent future duplicates
ALTER TABLE scalev_order_lines
  ADD CONSTRAINT uq_order_line_product
  UNIQUE (scalev_order_id, product_name);
