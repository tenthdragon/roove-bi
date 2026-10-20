'use client';
import { useState } from 'react';
import type { CepCategory } from '@/lib/meta-ad-taxonomy';
import { saveMetaIntentionCategory, setMetaIntentionCategoryActive } from '@/lib/meta-ad-taxonomy-actions';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type Draft = Pick<CepCategory, 'key' | 'label' | 'description' | 'revision'>;
export default function MetaIntentionCatalog({ brandId, catalog, canManage, onSaved }: {
  brandId: number; catalog: CepCategory[]; canManage: boolean; onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function run(work: () => Promise<{ error?: string }>) {
    setBusy(true); setError('');
    try { const r = await work(); if (r.error) setError(r.error); else { setDraft(null); await onSaved(); } }
    catch { setError('Perubahan belum tersimpan. Muat ulang dan coba lagi.'); } finally { setBusy(false); }
  }
  return <section className={styles.card}>
    <div className={styles.sectionHeader}><h2>Intention brand</h2>{canManage && <button className={styles.primary} disabled={busy || !brandId} onClick={() => setDraft({ key: '', label: '', description: '', revision: 0 })}>+ Tambah intention</button>}</div>
    <p>Intention tambahan hanya berlaku pada brand ini. Nonaktifkan pilihan yang tidak lagi dipakai; pemetaan dan laporan historis tetap tersimpan.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {catalog.map(c => <div key={c.key} className={styles.cepCategoryRow}><div><b>{c.label}</b><span className={styles.muted}> · {c.is_active === false ? 'Nonaktif' : 'Aktif'}</span><p>{c.description}</p></div>
      {canManage && <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={() => setDraft(c)}>Edit</button><button className={styles.button} disabled={busy} onClick={() => {
        if (c.is_active === false || window.confirm(`Nonaktifkan ${c.label}? Aturan lama dan riwayat tetap berlaku.`)) void run(() => setMetaIntentionCategoryActive({ brandId, key: c.key, revision: c.revision, active: c.is_active === false }));
      }}>{c.is_active === false ? 'Aktifkan kembali' : 'Nonaktifkan'}</button></div>}</div>)}
    {draft && canManage && <form className={styles.taxonomyForm} onSubmit={e => { e.preventDefault(); void run(() => saveMetaIntentionCategory({ brandId, ...draft })); }}>
      <label>Nama intention<input required maxLength={100} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
      <label>Definisi<textarea required maxLength={1000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <div className={styles.actions}><button className={styles.primary} disabled={busy || !draft.label.trim() || !draft.description.trim()}>Simpan intention</button><button type="button" className={styles.button} disabled={busy} onClick={() => setDraft(null)}>Batal</button></div>
    </form>}
  </section>;
}
