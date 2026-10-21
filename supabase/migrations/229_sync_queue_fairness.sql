-- Prevent chained sync batches from starving other eligible jobs.
-- Function-only change: existing execution grants and row locks are preserved.
CREATE OR REPLACE FUNCTION public.claim_next_sync_job(p_worker_id TEXT DEFAULT NULL)
RETURNS SETOF public.sync_jobs
LANGUAGE plpgsql
SET search_path TO pg_catalog, public, extensions, auth, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.sync_jobs
    WHERE status = 'queued'
      AND available_at <= NOW()
      AND attempt_count < max_attempts
    -- Once runnable for two minutes, a job joins an oldest-first lane.
    -- New high-priority continuation jobs cannot indefinitely overtake it.
    -- available_at starts this clock anew for delayed/retried work.
    ORDER BY
      CASE WHEN available_at <= NOW() - INTERVAL '2 minutes'
        THEN available_at END ASC NULLS LAST,
      priority ASC, available_at ASC, created_at ASC, id ASC
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
  'Atomically claims eligible sync jobs; jobs waiting two minutes run oldest-first ahead of fresh priority work. Uses FOR UPDATE SKIP LOCKED.';

