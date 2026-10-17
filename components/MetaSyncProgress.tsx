'use client';

import { AlertCircle, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react';
import { metaSyncProgress, metaSyncStages, metaSyncStage, type MetaSyncJob } from '@/lib/meta-funnel-sync-status';
import type { getMetaFunnelSyncStatus } from '@/lib/meta-funnel-actions';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type SyncStatusData = Awaited<ReturnType<typeof getMetaFunnelSyncStatus>>;
const syncLabels: Record<string, string> = { queued: 'Menunggu', running: 'Berjalan', success: 'Berhasil', partial: 'Sebagian', failed: 'Gagal', canceled: 'Dibatalkan' };
const stageLabels = { metrics: 'Metrik', metadata: 'Metadata iklan', catalog: 'Katalog' };
const stamp = (value: string | null) => value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value)) + ' WIB' : '';

export default function MetaSyncProgress({ progress, preparing, checking, status, accounts, error, onRefresh }: {
  progress: ReturnType<typeof metaSyncProgress> | null; preparing: boolean; checking: boolean;
  status: SyncStatusData | null; accounts: { account_id: string; account_name: string }[]; error: string; onRefresh: () => void;
}) {
  const jobs: MetaSyncJob[] = (progress ? status?.trackedJobs : status?.jobs) || [];
  if (!preparing && !checking && !jobs.length && !error && !status?.pending) return null;
  const stages = metaSyncStages(jobs), metrics = stages.metrics, metadata = stages.metadata, catalog = stages.catalog;
  const busy = preparing || checking || stages.preparing || metrics.active;
  const issues = !!stages.queueError || !!progress?.missing || metrics.issues > 0;
  const label = preparing || stages.preparing ? 'Menyiapkan sync…' : checking ? 'Memeriksa sync…'
    : progress?.missing ? 'Status metrik belum lengkap' : stages.queueError ? 'Antrean sync belum lengkap'
    : metrics.active ? metrics.running ? 'Sync metrik berjalan' : 'Metrik menunggu giliran'
    : metrics.total ? metrics.issues ? 'Sync metrik dengan kendala' : 'Metrik tersinkron'
    : 'Status metrik belum tersedia';
  const Icon = busy ? metrics.running || preparing || checking ? LoaderCircle : Clock3 : issues ? AlertCircle : metrics.total ? CheckCircle2 : Clock3;
  const metadataIssues = metadata.jobs.filter(j => !['success', 'queued', 'running'].includes(j.status) || (j.result_summary?.warnings || []).length > 0).length;
  const catalogIssues = catalog.issues + catalog.jobs.filter(j => !['partial', 'failed', 'canceled'].includes(j.status) && (j.result_summary?.warnings || []).length).length;
  return <div className={styles.syncArea}>
    <div className={`${styles.syncStatus} ${issues ? styles.syncWarning : !busy && metrics.total ? styles.syncSuccess : ''}`} role="status" aria-live="polite">
      <Icon size={15} aria-hidden="true" className={Icon === LoaderCircle ? styles.syncSpinner : undefined} />
      <span>{label}</span>
      {!!metrics.total && !preparing && !checking && <>
        <span className={styles.muted}>{metrics.completed}/{metrics.total} batch metrik</span>
        {!progress?.missing && !stages.queueError && <progress aria-label="Progres metrik" max={metrics.total} value={metrics.completed} />}
      </>}
      {!busy && metrics.completedAt && <span className={styles.muted}>{stamp(metrics.completedAt)}</span>}
      {error && <button type="button" className={styles.syncRetry} onClick={onRefresh} title={error}>Status belum diperbarui · Coba lagi</button>}
    </div>
    {!!metadata.total && <div className={`${styles.syncStatus} ${metadataIssues ? styles.syncWarning : !metadata.active ? styles.syncSuccess : ''}`} role="status" aria-live="polite">
      {metadata.active ? <LoaderCircle size={15} aria-hidden="true" className={styles.syncSpinner} /> : metadataIssues ? <AlertCircle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
      <span>{metadata.active ? stages.discovering ? 'Metadata · mendeteksi perubahan…' : 'Memperbarui metadata iklan…' : metadataIssues ? 'Metadata iklan dengan kendala' : 'Metadata iklan diperbarui'}</span>
      <span className={styles.muted}>{metadata.completed}/{metadata.total} batch metadata</span>
      {!stages.discovering && <progress aria-label="Progres metadata" max={metadata.total} value={metadata.completed} />}
      {!!metadataIssues && <span>{metadataIssues} batch perlu diperiksa</span>}
    </div>}
    {!!catalog.total && <div className={`${styles.syncStatus} ${catalogIssues ? styles.syncWarning : !catalog.active ? styles.syncSuccess : ''}`} role="status" aria-live="polite">
      {catalog.active ? <LoaderCircle size={15} aria-hidden="true" className={styles.syncSpinner} /> : catalogIssues ? <AlertCircle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
      <span>{catalog.active ? 'Memeriksa katalog…' : catalogIssues ? `Katalog: ${catalogIssues} perlu diperiksa` : 'Katalog terverifikasi'}</span>
      {catalog.active && <span className={styles.muted}>{catalog.completed}/{catalog.total} batch katalog</span>}
    </div>}
    {!!jobs.length && <details className={styles.syncDetails}><summary>Detail</summary>
      <div className={styles.syncJobList}>{jobs.map(job => <div key={job.id} className={styles.syncJob}>
        <span>{stageLabels[metaSyncStage(job)]}{job.payload.date_start ? ` · ${job.payload.date_start} – ${job.payload.date_end}` : ''}</span><span>{syncLabels[job.status] || job.status}</span>
        <span className={styles.syncAccount}>{accounts.find(account => account.account_id === job.payload.account_id)?.account_name || job.payload.account_id || 'Seluruh akun'}</span>
        {job.error_message && <small>{job.error_message}</small>}
        {(job.result_summary?.warnings || []).map((warning, i) => <small key={i}>{warning}</small>)}
      </div>)}</div>
    </details>}
  </div>;
}
