'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { isDefaultMetaColumns, moveMetaColumn, reconcileMetaColumns, type MetaColumnPreference, type MetaResultColumn } from '@/lib/meta-column-preferences';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

export default function MetaColumnEditor({ name, columns, preference, onSave, onClose }: {
  name: string; columns: MetaResultColumn[]; preference?: MetaColumnPreference | null;
  onSave: (preference: MetaColumnPreference | null) => Promise<void>; onClose: () => void;
}) {
  const title = useId(), dialog = useRef<HTMLDialogElement>(null), dragging = useRef<string | null>(null);
  const [draft, setDraft] = useState(() => reconcileMetaColumns(columns, preference));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byKey = new Map(columns.map(c => [c.key, c]));
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => { element.close(); }; }, []);
  function close() { dialog.current?.close(); onClose(); }
  const count = draft.order.length - draft.hidden.length;
  function move(key: string, target: number) {
    setDraft(value => ({ ...value, order: moveMetaColumn(value.order, key, target) }));
    setStatus(`${byKey.get(key)!.label} dipindahkan ke posisi ${target + 1}.`);
  }
  async function apply() {
    if (busy || !count) return;
    setBusy(true); setError('');
    try { await onSave(isDefaultMetaColumns(columns, draft) ? null : draft); close(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Pengaturan kolom gagal disimpan.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.columnDialog} aria-labelledby={title}
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className={styles.columnDialogHead}><div><h2 id={title}>Atur kolom</h2><p>{name}</p></div>
      <button type="button" className={styles.button} aria-label="Tutup pengaturan kolom" disabled={busy} onClick={close}><X size={18} /></button></div>
    <p className={styles.muted}>Pilih kolom yang ditampilkan. Geser pegangan atau gunakan tombol naik dan turun untuk mengatur urutannya.</p>
    <div className={styles.columnPinned}><strong>Tujuan</strong><span>Selalu ditampilkan di awal</span></div>
    <ol className={styles.columnList} aria-label="Urutan kolom">
      {draft.order.map((key, index) => <li key={key} className={dropTarget === key ? styles.columnDropTarget : undefined}
        onDragOver={e => { if (!busy && dragging.current) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(key); } }}
        onDrop={e => { e.preventDefault(); if (!busy && dragging.current) move(dragging.current, index); dragging.current = null; setDropTarget(null); }}>
        <button type="button" className={styles.columnGrip} draggable={!busy} disabled={busy} aria-label={`Geser kolom ${byKey.get(key)!.label}`} title="Geser untuk mengubah urutan"
          onDragStart={e => { dragging.current = key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); }}
          onDragEnd={() => { dragging.current = null; setDropTarget(null); }}><GripVertical size={18} /></button>
        <label className={styles.columnCheck}><input type="checkbox" checked={!draft.hidden.includes(key)} disabled={busy}
          onChange={e => { const checked = e.target.checked; setDraft(value => ({ ...value, hidden: checked ? value.hidden.filter(k => k !== key) : [...value.hidden, key] })); }} />{byKey.get(key)!.label}</label>
        <div className={styles.columnMoves}>
          <button type="button" className={styles.button} aria-label={`Naikkan ${byKey.get(key)!.label}`} disabled={busy || index === 0} onClick={() => move(key, index - 1)}><ArrowUp size={16} /></button>
          <button type="button" className={styles.button} aria-label={`Turunkan ${byKey.get(key)!.label}`} disabled={busy || index === draft.order.length - 1} onClick={() => move(key, index + 1)}><ArrowDown size={16} /></button>
        </div>
      </li>)}
    </ol>
    <span className={styles.srOnly} role="status">{status}</span>
    {!count && <p role="alert" className={styles.error}>Pilih minimal satu kolom selain Tujuan.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.columnDialogFoot}>
      <button type="button" className={styles.button} disabled={busy} onClick={() => { setDraft(reconcileMetaColumns(columns)); setStatus('Susunan default dipilih. Tekan Terapkan untuk menyimpan.'); }}>Reset ke default</button>
      <div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={close}>Batal</button>
        <button type="button" className={styles.primary} disabled={busy || !count} onClick={() => void apply()}>{busy ? 'Menyimpan…' : 'Terapkan'}</button></div>
    </div>
    <p className={styles.columnHint}>Disimpan untuk akun Anda pada template ini, termasuk saat digunakan oleh brand lain.</p>
  </dialog>;
}
