BEGIN;

ALTER TABLE public.marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_updated_webhook_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_updated_authoritative_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_matched_external_id_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_matched_tracking_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.marketplace_intake_batches.app_last_promote_updated_webhook_count IS
  'Jumlah order promote terakhir yang meng-update row webhook existing.';

COMMENT ON COLUMN public.marketplace_intake_batches.app_last_promote_updated_authoritative_count IS
  'Jumlah order promote terakhir yang meng-update row marketplace_api_upload existing.';

COMMENT ON COLUMN public.marketplace_intake_batches.app_last_promote_matched_external_id_count IS
  'Jumlah order promote terakhir yang terikat via external_id.';

COMMENT ON COLUMN public.marketplace_intake_batches.app_last_promote_matched_tracking_count IS
  'Jumlah order promote terakhir yang terikat via tracking.';

COMMIT;
