-- ============================================================
-- Marketplace intake Shopee raw economics + Scalev projection
-- ============================================================
-- Menyimpan komponen harga marketplace yang kaya tanpa mengubah
-- perilaku lama. Formatter Scalev-compatible akan membaca kolom
-- ter-normalisasi ini untuk membentuk payload/CSV operasional.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_order_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_cancel_return_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_ship_by_deadline_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_order_created_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_payment_paid_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_ready_to_ship_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_order_completed_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_customer_username TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_customer_phone TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_address TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_district TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_city TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_province TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_postal_code TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_raw_shipping_address TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_buyer_note TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_seller_note TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_buyer_paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_total_payment_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_cost_buyer NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_estimated_shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_shipping_fee_estimated_deduction NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS mp_return_shipping_cost NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_parent_sku TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_reference_sku TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_price_initial NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_price_after_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_returned_quantity INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_total_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_discount_seller NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_discount_shopee NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_product_weight_grams NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_order_product_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_total_weight_grams NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_voucher_seller NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_cashback_coin NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_voucher_shopee NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_bundle_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_bundle_discount_shopee NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_bundle_discount_seller NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_shopee_coin_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS mp_credit_card_discount NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN marketplace_intake_orders.mp_order_status IS
  'Status pesanan asli dari export marketplace.';

COMMENT ON COLUMN marketplace_intake_orders.mp_cancel_return_status IS
  'Status pembatalan/pengembalian asli dari export marketplace.';

COMMENT ON COLUMN marketplace_intake_orders.mp_buyer_paid_amount IS
  'Nilai Dibayar Pembeli dari file marketplace.';

COMMENT ON COLUMN marketplace_intake_orders.mp_total_payment_amount IS
  'Nilai Total Pembayaran dari file marketplace.';

COMMENT ON COLUMN marketplace_intake_order_lines.mp_price_after_discount IS
  'Harga Setelah Diskon asli per line dari export marketplace. Ini mengikuti price yang dipakai CSV ops.';

COMMENT ON COLUMN marketplace_intake_order_lines.mp_total_discount IS
  'Total Diskon asli per line dari export marketplace.';
