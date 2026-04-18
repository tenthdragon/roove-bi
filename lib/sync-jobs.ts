import { createServiceSupabase } from './service-supabase';

export const SYNC_JOB_NAMES = [
  'daily_ads_sync',
  'meta_sync',
  'financial_sync',
  'warehouse_sync',
  'scalev_sync',
] as const;

export type SyncJobName = typeof SYNC_JOB_NAMES[number];
export type SyncJobTerminalStatus = 'success' | 'partial' | 'failed';
export type SyncJobStatus = 'queued' | 'running' | SyncJobTerminalStatus | 'canceled';

export type SyncJobRecord = {
  id: string;
  job_name: SyncJobName;
  route: string;
  mode: string;
  status: SyncJobStatus;
  payload: Record<string, unknown>;
  request_id: string | null;
  dedupe_key: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  attempt_count: number;
  max_attempts: number;
  priority: number;
  available_at: string;
  started_at: string | null;
  completed_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  duration_ms: number | null;
  rows_processed: number | null;
  result_summary: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type EnqueueSyncJobInput = {
  jobName: SyncJobName;
  route: string;
  mode: string;
  payload?: Record<string, JsonValue>;
  dedupeKey?: string;
  requestedBy?: string | null;
  requestedByName?: string | null;
  requestId?: string | null;
  maxAttempts?: number;
  priority?: number;
  availableAt?: string;
};

type FinalizeSyncJobInput = {
  jobId: string;
  status: SyncJobTerminalStatus;
  resultSummary?: Record<string, JsonValue>;
  errorMessage?: string | null;
  rowsProcessed?: number | null;
  durationMs?: number | null;
};

function normalizeJob(row: any): SyncJobRecord {
  return {
    id: row.id,
    job_name: row.job_name,
    route: row.route,
    mode: row.mode,
    status: row.status,
    payload: row.payload || {},
    request_id: row.request_id ?? null,
    dedupe_key: row.dedupe_key ?? null,
    requested_by: row.requested_by ?? null,
    requested_by_name: row.requested_by_name ?? null,
    attempt_count: Number(row.attempt_count || 0),
    max_attempts: Number(row.max_attempts || 0),
    priority: Number(row.priority || 0),
    available_at: row.available_at,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    locked_at: row.locked_at ?? null,
    locked_by: row.locked_by ?? null,
    duration_ms: row.duration_ms ?? null,
    rows_processed: row.rows_processed ?? null,
    result_summary: row.result_summary || {},
    error_message: row.error_message ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isUniqueViolation(error: any) {
  return error?.code === '23505';
}

function stableSortObject(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, JsonValue>>((acc, key) => {
        acc[key] = stableSortObject((value as Record<string, JsonValue>)[key]);
        return acc;
      }, {});
  }

  return value;
}

export function createSyncJobDedupeKey(
  jobName: SyncJobName,
  mode: string,
  payload: Record<string, JsonValue> = {}
) {
  return `${jobName}:${mode}:${JSON.stringify(stableSortObject(payload))}`;
}

export async function enqueueSyncJob(input: EnqueueSyncJobInput) {
  const svc = createServiceSupabase();
  const insertPayload = {
    job_name: input.jobName,
    route: input.route,
    mode: input.mode,
    payload: input.payload || {},
    dedupe_key: input.dedupeKey || null,
    requested_by: input.requestedBy || null,
    requested_by_name: input.requestedByName || null,
    request_id: input.requestId || null,
    max_attempts: input.maxAttempts ?? 3,
    priority: input.priority ?? 100,
    available_at: input.availableAt || new Date().toISOString(),
  };

  const { data, error } = await svc
    .from('sync_jobs')
    .insert(insertPayload)
    .select('*')
    .single();

  if (!error && data) {
    return { job: normalizeJob(data), isDuplicate: false };
  }

  if (input.dedupeKey && isUniqueViolation(error)) {
    const { data: existing, error: existingError } = await svc
      .from('sync_jobs')
      .select('*')
      .eq('dedupe_key', input.dedupeKey)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return { job: normalizeJob(existing), isDuplicate: true };
    }
  }

  if (error) throw error;
  throw new Error('Failed to enqueue sync job.');
}

export async function claimNextSyncJob(workerId: string) {
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('claim_next_sync_job', {
    p_worker_id: workerId,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row ? normalizeJob(row) : null;
}

export async function requeueStaleSyncJobs(staleAfterMinutes = 30) {
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('requeue_stale_sync_jobs', {
    p_stale_after_minutes: staleAfterMinutes,
  });

  if (error) throw error;
  return Number(data || 0);
}

export async function finalizeSyncJob(input: FinalizeSyncJobInput) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sync_jobs')
    .update({
      status: input.status,
      result_summary: input.resultSummary || {},
      error_message: input.errorMessage || null,
      rows_processed: input.rowsProcessed ?? null,
      duration_ms: input.durationMs ?? null,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq('id', input.jobId)
    .select('*')
    .single();

  if (error) throw error;
  return normalizeJob(data);
}

export async function failSyncJob(jobId: string, errorMessage: string, durationMs?: number | null) {
  return finalizeSyncJob({
    jobId,
    status: 'failed',
    errorMessage,
    durationMs,
  });
}

export async function getRecentSyncJobs(limit = 50) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sync_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(normalizeJob);
}
