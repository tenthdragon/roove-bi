import type { SupabaseClient } from '@supabase/supabase-js';

export const META_SYNC_JOB_FIELDS = 'id,status,error_message,created_at,started_at,completed_at,payload';
export type MetaSyncJob = {
  id: string; status: string; error_message: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
  payload: { date_start?: string; date_end?: string; account_id?: string };
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

export async function loadMetaSyncJobs(svc: SupabaseClient, workspaceId: string, input: unknown): Promise<MetaSyncJob[]> {
  const ids = validateMetaSyncJobIds(input), jobs: MetaSyncJob[] = [];
  // Keep PostgREST URLs bounded and read every requested batch, including reused jobs.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await svc.from('sync_jobs').select(META_SYNC_JOB_FIELDS)
      .eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_funnels_only: true })
      .in('id', ids.slice(offset, offset + 100));
    if (result.error) throw new Error(result.error.message);
    jobs.push(...(result.data || []) as MetaSyncJob[]);
  }
  return jobs;
}
