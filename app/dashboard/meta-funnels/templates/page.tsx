'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { archiveMetaFunnel, saveMetaFunnel } from '@/lib/meta-funnel-actions';
import { createMetaTemplatePreset, deleteMetaTemplateRule, getMetaTemplateConfiguration, getMetaTemplateSettings, saveMetaTemplateRule } from '@/lib/meta-brand-actions';
import { MEASURES, type FunnelConfig } from '@/lib/meta-funnel-domain';
import { TEMPLATE_KIND_LABELS, validateTemplateRule, type TemplateMatchKind } from '@/lib/meta-funnel-templates';
import { applyMetaTemplateRules, metaTemplateError, META_TEMPLATE_SCHEMA_MESSAGE } from '@/lib/meta-template-settings';
import MetaTemplateSuggestionButton from '@/components/MetaTemplateSuggestionButton';
import { templateDestinationRule } from '@/lib/meta-ctwa-destinations';
import { formatCompactMoney, formatDate } from '@/lib/meta-format';
import MetaAdsNav from '@/components/MetaAdsNav';
import MetaFunnelEditor from '@/components/MetaFunnelEditor';
import styles from '../page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaTemplateSettings>>, { schemaReady: true }>;
const message = (e: unknown) => metaTemplateError(e, 'Permintaan belum berhasil. Silakan coba muat ulang halaman.');
const kindLabels: Record<TemplateMatchKind, string> = { exact: 'URL persis', prefix: 'Awalan URL', domain: 'Domain', ctwa: 'Tujuan WhatsApp' };

