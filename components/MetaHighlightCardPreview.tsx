'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MetaLeakSnapshot } from '@/lib/meta-highlight-snapshot';
import { renderMetaLeakCard } from '@/lib/meta-highlight-card';
import styles from './MetaHighlightCardPreview.module.css';

export default function MetaHighlightCardPreview({ snapshot, onClose }: { snapshot: MetaLeakSnapshot; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useId();
  const [error, setError] = useState('');
  const card = renderMetaLeakCard(snapshot);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  function download() {
    let url: string | null = null;
    try {
      const file = new Blob([JSON.stringify({ snapshot, card: { template_version: card.template_version, title: card.title, body: card.body, body_format: card.body_format } }, null, 2)], { type: 'application/json' });
      url = URL.createObjectURL(file);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `meta-leak-${snapshot.snapshot_id}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setError('');
    } catch { setError('Snapshot belum berhasil diunduh. Silakan coba lagi.'); }
    finally { if (url) { const captured = url; window.setTimeout(() => URL.revokeObjectURL(captured), 1000); } }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={heading} onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className={styles.header}><div><p className={styles.eyebrow}>PRATINJAU · TIDAK DIKIRIM</p><h2 id={heading}>Kartu Basecamp</h2></div>
      <button type="button" className={styles.button} aria-label="Tutup pratinjau kartu Basecamp" onClick={onClose}>Tutup</button></header>
    <p className={styles.notice}>Snapshot beku dari laporan yang ditampilkan. Belum disimpan sebagai arsip permanen; unduh JSON jika ingin menyimpannya. Tidak ada koneksi atau posting ke Basecamp.</p>
    <section className={snapshot.quality.status === 'blocked' ? styles.blocked : styles.quality} aria-label="Kualitas snapshot">
      {card.qualityLines.map((text, i) => <p key={i}>{text}</p>)}
    </section>
    <article className={styles.card} aria-label="Isi kartu Basecamp">
      <h3>{card.title}</h3><p>{card.summary}</p>
      <div className={styles.tableWrap}><table><caption>{card.metric}</caption><thead><tr><th scope="col">Periode (WIB)</th><th scope="col">Rasio</th><th scope="col">Pembilang ÷ penyebut</th></tr></thead>
        <tbody>{[card.comparison.reference, card.comparison.current].map((value, index) => <tr key={index}><td>{value.period}</td><td>{value.value}</td><td>{value.evidence}</td></tr>)}</tbody></table></div>
      <p><strong>Perubahan relatif:</strong> {card.change}<br /><strong>Spend periode utama:</strong> {card.spend}</p>
      <section><h4>Cakupan</h4>{card.scopeLines.map((text, i) => <p key={i}>{text}</p>)}</section>
      <section><h4>Pemeriksaan yang disarankan</h4><ul>{card.checks.map(text => <li key={text}>{text}</li>)}</ul><p>{card.caution}</p></section>
      <section><h4>Kualitas data</h4>{card.qualityLines.map((text, i) => <p key={i}>{text}</p>)}</section>
      <footer>{card.sourceLines.map((text, i) => <p key={i}>{text}</p>)}</footer>
    </article>
    {error && <p role="alert" className={styles.blocked}>{error}</p>}
    <div className={styles.actions}><span>Tujuan, assignee, dan notifikasi belum dikonfigurasi.</span><button type="button" className={styles.button} onClick={download}>Unduh snapshot JSON</button></div>
  </dialog>;
}
