-- ============================================================
-- 112: Generic sync job queue for long-running back-office syncs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL CHECK (job_name IN (
    'daily_ads_sync',
    'meta_sync',
    'financial_sync',
    'warehouse_sync',
    'scalev_sync'
  )),
  route TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'running',
    'success',
    'partial',
    'failed',
    'canceled'
  )),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  request_id TEXT NULL,
  dedupe_key TEXT NULL,
  requested_by UUID NULL REFERENCES public.profiles(id),
  requested_by_name TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  priority INT NOT NULL DEFAULT 100,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  duration_ms INT NULL,
  rows_processed INT NULL,
  result_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_available
  ON public.sync_jobs (status, priority, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_job_name_created
  ON public.sync_jobs (job_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_created
  ON public.sync_jobs (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_jobs_active_dedupe
  ON public.sync_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

DROP TRIGGER IF EXISTS set_updated_at_sync_jobs ON public.sync_jobs;
CREATE TRIGGER set_updated_at_sync_jobs
  BEFORE UPDATE ON public.sync_jobs
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMENT ON TABLE public.sync_jobs IS
  'Generic queue for long-running sync jobs that should be processed outside request-response paths.';

CREATE OR REPLACE FUNCTION public.claim_next_sync_job(p_worker_id TEXT DEFAULT NULL)
RETURNS SETOF public.sync_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.sync_jobs
    WHERE status = 'queued'
      AND available_at <= NOW()
      AND attempt_count < max_attempts
    ORDER BY priority ASC, available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ),
  updated AS (
    UPDATE public.sync_jobs AS j
    SET status = 'running',
        started_at = COALESCE(j.started_at, NOW()),
        locked_at = NOW(),
        locked_by = COALESCE(p_worker_id, 'sync-worker'),
        attempt_count = j.attempt_count + 1,
        updated_at = NOW(),
        error_message = NULL
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.*
  )
  SELECT * FROM updated;
END;
$$;

COMMENT ON FUNCTION public.claim_next_sync_job(TEXT) IS
  'Atomically claims the next queued sync job using FOR UPDATE SKIP LOCKED.';

CREATE OR REPLACE FUNCTION public.requeue_stale_sync_jobs(p_stale_after_minutes INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count INT := 0;
BEGIN
  WITH updated AS (
    UPDATE public.sync_jobs AS j
    SET status = CASE
          WHEN j.attempt_count >= j.max_attempts THEN 'failed'
          ELSE 'queued'
        END,
        available_at = CASE
          WHEN j.attempt_count >= j.max_attempts THEN j.available_at
          ELSE NOW()
        END,
        started_at = CASE
          WHEN j.attempt_count >= j.max_attempts THEN COALESCE(j.started_at, NOW())
          ELSE NULL
        END,
        completed_at = CASE
          WHEN j.attempt_count >= j.max_attempts THEN NOW()
          ELSE NULL
        END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW(),
        error_message = CASE
          WHEN j.attempt_count >= j.max_attempts
            THEN COALESCE(j.error_message || E'\n', '') || 'Worker lock expired and max attempts reached.'
          ELSE COALESCE(j.error_message || E'\n', '') || 'Worker lock expired; job re-queued.'
        END
    WHERE j.status = 'running'
      AND j.locked_at IS NOT NULL
      AND j.locked_at < NOW() - make_interval(mins => GREATEST(p_stale_after_minutes, 1))
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.requeue_stale_sync_jobs(INT) IS
  'Requeues running jobs whose worker lock expired, or fails them when max attempts are exhausted.';
