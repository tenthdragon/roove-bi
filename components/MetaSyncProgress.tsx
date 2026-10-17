'use client';

import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react';
import { metaSyncProgress, type MetaSyncJob } from '@/lib/meta-funnel-sync-status';
import type { getMetaFunnelSyncStatus } from '@/lib/meta-funnel-actions';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type SyncStatusData = Awaited<ReturnType<typeof getMetaFunnelSyncStatus>>;
const syncLabels: Record<string, string> = { queued: 'Menunggu', running: 'Berjalan', success: 'Berhasil', partial: 'Sebagian', failed: 'Gagal', canceled: 'Dibatalkan' };

export default function MetaSyncProgress({ progress, preparing, checking, status, accounts, error, onRefresh }: {
  progress: ReturnType<typeof metaSyncProgress> | null; preparing: boolean; checking: boolean;
  status: SyncStatusData | null; accounts: { account_id: string; account_name: string }[]; error: string; onRefresh: () => void;
}) {
  const latest = status?.jobs[0];
  if (!preparing && !checking && !progress && !latest && !error && !status?.pending) return null;
  const active = preparing || checking || !!status?.pending || !!progress?.active;
  const issues = progress ? progress.issues > 0 || progress.missing > 0 : latest && !['success', 'queued', 'running'].includes(latest.status);
  const label = preparing ? 'Menyiapkan sync…' : checking ? 'Memeriksa sync…'
    : progress && !progress.active && status?.pending ? 'Melengkapi data iklan…'
    : progress ? (progress.canceled === progress.total ? 'Sync dibatalkan' : progress.failed === progress.total ? 'Sync gagal'
      : { queued: 'Menunggu giliran', running: 'Sync berjalan', complete: 'Sync selesai', issues: 'Sync selesai dengan kendala', unavailable: 'Status sync tidak tersedia' }[progress.state])
      : status?.pending ? (status.running ? 'Sync berjalan' : 'Menunggu giliran') : latest ? `Sync terakhir: ${syncLabels[latest.status]?.toLowerCase() || latest.status}` : 'Status sync tidak tersedia';
  const Icon = preparing || checking || (active && (progress ? progress.state === 'running' : status?.running)) ? LoaderCircle : active ? Clock3 : issues ? AlertCircle : CheckCircle2;
  const jobs: MetaSyncJob[] = status?.trackedJobs || status?.jobs || [];
  const completedAt = progress?.completedAt || latest?.completed_at;
  const stamp = !active && completedAt ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(completedAt)) : '';
  return <div className={styles.syncArea}>
    <div className={`${styles.syncStatus} ${issues ? styles.syncWarning : !active ? styles.syncSuccess : ''}`} role="status" aria-live="polite">
      <Icon size={15} aria-hidden="true" className={Icon === LoaderCircle ? styles.syncSpinner : undefined} />
      <span>{label}</span>
      {progress && !preparing && !checking && <>
        <span className={styles.muted}>{progress.completed}/{progress.total} batch</span>
        {!progress.missing && <progress aria-label="Progres sync" max={progress.total} value={progress.completed} />}
        {!!progress.failed && <span>{progress.failed} gagal</span>}
        {!!progress.partial && <span>{progress.partial} sebagian</span>}
        {!!progress.canceled && <span>{progress.canceled} dibatalkan</span>}
      </>}
      {!progress && !!status?.pending && <span className={styles.muted}>{status.pending} batch tersisa</span>}
      {stamp && <span className={styles.muted}>{stamp} WIB</span>}
      {error && <button type="button" className={styles.syncRetry} onClick={onRefresh} title={error}>Status belum diperbarui · Coba lagi</button>}
    </div>
    {!!jobs.length && <details className={styles.syncDetails}><summary>Detail</summary>
      <div className={styles.syncJobList}>{jobs.map(job => <div key={job.id} className={styles.syncJob}>
        <span>{job.payload.date_start ? `${job.payload.date_start} – ${job.payload.date_end}` : 'Data terbaru'}</span><span>{syncLabels[job.status] || job.status}</span>
        <span className={styles.syncAccount}>{accounts.find(account => account.account_id === job.payload.account_id)?.account_name || job.payload.account_id || 'Seluruh akun'}</span>
        {job.error_message && <small>{job.error_message}</small>}
      </div>)}</div>
    </details>}
  </div>;
}
