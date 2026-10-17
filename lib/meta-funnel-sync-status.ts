import type { SupabaseClient } from '@supabase/supabase-js';

export const META_SYNC_JOB_FIELDS = 'id,status,error_message,created_at,started_at,completed_at,payload,mode,result_summary';
export type MetaSyncJob = {
  id: string; mode?: string; result_summary?: { warnings?: string[]; errors?: string[] }; status: string; error_message: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
  payload: { date_start?: string; date_end?: string; account_id?: string; ad_mapping_only?: boolean; verify_shopee_product_set?: boolean;
    meta_sync_bundle?: boolean; meta_bundle_enqueued?: boolean; meta_bundle_queue_error?: string | null };
};
export type MetaSyncRequest = { jobIds: string[]; startedAt: string };

export function validateMetaSyncJobIds(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > 5000
    || input.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error('Pilihan sync tidak valid.');
  }
  return [...new Set(input)];
}

export function restoreMetaSyncRequest(value: string | null): MetaSyncRequest | null {
  if (!value) return null;
  try {
    const saved = JSON.parse(value);
    if (typeof saved.startedAt !== 'string' || !Number.isFinite(Date.parse(saved.startedAt))) return null;
    return { jobIds: validateMetaSyncJobIds(saved.jobIds), startedAt: saved.startedAt };
  } catch { return null; }
}

export function metaSyncProgress(jobIds: string[], jobs: MetaSyncJob[]) {
  const wanted = new Set(jobIds), found = new Map(jobs.filter(j => wanted.has(j.id)).map(j => [j.id, j]));
  const counts = { queued: 0, running: 0, success: 0, partial: 0, failed: 0, canceled: 0 };
  let missing = wanted.size - found.size;
  for (const job of found.values()) {
    if (Object.hasOwn(counts, job.status)) counts[job.status as keyof typeof counts]++;
    else missing++;
  }
  const completed = counts.success + counts.partial + counts.failed + counts.canceled;
  const active = counts.queued + counts.running > 0;
  const issues = counts.partial + counts.failed + counts.canceled;
  const state = missing ? 'unavailable' : counts.running ? 'running' : counts.queued
    ? (completed ? 'running' : 'queued') : issues ? 'issues' : 'complete';
  return { ...counts, total: wanted.size, completed, missing, active, issues, state,
    completedAt: [...found.values()].map(j => j.completed_at || '').sort().at(-1) || null };
}

/** A saved manual run must not cover a newer scheduled/manual run forever. */
export function visibleMetaSyncProgress(request: MetaSyncRequest | null, trackedJobs: MetaSyncJob[] | null, recentJobs: MetaSyncJob[]) {
  if (!request || !trackedJobs) return null;
  const progress = metaSyncProgress([...request.jobIds, ...trackedJobs.map(j => j.id)], trackedJobs);
  // Keep following every requested batch while it is actually queued/running.
  if (progress.active) return progress;
  const wanted = new Set(request.jobIds);
  const started = Math.max(Date.parse(request.startedAt), ...trackedJobs.map(j => Date.parse(j.created_at) || 0));
  const superseded = recentJobs.some(j => !wanted.has(j.id) && Date.parse(j.created_at) > started);
  return superseded ? null : progress;
}

export async function loadMetaSyncJobs(svc: SupabaseClient, workspaceId: string, input: unknown): Promise<MetaSyncJob[]> {
  const ids = validateMetaSyncJobIds(input), jobs: MetaSyncJob[] = [];
  // Keep PostgREST URLs bounded and read every requested batch, including reused jobs.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await svc.from('sync_jobs').select(META_SYNC_JOB_FIELDS)
      .eq('workspace_id', workspaceId).eq('job_name', 'meta_sync')
      .in('id', ids.slice(offset, offset + 100));
    if (result.error) throw new Error(result.error.message);
    jobs.push(...(result.data || []) as MetaSyncJob[]);
  }
  return jobs;
}

export function metaSyncStage(job: MetaSyncJob): 'metrics' | 'metadata' | 'catalog' {
  if (job.mode === 'meta_product_set_verify' || job.payload.verify_shopee_product_set) return 'catalog';
  if (['ad_mapping', 'ad_mapping_creatives'].includes(job.mode || '') || job.payload.ad_mapping_only) return 'metadata';
  return 'metrics';
}
export function metaSyncStages(jobs: MetaSyncJob[]) {
  const stage = (key: ReturnType<typeof metaSyncStage>) => {
    const rows = jobs.filter(j => metaSyncStage(j) === key);
    return { ...metaSyncProgress(rows.map(j => j.id), rows), jobs: rows,
      warnings: rows.filter(j => (j.result_summary?.warnings || []).length > 0).length };
  };
  return { metrics: stage('metrics'), metadata: stage('metadata'), catalog: stage('catalog'),
    discovering: jobs.some(j => j.mode === 'ad_mapping' && ['queued', 'running'].includes(j.status)),
    queueError: jobs.find(j => j.payload.meta_bundle_queue_error)?.payload.meta_bundle_queue_error || null,
    preparing: jobs.some(j => j.payload.meta_sync_bundle && j.payload.meta_bundle_enqueued === false && !j.payload.meta_bundle_queue_error) };
}
export function metaMetricCompletedAt(jobs: MetaSyncJob[]) {
  return jobs.filter(j => metaSyncStage(j) === 'metrics' && j.completed_at).map(j => j.completed_at!).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

/** Job reads and the global active count can straddle a worker commit. */
export function shouldPollMetaSync(status: { pending: number; jobs: MetaSyncJob[]; trackedJobs: MetaSyncJob[] | null }) {
  return status.pending > 0 || [...status.jobs, ...(status.trackedJobs || [])].some(j => ['queued', 'running'].includes(j.status));
}
