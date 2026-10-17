'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { archiveMetaFunnel, saveMetaFunnel } from '@/lib/meta-funnel-actions';
import { createMetaTemplatePreset, deleteMetaTemplateRule, getMetaTemplateSettings, saveMetaTemplateRule } from '@/lib/meta-brand-actions';
import { MEASURES, type FunnelConfig } from '@/lib/meta-funnel-domain';
import { TEMPLATE_KIND_LABELS, type TemplateMatchKind } from '@/lib/meta-funnel-templates';
import { formatCompactMoney, formatDate } from '@/lib/meta-format';
import MetaAdsNav from '@/components/MetaAdsNav';
import MetaFunnelEditor from '@/components/MetaFunnelEditor';
import styles from '../page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaTemplateSettings>>, { schemaReady: true }>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const kindLabels: Record<TemplateMatchKind, string> = { exact: 'URL persis', prefix: 'Awalan URL', domain: 'Domain' };

export default function MetaTemplatesPage() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  const canManage = can('admin:meta');
  const [data, setData] = useState<Data | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<{ id?: string; version?: number; config: FunnelConfig } | null>(null);
  const [ruleForm, setRuleForm] = useState<{ funnelId: string; match_kind: TemplateMatchKind; pattern: string }>({ funnelId: '', match_kind: 'domain', pattern: '' });
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaTemplateSettings();
      if (current !== request.current) return;
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) { setData(result); setSelectedId(id => result.templates.some(t => t.id === id) ? id : result.templates[0]?.id || ''); }
    } catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, []);
  useEffect(() => { const guard = request; setData(null); setEditor(null); void load(); return () => { guard.current++; }; }, [load, activeWorkspace.id]);
  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (done) setNotice(done); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const selected = data?.templates.find(t => t.id === selectedId) || null;
  const ruleFor = (url: string) => data?.landingPages.find(lp => lp.url === url)?.rule || null;
  function assign(url: string, funnelId: string) {
    const existing = ruleFor(url);
    if (!funnelId) {
      if (existing?.match_kind === 'exact') return run(() => deleteMetaTemplateRule(existing.id), 'Aturan URL dihapus.');
      setNotice(existing ? `URL ini mengikuti aturan ${kindLabels[existing.match_kind]} "${existing.pattern}". Ubah atau hapus aturan itu di daftar aturan.` : 'URL ini belum punya aturan.');
      return;
    }
    return run(() => saveMetaTemplateRule({ id: existing?.match_kind === 'exact' ? existing.id : undefined, funnelId, match_kind: 'exact', pattern: url }), 'Template ditetapkan.');
  }
  return <div className={styles.page} aria-busy={loading}>
    <MetaAdsNav title="Template funnel" subtitle="Template menentukan tahapan dan kolom hasil untuk landing page Website. Satu landing page memakai satu template. CPAS tidak memakai template karena tahapannya tetap: outbound → Shopee → purchase."
      actions={canManage && schemaReady ? <>
        <button className={styles.button} disabled={busy} onClick={() => void run(() => createMetaTemplatePreset('transaction'), 'Template Transaksi dibuat.')}>+ Template Transaksi</button>
        <button className={styles.button} disabled={busy} onClick={() => void run(() => createMetaTemplatePreset('lead'), 'Template Lead dibuat.')}>+ Template Lead</button>
      </> : undefined} />
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    {!schemaReady ? <div className={styles.card}>Pengelompokan iklan belum tersedia. Hubungi admin untuk mengaktifkannya.</div> : <>
      {loading && !data && <p role="status" className={styles.muted}>Memuat template…</p>}
      {data && !data.rulesReady && <div className={styles.error} role="alert">Pasang migration 211_meta_landing_page_templates.sql agar aturan URL dapat disimpan. Template tetap bisa disunting.</div>}
      {data && <div className={styles.templateLayout}>
        <section aria-label="Daftar template" className={styles.templateList}>
          {!data.templates.length && <div className={styles.card}>Belum ada template. Mulai dari template Transaksi atau Lead di atas, lalu sesuaikan tahapannya.</div>}
          {data.templates.map(t => <button key={t.id} type="button" className={`${styles.templateItem} ${t.id === selectedId ? styles.templateItemActive : ''}`} aria-pressed={t.id === selectedId} onClick={() => { setSelectedId(t.id); setEditor(null); }}>
            <strong>{t.name}</strong>
            <span>{TEMPLATE_KIND_LABELS[t.kind]} · {t.rules} aturan URL · hasil utama {t.mainMetric?.label || '—'}</span>
            <div className={styles.stageChips}>{t.stages.filter(s => s !== 'spend').map(s => <span key={s} className={styles.stageChip}>{MEASURES[s]}</span>)}</div>
          </button>)}
          <div className={styles.card}><span className={styles.muted}>Formulir "Funnel baru" yang lama menjadi editor template ini. Tahapan dan kolom hasil yang diisi di sini dipakai oleh laporan brand. Notifikasi penurunan dievaluasi per template, hanya untuk landing page yang terpetakan ke template itu.</span></div>
        </section>
        <section aria-label="Editor template" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          {editor ? <MetaFunnelEditor value={editor.config} onChange={config => setEditor({ ...editor, config })} accounts={data.accounts} busy={busy}
            onSave={() => void run(async () => { const result = await saveMetaFunnel(editor); setEditor(null); setSelectedId(result.id); if (result.warning) setNotice(result.warning); }, 'Template tersimpan.')}
            onClose={() => setEditor(null)}
            onArchive={editor.id ? () => { if (window.confirm('Arsipkan template ini? Aturan URL-nya ikut dihapus.')) void run(async () => { await archiveMetaFunnel(editor.id!); setEditor(null); }, 'Template diarsipkan.'); } : undefined} />
          : selected ? <div className={styles.card} style={{ display: 'grid', gap: 10 }}>
            <div className={styles.sectionHeader}><div><h2 style={{ margin: 0 }}>{selected.name}</h2><p className={styles.muted}>{selected.description || 'Tanpa deskripsi'}</p></div>
              {canManage && <button className={styles.primary} onClick={() => setEditor({ id: selected.id, version: selected.version, config: selected })}>Ubah template</button>}</div>
            <div><b style={{ fontSize: 12 }}>Urutan tahapan</b><div className={styles.stageChips} style={{ marginTop: 6 }}>{selected.stages.map(s => <span key={s} className={styles.stageChip} style={{ fontSize: 12, padding: '6px 10px' }}>{MEASURES[s]}</span>)}</div></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Kolom hasil</th><th>Pembilang</th><th>Penyebut</th><th>Arah baik</th><th>Monitor</th></tr></thead>
              <tbody>{selected.metrics.map(m => <tr key={m.id}><td style={{ fontWeight: m.id === selected.mainMetric?.id ? 650 : 500 }}>{m.label}{m.id === selected.mainMetric?.id && <small>Hasil utama</small>}</td><td>{MEASURES[m.numerator]}</td><td>{m.denominator ? MEASURES[m.denominator] : '—'}</td><td>{m.direction === 'higher' ? 'Lebih tinggi' : 'Lebih rendah'}</td><td>{m.monitor ? 'Ya' : 'Tidak'}</td></tr>)}</tbody></table></div>
            <span className={styles.muted}>Notifikasi penurunan {selected.alerts_enabled ? `aktif · ambang ${selected.drop_percent}% · jendela ${selected.window_days} hari · jeda atribusi ${selected.lag_days} hari` : 'nonaktif'}</span>
          </div> : null}
        </section>
      </div>}
      {data && <section aria-label="Pencocokan landing page" style={{ display: 'grid', gap: 10 }}>
        <div className={styles.sectionTitle}><h2>Pencocokan landing page</h2><span>Landing page Website dengan spend {formatDate(data.range.from)} – {formatDate(data.range.to)} · pola URL atau domain → template</span></div>
        <div className={styles.sectionCard}><div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}><table className={styles.rulesTable}>
          <thead><tr><th>Landing page</th><th>Brand</th><th style={{ textAlign: 'right' }}>Spend</th><th>Bukti dari data</th><th>Template</th><th>Status</th></tr></thead>
          <tbody>{data.landingPages.map(lp => {
            const status = lp.templateId ? { cls: styles.statusOk, label: lp.rule?.match_kind === 'exact' ? 'Dikonfirmasi' : `Ikut aturan ${kindLabels[lp.rule!.match_kind]}` } : lp.suggestion.funnelId ? { cls: styles.statusWarn, label: 'Belum ditetapkan' } : { cls: styles.statusInfo, label: 'Perlu keputusan' };
            return <tr key={lp.key}>
              <td style={{ minWidth: 240 }}><b style={{ overflowWrap: 'anywhere' }}>{lp.url}</b><small>{lp.ads} ad · {lp.accounts.join(', ')}</small></td>
              <td>{lp.brands.join(', ')}</td>
              <td style={{ textAlign: 'right' }}>{formatCompactMoney(lp.spend, data.currency)}</td>
              <td style={{ minWidth: 200 }}>{lp.suggestion.reason}</td>
              <td><select aria-label={`Template untuk ${lp.url}`} disabled={!canManage || busy || !data.rulesReady} value={lp.templateId || ''} onChange={e => void assign(lp.url, e.target.value)}>
                <option value="">{lp.suggestion.funnelId ? `Saran: ${data.templates.find(t => t.id === lp.suggestion.funnelId)?.name}` : 'Tanpa template'}</option>
                {data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></td>
              <td><span className={`${styles.statusTag} ${status.cls}`}>{status.label}</span>{canManage && !lp.templateId && lp.suggestion.funnelId && data.rulesReady && <small><button type="button" className={styles.nameButton} disabled={busy} onClick={() => void assign(lp.url, lp.suggestion.funnelId!)}>Konfirmasi saran</button></small>}</td>
            </tr>;
          })}</tbody>
        </table>{!data.landingPages.length && <p className={styles.muted} style={{ padding: 16 }}>Belum ada landing page Website dengan URL tunggal pada 30 hari terakhir.</p>}</div></div>
        <p className={styles.muted}>Saran otomatis membaca 30 hari terakhir: purchase &gt; 0 dan lead = 0 menyarankan Transaksi; lead &gt; 0 dan purchase = 0 menyarankan Lead; keduanya ada atau keduanya nol dibiarkan tanpa saran. Saran tidak pernah diterapkan sendiri.</p>
      </section>}
      {data && <section aria-label="Aturan URL" style={{ display: 'grid', gap: 10 }}>
        <div className={styles.sectionTitle}><h2>Aturan URL</h2><span>URL persis menang atas awalan URL, awalan menang atas domain; pola terpanjang didahulukan</span></div>
        {canManage && data.rulesReady && data.templates.length > 0 && <form className={`${styles.card} ${styles.inlineForm}`} onSubmit={e => { e.preventDefault(); void run(() => saveMetaTemplateRule(ruleForm), 'Aturan tersimpan.').then(() => setRuleForm(f => ({ ...f, pattern: '' }))); }}>
          <label>Jenis<select value={ruleForm.match_kind} onChange={e => setRuleForm({ ...ruleForm, match_kind: e.target.value as TemplateMatchKind })}>{(Object.keys(kindLabels) as TemplateMatchKind[]).map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
          <label style={{ flex: 1 }}>Pola<input required maxLength={4096} placeholder={ruleForm.match_kind === 'domain' ? 'purvu.id' : 'https://purvu.id/konsultasi'} value={ruleForm.pattern} onChange={e => setRuleForm({ ...ruleForm, pattern: e.target.value })} /></label>
          <label>Template<select required value={ruleForm.funnelId} onChange={e => setRuleForm({ ...ruleForm, funnelId: e.target.value })}><option value="">Pilih template…</option>{data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <button type="submit" className={styles.primary} disabled={busy || !ruleForm.funnelId}>+ Aturan URL</button>
        </form>}
        <div className={styles.sectionCard}><div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}><table className={styles.rulesTable}>
          <thead><tr><th>Jenis</th><th>Pola</th><th>Template</th><th /></tr></thead>
          <tbody>{data.rules.map(r => <tr key={r.id}><td>{kindLabels[r.match_kind]}</td><td style={{ overflowWrap: 'anywhere' }}>{r.pattern}</td><td>{r.templateName}</td>
            <td style={{ textAlign: 'right' }}>{canManage && <button type="button" className={styles.button} disabled={busy} onClick={() => void run(() => deleteMetaTemplateRule(r.id), 'Aturan dihapus.')}>Hapus</button>}</td></tr>)}</tbody>
        </table>{!data.rules.length && <p className={styles.muted} style={{ padding: 16 }}>Belum ada aturan. Tetapkan template dari tabel pencocokan atau tambahkan aturan domain agar seluruh website langsung terpetakan.</p>}</div></div>
      </section>}
    </>}
  </div>;
}
