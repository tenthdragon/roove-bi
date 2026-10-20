import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMetaSyncJobs, metaSyncProgress, type MetaSyncJob } from './meta-funnel-sync-status';
import { loadMetaSyncJobTree } from './meta-sync-job-tree';

/** Follow all requested inventory roots and their creative/catalog children, not the recent-job preview. */
export async function loadMetaAdMappingSyncJobs(svc: SupabaseClient, workspaceId: string, input: unknown) {
  const roots = (await loadMetaSyncJobs(svc, workspaceId, input)).filter(j => j.payload.ad_mapping_only);
  if (!roots.length) return [];
  return (await loadMetaSyncJobTree(svc, workspaceId, roots.map(j => j.id))).filter(j => j.payload.ad_mapping_only);
}

export function mappingSyncFeedback(jobIds: string[], jobs: MetaSyncJob[] | null, pending: number) {
  if (!jobs) return { active: true, issue: false, text: 'Memeriksa status sync pemetaan…', details: [] as string[] };
  const progress = metaSyncProgress([...jobIds, ...jobs.map(j => j.id)], jobs);
  const warnings = jobs.filter(j => j.result_summary?.warnings?.length || j.result_summary?.errors?.length || j.error_message);
  const issue = progress.issues > 0 || warnings.length > 0;
  const detailJobs = jobs.filter(j => ['failed', 'partial', 'canceled'].includes(j.status) || warnings.includes(j));
  const details = detailJobs.map(j => {
    const label = j.mode === 'meta_product_set_verify' ? 'Verifikasi katalog' : j.mode === 'ad_mapping_creatives' ? 'Creative dan tujuan' : 'Inventori iklan';
    const reason = [j.error_message, ...(j.result_summary?.errors || []), ...(j.result_summary?.warnings || [])].filter(Boolean);
    return `${label}${j.payload.account_id ? ` · ${j.payload.account_id}` : ''}: ${[...new Set(reason)].join('; ') || (j.status === 'canceled' ? 'Batch dibatalkan.' : 'Batch gagal atau hanya selesai sebagian.')}`;
  });
  const counts = [progress.failed && `${progress.failed} gagal`, progress.partial && `${progress.partial} selesai sebagian`, progress.canceled && `${progress.canceled} dibatalkan`].filter(Boolean).join(', ');
  if (progress.missing) return { active: true, issue: true, text: 'Status sebagian batch belum tersedia. Memeriksa kembali…', details };
  if (progress.active || pending > 0) return { active: true, issue,
    text: `Sync pemetaan berjalan. ${progress.completed} dari ${progress.total} batch selesai.${counts ? ` ${counts}.` : ''} Daftar diperbarui otomatis.`, details };
  return { active: false, issue, text: issue
    ? `Sync selesai dengan kendala. ${counts || 'Ada peringatan pada hasil sync'}.`
    : 'Sync selesai. Semua batch pemetaan berhasil.', details };
}
