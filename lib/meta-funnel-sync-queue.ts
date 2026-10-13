import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { getTodayWIB } from './sync-schedule';
import { shiftDay } from './meta-funnel-domain';

export async function enqueueMetaAdBatches(workspaceId: string, accounts: string[], from: string, to: string, requestedBy?: string) {
  const jobs: string[] = [];
  // Most recent weeks first, so monitoring is usable before older trend history finishes.
  for (let end = to; end >= from; end = shiftDay(end, -7)) {
    const start = [shiftDay(end, -6), from].sort()[1];
    const results = await Promise.all(accounts.map(async account_id => {
      const payload = { ad_funnels_only: true, account_id, date_start: start, date_end: end };
      const result = await enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_funnels',
        payload, requestedBy, dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_funnels', payload), maxAttempts: 3, priority: 20 });
      return result.job.id;
    }));
    jobs.push(...results);
  }
  return jobs;
}
export async function enqueueScheduledMetaAdBatches(svc: SupabaseClient, workspaceId: string, enqueue = enqueueMetaAdBatches) {
  const funnel = await svc.from('meta_ad_funnels').select('config').eq('workspace_id', workspaceId).eq('archived', false);
  if (funnel.error) {
    if (['42P01', 'PGRST205'].includes(funnel.error.code)) return 0;
    throw new Error(funnel.error.message);
  }
  if (!funnel.data?.length) return 0;
  const today = getTodayWIB(); const end = shiftDay(today, -1);
  const [accounts, coverage] = await Promise.all([
    svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true),
    svc.from('meta_ad_sync_coverage').select('account_id').eq('workspace_id', workspaceId).eq('metric_date', end).gte('synced_at', `${today}T00:00:00+07:00`),
  ]);
  if (accounts.error || coverage.error) throw new Error(accounts.error?.message || coverage.error?.message);
  const alreadySynced = new Set((coverage.data || []).map(c => c.account_id));
  const configs = funnel.data.map(f => f.config).filter(c => c.group_by === 'landing_page');
  const needed = (accounts.data || []).filter(a => !alreadySynced.has(a.account_id)
    && configs.some(c => !c.account_ids.length || c.account_ids.includes(a.account_id))).map(a => a.account_id);
  return needed.length ? (await enqueue(workspaceId, needed, shiftDay(end, -6), end)).length : 0;
}
