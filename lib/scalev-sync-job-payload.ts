import type { SyncJobRecord } from './sync-jobs';

function parseOptionalPositiveInt(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function buildNextScalevSyncJobPayload(
  job: SyncJobRecord,
  resultSummary: Record<string, any> | null | undefined,
): Record<string, unknown> | null {
  if (job.job_name !== 'scalev_sync') return null;

  const currentPayload = job.payload || {};
  const syncMode = typeof currentPayload.mode === 'string' ? currentPayload.mode : 'full';
  if (syncMode !== 'full') return null;
  if (resultSummary?.has_more !== true) return null;

  const nextAfterId = parseOptionalPositiveInt(resultSummary?.next_after_id);
  if (!nextAfterId) return null;

  return {
    ...currentPayload,
    mode: 'full',
    after_id: nextAfterId,
  };
}
