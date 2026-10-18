'use client';
import { useState } from 'react';
import type { CepCategory } from '@/lib/meta-ad-taxonomy';
import styles from '@/app/dashboard/meta-funnels/page.module.css';
export default function MetaCepPicker({ id, values, manual, catalog, disabled, onSave }: { id: string; values: string[]; manual: boolean; catalog: CepCategory[]; disabled: boolean; onSave: (values: string[] | null) => void }) {
  const [draft, setDraft] = useState(values);
  return <details className={styles.cepPicker}>
    <summary>{values.length ? values.map(k => catalog.find(c => c.key === k)?.label || k).join(' · ') : 'Belum terpetakan'}{manual ? ' · manual' : ''}</summary>
    <fieldset disabled={disabled}><legend>CEP ad {id} · boleh lebih dari satu</legend>
      {!catalog.length && <p>Brand ini belum memiliki daftar CEP. Tetapkan di Kategori iklan.</p>}
      {catalog.filter(c => c.is_active !== false || values.includes(c.key)).map(c => <label key={c.key} title={c.description}><input type="checkbox" checked={draft.includes(c.key)} disabled={c.is_active === false && !draft.includes(c.key)} onChange={e => setDraft(e.target.checked ? [...draft, c.key] : draft.filter(k => k !== c.key))} />{c.label}{c.is_active === false ? ' · nonaktif' : ''}</label>)}
      <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => onSave(draft)}>Simpan CEP</button><button type="button" className={styles.button} onClick={() => onSave(null)}>Gunakan aturan</button></div>
      {!draft.length && <small>Tidak ada CEP dipilih: tandai belum terpetakan.</small>}
    </fieldset>
  </details>;
}
