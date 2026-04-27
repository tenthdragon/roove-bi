ALTER TABLE public.scalev_orders
  ADD COLUMN IF NOT EXISTS marketplace_tracking_number TEXT;

COMMENT ON COLUMN public.scalev_orders.marketplace_tracking_number IS
  'Normalized marketplace shipment tracking number for indexed order matching; null when unavailable.';

UPDATE public.scalev_orders AS so
SET marketplace_tracking_number = NULLIF(
  REGEXP_REPLACE(
    UPPER(
      TRIM(
        COALESCE(
          so.marketplace_tracking_number,
          so.raw_data::jsonb #>> '{projection_rows,0,shipment_receipt}',
          so.raw_data::jsonb #>> '{projection_rows,0,tracking_number}',
          so.raw_data::jsonb #>> '{projection_rows,0,resi}',
          so.raw_data::jsonb #>> '{marketplace_upload,trackingNumber}',
          so.raw_data::jsonb #>> '{marketplace_upload,tracking_number}',
          so.raw_data::jsonb ->> 'shipment_receipt',
          so.raw_data::jsonb ->> 'tracking_number',
          so.raw_data::jsonb ->> 'receipt_number',
          so.raw_data::jsonb ->> 'resi',
          so.raw_data::jsonb ->> 'airway_bill',
          so.raw_data::jsonb ->> 'shipping_receipt',
          so.raw_data::jsonb ->> 'delivery_tracking_number',
          so.raw_data::jsonb #>> '{destination_address,resi}',
          so.raw_data::jsonb #>> '{destination_address,tracking_number}',
          so.raw_data::jsonb #>> '{origin_address,resi}',
          so.raw_data::jsonb #>> '{origin_address,tracking_number}'
        )
      )
    ),
    '[^A-Z0-9]+',
    '',
    'g'
  ),
  ''
)
WHERE so.raw_data IS NOT NULL
  AND COALESCE(so.marketplace_tracking_number, '') = '';

CREATE INDEX IF NOT EXISTS idx_scalev_orders_business_marketplace_tracking_source_store
  ON public.scalev_orders (business_code, marketplace_tracking_number, source, store_name)
  WHERE marketplace_tracking_number IS NOT NULL;