export default function MetaTemplatesPage() {
  const { activeWorkspace } = useWorkspace();
  const { can, role } = usePermissions();
  const canManage = role !== 'advertiser' && can('admin:meta');
  const [data, setData] = useState<Data | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<{ id?: string; version?: number; config: FunnelConfig } | null>(null);
  const [ruleForm, setRuleForm] = useState<{ funnelId: string; match_kind: TemplateMatchKind; pattern: string }>({ funnelId: '', match_kind: 'domain', pattern: '' });
  const request = useRef(0);
  const mutation = useRef(false);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaTemplateSettings();
      if (current !== request.current) return;
      if ('error' in result) { setError(result.error); return; }
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) { setData(result); setSelectedId(id => result.templates.some(t => t.id === id) ? id : result.templates[0]?.id || ''); }
    } catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const guard = request;
    mutation.current = false; setBusy(false); setPendingUrls([]); setNotice(''); setData(null); setEditor(null);
    void load();
    return () => { guard.current++; };
  }, [load, activeWorkspace.id]);
  async function run(work: (isCurrent: () => boolean) => Promise<unknown>, done?: string) {
    if (mutation.current) return;
    mutation.current = true;
    const current = request.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await work(() => current === request.current);
      if (current !== request.current) return;
      if (done) setNotice(done);
      const config = await getMetaTemplateConfiguration();
      if (current !== request.current) return;
      if ('error' in config) { setNotice(`${done || 'Perubahan tersimpan.'} ${config.error}`); return; }
      setData(previous => previous ? applyMetaTemplateRules({ ...previous, rulesReady: config.rulesReady }, config.rules, config.templates) : previous);
      setSelectedId(id => config.templates.some(t => t.id === id) ? id : config.templates[0]?.id || '');
    }
    catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) { mutation.current = false; setBusy(false); } }
  }
  async function changeRule(change: { save: Parameters<typeof saveMetaTemplateRule>[0] } | { remove: string }, done: string) {
    if (!data || mutation.current) return false;
    if (!data.rulesReady) { setError(META_TEMPLATE_SCHEMA_MESSAGE); return false; }
    const before = data, current = request.current;
    try {
      const rule = 'save' in change ? validateTemplateRule(change.save) : null;
      const optimisticRules = 'save' in change && rule
        ? [...before.rules.filter(r => !(r.id === change.save.id || (r.match_kind === rule.match_kind && r.pattern === rule.pattern))),
          { ...rule, id: change.save.id || 'pending-rule', funnel_id: change.save.funnelId }]
        : before.rules.filter(r => !('remove' in change) || r.id !== change.remove);
      const optimistic = applyMetaTemplateRules(before, optimisticRules);
      mutation.current = true; setBusy(true); setError(''); setNotice('');
      setPendingUrls(optimistic.landingPages.filter((lp, i) => lp.templateId !== before.landingPages[i].templateId || lp.rule?.id !== before.landingPages[i].rule?.id).map(lp => lp.key));
      setData(optimistic);
      const result = 'save' in change ? await saveMetaTemplateRule(change.save) : await deleteMetaTemplateRule(change.remove);
      if (current !== request.current) return false;
      if ('error' in result) {
        setData(result.code === 'TEMPLATE_SCHEMA_NOT_READY' ? { ...before, rulesReady: false } : before);
        setError(result.error); return false;
      }
      const rules = 'deletedId' in result
        ? before.rules.filter(r => r.id !== result.deletedId)
        : [...before.rules.filter(r => !(r.id === result.id || (r.match_kind === result.match_kind && r.pattern === result.pattern))), result];
      setData(applyMetaTemplateRules(before, rules)); setNotice(done);
      return true;
    } catch (e) {
      if (current === request.current) { setData(before); setError(message(e)); }
      return false;
    } finally {
      if (current === request.current) { mutation.current = false; setBusy(false); setPendingUrls([]); }
    }
  }
  const selected = data?.templates.find(t => t.id === selectedId) || null;
  function assign(lp: Data['landingPages'][number], funnelId: string) {
    const existing = lp.rule;
    const target = templateDestinationRule(lp);
    if (!funnelId) {
      if (existing?.match_kind === target.match_kind) return changeRule({ remove: existing.id }, 'Aturan tujuan dihapus.');
      setNotice(existing ? `Tujuan ini mengikuti aturan ${kindLabels[existing.match_kind]} "${existing.pattern}". Ubah atau hapus aturan itu di daftar aturan.` : 'Tujuan ini belum punya aturan.');
      return;
    }
    return changeRule({ save: { id: existing?.match_kind === target.match_kind ? existing.id : undefined, funnelId, ...target } }, 'Template ditetapkan.');
  }
  function assignmentTable(rows: Data['landingPages']) {
    return <div className={styles.sectionCard}><div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}><table className={styles.rulesTable}>
      <thead><tr><th>Landing page</th><th>Brand</th><th style={{ textAlign: 'right' }}>Spend</th><th>Bukti dari data</th><th>Template</th><th>Status</th></tr></thead>
      <tbody>{rows.map(lp => {
        const confirmed = lp.rule?.match_kind === 'exact' || lp.rule?.match_kind === 'ctwa';
        const status = lp.templateId ? { cls: styles.statusOk, label: confirmed ? 'Dikonfirmasi' : `Ikut aturan ${kindLabels[lp.rule!.match_kind]}` } : lp.suggestion.funnelId ? { cls: styles.statusWarn, label: 'Belum ditetapkan' } : { cls: styles.statusInfo, label: 'Perlu keputusan' };
        const pending = pendingUrls.includes(lp.key);
        return <tr key={lp.key}>
          <td style={{ minWidth: 240 }}>
            {(lp.landing_page_urls.length ? lp.landing_page_urls : ['WhatsApp · URL belum tersedia']).map(url => <b key={url} style={{ display: 'block', overflowWrap: 'anywhere' }}>{url}</b>)}
            {lp.destination && <small>{lp.destination.phone_number ? `No. WA: ${lp.destination.phone_number}` : lp.destination.status === 'multiple' ? 'No. WA perlu verifikasi' : `No. WA belum tersedia${lp.destination.page_id ? ` · Page ${lp.destination.page_id}` : ''}`}</small>}
            <small>{lp.ads} ad · {lp.accounts.join(', ')}</small>
          </td>
          <td>{lp.brands.join(', ')}</td><td style={{ textAlign: 'right' }}>{lp.currency ? formatCompactMoney(lp.spend, lp.currency) : 'Beda mata uang'}</td>
          <td style={{ minWidth: 200 }}>{lp.suggestion.reason}</td>
          <td><select aria-label={`Template untuk ${lp.label}`} disabled={!canManage || busy || !data?.rulesReady} value={lp.templateId || ''} onChange={e => void assign(lp, e.target.value)}>
            <option value="">{lp.suggestion.funnelId ? `Saran: ${data?.templates.find(t => t.id === lp.suggestion.funnelId)?.name}` : 'Tanpa template'}</option>
            {data?.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></td>
          <td><span role={pending ? 'status' : undefined} className={`${styles.statusTag} ${pending ? styles.statusWarn : status.cls}`}>{pending ? 'Menyimpan…' : status.label}</span>{canManage && !lp.templateId && lp.suggestion.funnelId && <small><MetaTemplateSuggestionButton className={styles.nameButton} rulesReady={!!data?.rulesReady} busy={busy} onApply={() => void assign(lp, lp.suggestion.funnelId!)}>Konfirmasi saran</MetaTemplateSuggestionButton></small>}</td>
        </tr>;
      })}</tbody>
    </table>{!rows.length && <p className={styles.muted} style={{ padding: 16 }}>Belum ada tujuan pada 30 hari terakhir.</p>}</div></div>;
  }
  return <div className={styles.page} aria-busy={loading}>
    <MetaAdsNav title="Template funnel" subtitle="Template menentukan tahapan dan kolom hasil untuk tujuan Website dan WhatsApp. Setiap tujuan memakai satu template; nomor WhatsApp dipisahkan per brand. CPAS tidak memakai template karena tahapannya tetap: outbound → Shopee → purchase."
      actions={canManage && schemaReady ? <>
        <button className={styles.button} disabled={busy || loading || !data} onClick={() => void run(() => createMetaTemplatePreset('transaction'), 'Template Transaksi dibuat.')}>+ Template Transaksi</button>
        <button className={styles.button} disabled={busy || loading || !data} onClick={() => void run(() => createMetaTemplatePreset('lead'), 'Template Lead dibuat.')}>+ Template Lead</button>
      </> : undefined} />
    {error && <div role="alert" className={styles.error}>{error} <button type="button" className={styles.button} disabled={busy || loading} onClick={() => void load()}>Muat ulang</button></div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    {!schemaReady ? <div className={styles.card}>Pengelompokan iklan belum tersedia. Hubungi admin untuk mengaktifkannya.</div> : <>
      {loading && !data && <p role="status" className={styles.muted}>Memuat template…</p>}
      {data && !data.rulesReady && error !== META_TEMPLATE_SCHEMA_MESSAGE && <div className={styles.error} role="alert">{META_TEMPLATE_SCHEMA_MESSAGE} Template tetap bisa disunting.</div>}
      {data && <div className={styles.templateLayout}>
        <section aria-label="Daftar template" className={styles.templateList}>
          {!data.templates.length && <div className={styles.card}>Belum ada template. Mulai dari template Transaksi atau Lead di atas, lalu sesuaikan tahapannya.</div>}
          {data.templates.map(t => <button key={t.id} type="button" className={`${styles.templateItem} ${t.id === selectedId ? styles.templateItemActive : ''}`} aria-pressed={t.id === selectedId} onClick={() => { setSelectedId(t.id); setEditor(null); }}>
            <strong>{t.name}</strong>
            <span>{TEMPLATE_KIND_LABELS[t.kind]} · {t.rules} aturan tujuan · hasil utama {t.mainMetric?.label || '—'}</span>
            <div className={styles.stageChips}>{t.stages.filter(s => s !== 'spend').map(s => <span key={s} className={styles.stageChip}>{MEASURES[s]}</span>)}</div>
          </button>)}
          <div className={styles.card}><span className={styles.muted}>Formulir "Funnel baru" yang lama menjadi editor template ini. Tahapan dan kolom hasil yang diisi di sini dipakai oleh laporan brand. Notifikasi penurunan dievaluasi per template, hanya untuk landing page yang terpetakan ke template itu.</span></div>
        </section>
        <section aria-label="Editor template" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          {editor ? <MetaFunnelEditor value={editor.config} onChange={config => setEditor({ ...editor, config })} accounts={data.accounts} busy={busy}
            onSave={() => void run(async isCurrent => { const result = await saveMetaFunnel(editor); if (isCurrent()) { setEditor(null); setSelectedId(result.id); if (result.warning) setNotice(result.warning); } }, 'Template tersimpan.')}
            onClose={() => setEditor(null)}
            onArchive={editor.id ? () => { if (window.confirm('Arsipkan template ini? Aturan URL-nya ikut dihapus.')) void run(async isCurrent => { await archiveMetaFunnel(editor.id!); if (isCurrent()) setEditor(null); }, 'Template diarsipkan.'); } : undefined} />
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
        <div className={styles.sectionTitle}><h2>Pencocokan landing page</h2><span>Tujuan Website dan WhatsApp dengan spend {formatDate(data.range.from)} – {formatDate(data.range.to)}</span></div>
        {assignmentTable(data.landingPages)}
        <p className={styles.muted}>Saran otomatis membaca 30 hari terakhir: purchase &gt; 0 dan lead = 0 menyarankan Transaksi; lead &gt; 0 dan purchase = 0 menyarankan Lead; keduanya ada atau keduanya nol dibiarkan tanpa saran. Saran tidak pernah diterapkan sendiri.</p>
      </section>}
      {data && <section aria-label="Aturan URL" style={{ display: 'grid', gap: 10 }}>
        <div className={styles.sectionTitle}><h2>Aturan URL</h2><span>Aturan tujuan WhatsApp didahulukan untuk brand dan nomor tersebut. Untuk website: URL persis → awalan URL → domain.</span></div>
        {canManage && data.rulesReady && data.templates.length > 0 && <form className={`${styles.card} ${styles.inlineForm}`} onSubmit={e => { e.preventDefault(); void changeRule({ save: ruleForm }, 'Aturan tersimpan.').then(saved => { if (saved) setRuleForm(f => ({ ...f, pattern: '' })); }); }}>
          <label>Jenis<select value={ruleForm.match_kind} onChange={e => setRuleForm({ ...ruleForm, match_kind: e.target.value as TemplateMatchKind })}>{(['exact', 'prefix', 'domain'] as const).map(k => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
          <label style={{ flex: 1 }}>Pola<input required maxLength={4096} placeholder={ruleForm.match_kind === 'domain' ? 'purvu.id' : 'https://purvu.id/konsultasi'} value={ruleForm.pattern} onChange={e => setRuleForm({ ...ruleForm, pattern: e.target.value })} /></label>
          <label>Template<select required value={ruleForm.funnelId} onChange={e => setRuleForm({ ...ruleForm, funnelId: e.target.value })}><option value="">Pilih template…</option>{data.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <button type="submit" className={styles.primary} disabled={busy || !ruleForm.funnelId}>+ Aturan URL</button>
        </form>}
        <div className={styles.sectionCard}><div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}><table className={styles.rulesTable}>
          <thead><tr><th>Jenis</th><th>Pola</th><th>Template</th><th /></tr></thead>
          <tbody>{data.rules.map(r => <tr key={r.id}><td>{kindLabels[r.match_kind]}</td><td style={{ overflowWrap: 'anywhere' }}>{r.match_kind === 'ctwa' ? data.landingPages.find(lp => lp.destination?.key === r.pattern)?.label || `WhatsApp · brand ${r.pattern.split(':')[1]} · ${r.pattern.includes(':phone:') ? r.pattern.split(':phone:')[1] : 'Nomor belum tersedia'}` : r.pattern}</td><td>{r.templateName}</td>
            <td style={{ textAlign: 'right' }}>{canManage && <button type="button" className={styles.button} disabled={busy} onClick={() => void changeRule({ remove: r.id }, 'Aturan dihapus.')}>Hapus</button>}</td></tr>)}</tbody>
        </table>{!data.rules.length && <p className={styles.muted} style={{ padding: 16 }}>Belum ada aturan. Tetapkan template dari tabel pencocokan atau tambahkan aturan domain agar seluruh website langsung terpetakan.</p>}</div></div>
      </section>}
    </>}
  </div>;
}
