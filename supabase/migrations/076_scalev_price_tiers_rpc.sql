-- RPC: Price tiers per ScaleV product_name (for mapping UI)
CREATE OR REPLACE FUNCTION warehouse_scalev_price_tiers()
RETURNS TABLE(product_name TEXT, price_tier NUMERIC, cnt BIGINT) AS $$
  SELECT product_name,
         ROUND(product_price_bt / quantity) AS price_tier,
         COUNT(*) AS cnt
  FROM scalev_order_lines
  WHERE product_name IS NOT NULL AND quantity > 0 AND product_price_bt > 0
  GROUP BY product_name, ROUND(product_price_bt / quantity)
  ORDER BY product_name, cnt DESC;
$$ LANGUAGE sql STABLE;
