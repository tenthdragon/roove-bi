'use client';

import { useState } from 'react';
import { MEASURES, type FunnelConfig, type FunnelMetric, type Measure } from '@/lib/meta-funnel-domain';
import { TEMPLATE_KIND_LABELS, templateKind, templateMainMetric } from '@/lib/meta-funnel-templates';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

const measureOptions = Object.entries(MEASURES);

/** Template editor: stages and result columns of one kind of landing page, plus its decline alerts. */
export default function MetaFunnelEditor({ value: c, onChange, accounts, busy, onSave, onClose, onArchive }: {
  value: FunnelConfig; onChange: (c: FunnelConfig) => void; accounts: { account_id: string; account_name: string }[];
  busy: boolean; onSave: () => void; onClose: () => void; onArchive?: () => void;
}) {
  const set = <K extends keyof FunnelConfig>(k: K, v: FunnelConfig[K]) => onChange({ ...c, [k]: v });
  const metricSet = (i: number, changes: Partial<FunnelMetric>) => set('metrics', c.metrics.map((m, n) => n === i ? { ...m, ...changes } : m));
  const [stage, setStage] = useState<Measure>('purchases');
  const kind = templateKind(c), main = templateMainMetric(c);
  return <form className={`${styles.card} ${styles.editor}`} onSubmit={e => { e.preventDefault(); onSave(); }}>
    <div className={styles.sectionHeader}><div><h2>{c.name || 'Template funnel'}</h2><p className={styles.muted}>Jenis {TEMPLATE_KIND_LABELS[kind]} · hasil utama {main ? main.label : 'belum ditentukan'}. Jenis mengikuti tahapan: purchase berarti Transaksi, lead atau conversation berarti Lead.</p></div>
      <div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={onClose}>Tutup</button>{onArchive && <button type="button" className={styles.button} disabled={busy} onClick={onArchive}>Arsipkan</button>}<button className={styles.primary} disabled={busy} type="submit">{busy ? 'Memproses…' : 'Simpan template'}</button></div></div>
    <div className={styles.formGrid}>
      <label>Nama template<input required maxLength={120} value={c.name} onChange={e => set('name', e.target.value)} /></label>
      <label>Deskripsi<textarea maxLength={2000} value={c.description} onChange={e => set('description', e.target.value)} /></label>
    </div>
    <div>
      <h3>Urutan tahapan</h3>
      <div className={styles.actions}>{c.stages.map((s, i) => <span className={styles.chip} key={s}>{MEASURES[s]}<button aria-label={`Pindahkan ${MEASURES[s]} ke kiri`} type="button" disabled={i === 0} onClick={() => { const stages = [...c.stages]; [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; set('stages', stages); }}>←</button><button type="button" aria-label={`Hapus tahap ${MEASURES[s]}`} onClick={() => set('stages', c.stages.filter(v => v !== s))}>×</button></span>)}
        <select aria-label="Tahap baru" value={stage} onChange={e => setStage(e.target.value as Measure)}>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
        <button type="button" className={styles.button} disabled={c.stages.includes(stage) || c.stages.length >= 12} onClick={() => set('stages', [...c.stages, stage])}>Tambah tahap</button></div>
    </div>
    <div>
      <h3>Kolom hasil di laporan</h3><p className={styles.muted}>Buat rasio dengan pembilang ÷ penyebut, atau pilih tanpa penyebut untuk memantau jumlah. Tentukan arah performa yang baik dan volume minimum.</p>
      {c.metrics.map((m, i) => <div className={styles.metricEditor} key={m.id}>
        <label>Label<input required maxLength={80} value={m.label} onChange={e => metricSet(i, { label: e.target.value })} /></label>
        <label>Pembilang<select value={m.numerator} onChange={e => metricSet(i, { numerator: e.target.value as Measure })}>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label>Penyebut<select value={m.denominator || ''} onChange={e => metricSet(i, { denominator: e.target.value as Measure || null })}><option value="">Tanpa penyebut</option>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label>Format<select value={m.format} onChange={e => metricSet(i, { format: e.target.value as FunnelMetric['format'] })}><option value="percent">Persentase</option><option value="number">Angka</option><option value="money">Mata uang</option><option value="multiple">Kelipatan</option></select></label>
        <label>Arah yang baik<select value={m.direction} onChange={e => metricSet(i, { direction: e.target.value as FunnelMetric['direction'] })}><option value="higher">Lebih tinggi</option><option value="lower">Lebih rendah</option></select></label>
        <label>Min. penyebut<input type="number" min={0} max={1e12} value={m.min_denominator} onChange={e => metricSet(i, { min_denominator: Number(e.target.value) })} /></label>
        <label className={styles.check}><input type="checkbox" checked={m.monitor} onChange={e => metricSet(i, { monitor: e.target.checked })} />Monitor</label>
        <button type="button" className={styles.button} aria-label={`Hapus metrik ${m.label}`} onClick={() => set('metrics', c.metrics.filter((_, n) => n !== i))}>Hapus</button>
      </div>)}
      <button type="button" className={styles.button} disabled={c.metrics.length >= 12} onClick={() => set('metrics', [...c.metrics, { id: `metric_${Date.now()}`, label: 'Metrik baru', numerator: 'purchases', denominator: null, format: 'number', direction: 'higher', monitor: true, min_denominator: 0 }])}>+ Metrik</button>
    </div>
    <details><summary>Notifikasi penurunan · {c.alerts_enabled ? `aktif, ambang ${c.drop_percent}%, jendela ${c.window_days} hari, jeda atribusi ${c.lag_days} hari` : 'nonaktif'}</summary><div className={styles.advanced}>
      <p className={styles.muted}>Perubahan aturan notifikasi dievaluasi saat sync berikutnya.</p>
      <label className={styles.check}><input type="checkbox" checked={c.alerts_enabled} onChange={e => set('alerts_enabled', e.target.checked)} />Aktifkan notifikasi dalam aplikasi untuk landing page template ini</label>
      <div className={styles.formGrid}>{([
        ['window_days', 'Periode dibanding periode sebelumnya (hari)', 1, 30], ['drop_percent', 'Ambang perubahan buruk (%)', 1, 100],
        ['min_impressions', 'Min. impressions per landing page / periode', 0, 1e9], ['min_spend', 'Min. spend per landing page / periode', 0, 1e12],
        ['lag_days', 'Jeda atribusi dari hari ini (hari)', 1, 7],
      ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input required type="number" min={min} max={max} value={c[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}</div>
    </div></details>
    <details><summary>Cakupan lanjutan · {c.account_ids.length ? `${c.account_ids.length} akun` : 'semua akun'}{c.name_filter ? ` · filter nama "${c.name_filter}"` : ''}</summary><div className={styles.advanced}>
      <p className={styles.muted}>Laporan brand memakai semua akun aktif. Cakupan ini hanya membatasi notifikasi penurunan.</p>
      <label>Akun yang dipantau (tanpa pilihan = semua akun aktif)</label><div className={styles.accountList}>{accounts.map(a => <label key={a.account_id}><input type="checkbox" checked={c.account_ids.includes(a.account_id)} onChange={e => set('account_ids', e.target.checked ? [...c.account_ids, a.account_id] : c.account_ids.filter(id => id !== a.account_id))} />{a.account_name}</label>)}</div>
      <div className={styles.formGrid}><label>Filter ad name opsional (kosong = semua)<input maxLength={200} value={c.name_filter} onChange={e => set('name_filter', e.target.value)} /></label>
        <label>Pencocokan nama<select value={c.match} onChange={e => set('match', e.target.value as FunnelConfig['match'])}><option value="contains">Mengandung teks</option><option value="exact">Nama sama persis</option></select></label></div>
    </div></details>
  </form>;
}
