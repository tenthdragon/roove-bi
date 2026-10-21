'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { useDateRange } from '@/lib/DateRangeContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { useMetaCachedLoad, useMetaReportSession } from '@/lib/useMetaCachedLoad';
import { useMetaBreakdownPreference } from '@/lib/useMetaBreakdownPreference';
import { createMetaOverviewCache } from '@/lib/meta-overview-cache';
import { defaultMetaRange } from '@/lib/meta-report-status';
import { getTodayWIB } from '@/lib/sync-schedule';
import { getMetaFunnelHistory, getMetaReportRevision, queueMetaFunnelSync, verifyMetaAdDestination } from '@/lib/meta-funnel-actions';
import { getMetaBrandDetail, saveMetaTemplateRule } from '@/lib/meta-brand-actions';
import { MEASURES, metricValue, type FunnelMetric, type Totals } from '@/lib/meta-funnel-domain';
import { templateDestinationRule } from '@/lib/meta-ctwa-destinations';
import { WORLD_CHANNEL, WORLD_LABELS, type MetaBrandWorld, type TemplateGroup, type TemplateSection } from '@/lib/meta-funnel-templates';
import type { AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import { formatChange, formatCompactMoney, formatDate, formatMetric } from '@/lib/meta-format';
import MetaAdsNav from '@/components/MetaAdsNav';
import MetaTemplateResults from '@/components/MetaTemplateResults';
import { getMetaColumnPreferences, saveMetaColumnPreference, saveMetaTableSort, type MetaColumnPreferences } from '@/lib/meta-column-preference-actions';
import type { MetaTableSort } from '@/lib/meta-table-sorting';
import type { MetaColumnPreference, MetaTablePreference } from '@/lib/meta-column-preferences';
import MetaAdDimensionFilters from '@/components/MetaAdDimensionFilters';
import { brandMetricHighlights, metaDataNotes } from '@/lib/meta-inline-highlights';
import { MetaDataNotesTrigger, MetaHighlightValue } from '@/components/MetaInsightPopover';
import MetaSparkline from '@/components/MetaSparkline';
const MetaGroupDrawer = dynamic(() => import('@/components/MetaGroupDrawer'), { ssr: false });
import MetaTemplateSuggestionButton from '@/components/MetaTemplateSuggestionButton';
import { META_TEMPLATE_SCHEMA_MESSAGE } from '@/lib/meta-template-settings';
import MetaCepView from '@/components/MetaCepView';
const MetaCepDrawer = dynamic(() => import('@/components/MetaCepDrawer'), { ssr: false });
const MetaBrandTrend = dynamic(() => import('@/components/MetaBrandTrend'), { ssr: false });
import styles from '../../page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaBrandDetail>>, { schemaReady: true }>;
type HistoryPoint = { date: string; totals: Totals; complete: boolean; partial: boolean };
const detailCache = createMetaOverviewCache<Data>();
const columnPreferencesCache = createMetaOverviewCache<MetaColumnPreferences>();
const historyCache = createMetaOverviewCache<{ points: HistoryPoint[]; complete: boolean }>();
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';

function Delta({ value, direction = 'higher', neutral = false }: { value: number | null; direction?: 'higher' | 'lower'; neutral?: boolean }) {
  if (value === null) return <span className={styles.neutral}>—</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span className={neutral ? styles.neutral : good ? styles.good : styles.bad}>{formatChange(value)}</span>;
}

export default function MetaBrandDetailPage() {
  const params = useParams<{ brandId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { dateRange } = useDateRange();
  const session = useMetaReportSession();
  const breakdown = useMetaBreakdownPreference(session.workspaceId, session.userId);
  const fetchColumnPreferences = useCallback(() => getMetaColumnPreferences({ workspaceId: session.workspaceId, userId: session.userId }), [session.workspaceId, session.userId]);
  const { data: columnPreferences, setData: setColumnPreferences, error: columnError, loading: columnLoading, load: reloadColumns } = useMetaCachedLoad(session.key, columnPreferencesCache, fetchColumnPreferences);
  async function saveColumns(funnelId: string, preference: MetaColumnPreference | null) {
    const saved = await saveMetaColumnPreference({ workspaceId: session.workspaceId, userId: session.userId, funnelId, preference });
    updatePreference(funnelId, saved);
  }
  async function saveSort(funnelId: string, sort: MetaTableSort | null) {
    const saved = await saveMetaTableSort({ workspaceId: session.workspaceId, userId: session.userId, funnelId, sort });
    updatePreference(funnelId, saved);
  }
  function updatePreference(funnelId: string, saved: MetaTablePreference | null) {
    setColumnPreferences(current => {
      const preferences = { ...current?.preferences };
      if (saved) preferences[funnelId] = saved; else delete preferences[funnelId];
      return { ready: true, preferences };
    });
  }
  const reportRange = dateRange.from && dateRange.to ? dateRange : defaultMetaRange(getTodayWIB());
  const { can, role } = usePermissions();
  const canManage = can('meta:funnels');
  const canMap = can('meta:mapping');
  const canSync = role !== 'advertiser' && can('admin:meta');
  const brandId = params.brandId;
  const world: MetaBrandWorld = search.get('world') === 'cpas' ? 'cpas' : 'website';
  const view: 'destinations' | 'cep' = search.get('view') === 'cep' ? 'cep' : 'destinations';
  const [filters, setFilters] = useState<AdDimensionFilters>({});
  const [schemaReady, setSchemaReady] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ group: TemplateGroup; section: TemplateSection } | null>(null);
  const [cepDrawer, setCepDrawer] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [destinationEditor, setDestinationEditor] = useState<{ accountId: string; adId: string; name: string; url: string } | null>(null);
  const [history, setHistory] = useState<{ key: string; points: HistoryPoint[]; complete: boolean } | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [trendMetricId, setTrendMetricId] = useState('');
  const input = useMemo(() => ({ from: reportRange.from, to: reportRange.to, brandId, filters }), [reportRange.from, reportRange.to, brandId, filters]);
  const cacheKey = session.key ? JSON.stringify([session.key, input, world]) : null;
  const fetchDetail = useCallback(async () => {
    const result = await getMetaBrandDetail({ ...input, world, workspaceId: session.workspaceId });
    if ('reportError' in result) throw new Error(result.reportError);
    setSchemaReady(result.schemaReady);
    return result.schemaReady && result.workspaceId === session.workspaceId ? result : null;
  }, [input, world, session.workspaceId]);
  const { data, setData, loading, error, setError, load } = useMetaCachedLoad(cacheKey, detailCache, fetchDetail);
  useEffect(() => {
    if (!data || !cacheKey) return;
    let alive = true;
    void getMetaReportRevision().then(status => {
      if (alive && status.workspaceId === session.workspaceId && status.reportVersion !== data.reportVersion) void load(true);
    }).catch(e => { if (alive) setError(message(e)); });
    return () => { alive = false; };
  }, [cacheKey, data?.reportVersion, session.workspaceId, load, setError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDrawer(null); setCepDrawer(null); setNotesOpen(false); setDestinationEditor(null); }, [world, brandId, cacheKey]);
  const historyKey = JSON.stringify([cacheKey, data?.reportVersion]);
  useEffect(() => {
    if (!data || !cacheKey) return;
    let alive = true; setHistoryError('');
    const cached = historyCache.get(historyKey);
    if (cached) { setHistory({ key: historyKey, ...cached }); return; }
    const read = () => {
      void historyCache.request(historyKey, async () => {
        const result = await getMetaFunnelHistory({ from: input.from, to: input.to, workspaceId: session.workspaceId, brandId, filters, channel: WORLD_CHANNEL[world], groupBy: world === 'website' ? 'landing_page' : 'ad', view: 'trends', period: 'weekly' });
        if (!result.schemaReady) throw new Error('Histori laporan belum tersedia.');
        return { points: result.history, complete: result.complete };
      }).then(result => {
        if (!alive) return;
        historyCache.set(historyKey, result); setHistory({ key: historyKey, ...result });
      }).catch(e => { if (alive) setHistoryError(message(e)); });
    };
    const idle = 'requestIdleCallback' in window;
    const timer = idle ? window.requestIdleCallback(read, { timeout: 1500 }) : window.setTimeout(read, 0);
    return () => { alive = false; if (idle) window.cancelIdleCallback(timer); else clearTimeout(timer); };
  }, [input, brandId, filters, world, historyKey, cacheKey, session.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const points = history?.key === historyKey ? history.points : [];
  const trendMetrics = useMemo<FunnelMetric[]>(() => {
    if (!data) return [];
    const seen = new Map<string, FunnelMetric>();
    for (const m of [...data.responseMetrics, ...data.sections.flatMap(s => s.config.metrics)]) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()];
  }, [data]);
  const trendMetric = trendMetrics.find(m => m.id === trendMetricId) || data?.sections.find(s => s.groups.length)?.mainMetric || trendMetrics[1] || trendMetrics[0];
  const series = (m: FunnelMetric) => points.map(p => p.complete ? metricValue(p.totals, m) : null);
  function setWorld(next: MetaBrandWorld) {
    const query = new URLSearchParams(search.toString()); query.set('world', next);
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  function setView(next: 'destinations' | 'cep') {
    const query = new URLSearchParams(search.toString());
    if (next === 'cep') query.set('view', 'cep'); else query.delete('view');
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }
  async function applySuggestion(group: Data['unassigned'][number], funnelId: string) {
    if (!data?.rulesReady) { setError(META_TEMPLATE_SCHEMA_MESSAGE); return; }
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await saveMetaTemplateRule({ funnelId, ...templateDestinationRule(group) });
      if ('error' in result) {
        setError(result.error);
        if (result.code === 'TEMPLATE_SCHEMA_NOT_READY') setData(current => current ? { ...current, rulesReady: false } : current);
        return;
      }
      setNotice(`Template ditetapkan untuk ${group.name}.`); await load(true);
    }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function verifyDestination() {
    if (!destinationEditor) return;
    setBusy(true); setError('');
    try { const saved = await verifyMetaAdDestination(destinationEditor); setDestinationEditor(null); setNotice(`URL ad terverifikasi: ${saved.url}`); await load(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setError('');
    try { await queueMetaFunnelSync(); setNotice('Sync masuk antrean. Buka Ringkasan brand untuk memantau progresnya.'); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const currency = data?.currency || 'IDR';
  const unassignedRules = data?.unassigned.filter(u => u.reason === 'no_rule') || [];
  const dataNotes = data ? metaDataNotes(data) : [];
  const noteCount = dataNotes.length;
  const highlightPeriod = data ? { ...data.reportRange, prevFrom: data.prevFrom, prevTo: data.prevTo } : undefined;
  const hasFilters = !!(filters.cep || filters.intention || filters.objective);
  return <div className={styles.page} aria-busy={loading}>
    <MetaAdsNav />
    <div className={styles.toolbar}>
      <div className={styles.toolbarGroup}>
        <Link href="/dashboard/meta-funnels" className={styles.backLink}>← Ringkasan</Link>
        <select className={styles.brandSwitch} aria-label="Pilih brand" value={brandId} onChange={e => router.push(`/dashboard/meta-funnels/brand/${e.target.value}?world=${world}`)}>
          {(data?.brandOptions || [{ value: brandId, label: data?.brand.name || 'Brand' }]).map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <div className={styles.segmented} role="group" aria-label="Dunia iklan">
          {(['website', 'cpas'] as const).map(w => <button key={w} type="button" className={`${styles.segment} ${world === w ? styles.segmentActive : ''}`} aria-pressed={world === w} onClick={() => setWorld(w)}>
            {WORLD_LABELS[w]}{data && ` · ${formatCompactMoney(data.worlds[w].spend, currency)}`}
          </button>)}
        </div>
      </div>
      <div className={styles.toolbarGroup}>
        {data && <span className={styles.muted}>{data.matchingAds} ad · {data.accounts.length} akun</span>}
        <details className={styles.filterDetails}><summary>Filter{hasFilters ? ' · aktif' : ''}</summary>
          <div className={styles.filterPanel}>{data && <MetaAdDimensionFilters value={filters} options={data.dimensionOptions} ready={data.dimensionsReady} onChange={setFilters} onReset={() => setFilters({})} />}</div>
        </details>
        <MetaDataNotesTrigger notes={dataNotes} onOpen={() => setNotesOpen(true)} disabled={!data} />
      </div>
    </div>
    {(session.error || error) && <div role="alert" className={styles.error}>{session.error || error}</div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    {!schemaReady ? <div className={styles.card}>Pengelompokan iklan belum tersedia. Hubungi admin untuk mengaktifkannya.</div> : <>
      {loading && !session.error && !data && <p role="status" className={styles.muted}>Memuat detail brand…</p>}
      {data && <>
        {world === 'website' && !data.rulesReady && error !== META_TEMPLATE_SCHEMA_MESSAGE && <div role="alert" className={styles.error}>{META_TEMPLATE_SCHEMA_MESSAGE}</div>}
        <p className={styles.period}>Periode {formatDate(data.reportRange.from)} – {formatDate(data.reportRange.to)} <span>vs {formatDate(data.prevFrom)} – {formatDate(data.prevTo)} · {currency}</span></p>
        {data.reportingError && <div role="alert" className={styles.error}>{data.reportingError}</div>}
        <section aria-label="Respon iklan" style={{ display: 'grid', gap: 10 }}>
          <div className={styles.sectionTitle}><h2>Respon iklan</h2><span>Lapisan bersama · dinilai sama di Website dan CPAS · sparkline mingguan 90 hari</span></div>
          <div className={styles.responseGrid}>{data.responseMetrics.map(m => { const c = data.response.find(r => r.id === m.id)!; return <div key={m.id} className={styles.kpi}>
            <span className={styles.muted} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{m.label}</span><Delta value={c.change} direction={m.direction} /></span>
            <span className={styles.kpiValue}><MetaHighlightValue highlights={brandMetricHighlights(data.highlights, m)} currency={currency} period={highlightPeriod}>{formatMetric(c.current, m, currency)}</MetaHighlightValue></span>
            <MetaSparkline values={series(m)} />
            <span className={styles.muted}>{m.denominator ? `${MEASURES[m.numerator]} ÷ ${MEASURES[m.denominator]}${m.multiplier ? ` × ${m.multiplier}` : ''}` : MEASURES[m.numerator]}</span>
          </div>; })}</div>
        </section>
        <section aria-label={`Hasil ${WORLD_LABELS[world]}`} style={{ display: 'grid', gap: 12 }}>
          <div className={styles.sectionTitle}><h2>Hasil · {WORLD_LABELS[world]}</h2><div className={styles.actions}>
            <span className={styles.muted}>{view === 'cep' ? 'Per CEP · nuansa antar pintu masuk pada ad yang sama' : world === 'website' ? 'Per template · Website per URL, WhatsApp per brand dan nomor' : 'Per ad · purchase Shopee dengan atribusi Meta'}</span>
            <div className={styles.viewSwitch} role="group" aria-label="Tampilan hasil">
              <button type="button" className={view === 'destinations' ? styles.viewActive : ''} aria-pressed={view === 'destinations'} onClick={() => setView('destinations')}>{world === 'website' ? 'Tujuan' : 'Ad'}</button>
              <button type="button" className={view === 'cep' ? styles.viewActive : ''} aria-pressed={view === 'cep'} onClick={() => setView('cep')}>CEP</button>
            </div></div></div>
          {view === 'destinations' && world === 'website' && breakdown.error && <p role="status" className={styles.muted}>{breakdown.error}</p>}
          {view === 'cep' && <MetaCepView view={data.cep} currency={currency} onOpenCep={setCepDrawer} highlights={data.highlights} period={highlightPeriod} />}
          {view === 'destinations' && world === 'website' && !data.sections.some(s => s.groups.length) && <div className={styles.card}>{data.sections.length ? 'Belum ada landing page yang terpetakan ke template pada periode ini.' : 'Belum ada template funnel.'} Tetapkan template di <Link href="/dashboard/meta-funnels/templates">Template funnel</Link>.</div>}
          {view === 'destinations' && world === 'website' && (columnError || columnPreferences?.ready === false) && <div className={styles.info} role="status">
            {columnError || 'Pengaturan tabel belum tersedia. Tampilan default digunakan.'} <button type="button" className={styles.button} onClick={() => void reloadColumns(true)}>Coba lagi</button>
          </div>}
          {view === 'destinations' && data.sections.filter(s => s.groups.length || world === 'cpas').map(section => <MetaTemplateResults
            key={JSON.stringify([session.key, section.key])} breakdown={breakdown.value} breakdownReady={breakdown.ready} onBreakdownChange={breakdown.select} section={section} world={world} currency={currency} highlights={data.highlights} period={highlightPeriod}
            preferencesReady={!!columnPreferences?.ready && !columnError && !columnLoading} preference={section.funnelId ? columnPreferences?.preferences[section.funnelId] : null}
            savedSort={section.funnelId ? columnPreferences?.preferences[section.funnelId]?.sort ?? null : null}
            onSaveSort={section.funnelId ? value => saveSort(section.funnelId!, value) : undefined}
            onSave={section.funnelId ? value => saveColumns(section.funnelId!, value) : undefined}
            onOpenGroup={group => setDrawer({ group, section })} />)}
          {view === 'destinations' && world === 'website' && data.unassigned.length > 0 && <div className={styles.unassigned}>
            <div className={styles.sectionTitle}><strong className={styles.warn}>Belum ditetapkan</strong><span>{data.unassigned.length} tujuan · {formatCompactMoney(data.unassigned.reduce((s, u) => s + u.current.spend, 0), currency)} · belum masuk template mana pun</span></div>
            {data.unassigned.slice(0, 8).map(u => <div key={u.key} className={styles.unassignedRow}>
              <span>{u.name} {u.reason === 'no_rule' && <MetaHighlightValue currency={currency} highlights={[{ kind: 'data', severity: 'warn', title: 'Template belum ditetapkan', text: u.suggestion.reason, weight: 0 }]} onDetail={() => setNotesOpen(true)}><span>Belum ada template</span></MetaHighlightValue>} · {formatCompactMoney(u.current.spend, currency)} · <span className={styles.muted}>{u.reason === 'no_url' ? 'URL belum terbaca' : u.reason === 'multi_url' ? 'beberapa URL dalam satu creative' : u.suggestion.reason}</span></span>
              {u.reason === 'no_rule' && canManage && u.suggestion.funnelId && data.templates.some(t => t.id === u.suggestion.funnelId && (role !== 'advertiser' || t.brand_id != null)) && <MetaTemplateSuggestionButton className={styles.button} rulesReady={data.rulesReady} busy={busy} onApply={() => void applySuggestion(u, u.suggestion.funnelId!)} />}
            </div>)}
            <Link href="/dashboard/meta-funnels/templates">Atur template dan tujuan →</Link>
          </div>}
          {view === 'destinations' && world === 'cpas' && <p className={styles.muted}>Metrik CPAS memakai atribusi Meta per adset. Purchase shared items 1 hari dan 7 hari belum dipisahkan; ROAS dibaca sebagai indikasi arah.</p>}
        </section>
        <section aria-label="Tren" style={{ display: 'grid', gap: 10 }}>
          <div className={styles.sectionTitle}><h2>Tren 90 hari</h2><div className={styles.actions}><span className={styles.muted}>Mingguan · {WORLD_LABELS[world]}</span>
            <select aria-label="Metrik tren" value={trendMetric?.id || ''} onChange={e => setTrendMetricId(e.target.value)}>{trendMetrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div></div>
          {historyError && <p role="alert" className={styles.error}>{historyError}</p>}
          {trendMetric && (history?.key === historyKey ? <MetaBrandTrend metric={trendMetric} currency={currency} complete={history.complete}
            points={points.map(p => ({ date: p.date, value: p.complete ? metricValue(p.totals, trendMetric) : null }))} />
            : <div className={styles.chartCard} style={{ minHeight: 240 }}><p role="status" className={styles.muted}>{historyError ? 'Tren belum berhasil dimuat.' : 'Memuat tren…'}</p></div>)}
        </section>
      </>}
    </>}
    {cepDrawer && data && <MetaCepDrawer key={JSON.stringify([cepDrawer, world, brandId, data.reportRange, filters])} cep={cepDrawer} label={data.cep.rows.find(r => r.cep === cepDrawer)?.label || cepDrawer} world={world} input={{ from: data.reportRange.from, to: data.reportRange.to, brandId, filters }} metrics={data.cep.metrics} resultMetric={data.cep.resultMetric} currency={currency} onClose={() => setCepDrawer(null)} />}
    {drawer && data && <MetaGroupDrawer group={drawer.group} section={drawer.section} world={world} input={{ from: data.reportRange.from, to: data.reportRange.to, brandId, filters }} currency={currency} onClose={() => setDrawer(null)} />}
    {notesOpen && data && <>
      <div className={styles.drawerBackdrop} onClick={() => setNotesOpen(false)} aria-hidden="true" />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Catatan data">
        <div className={styles.drawerHead}><div><h2>Catatan data</h2><div className={styles.muted}>{data.brand.name} · {WORLD_LABELS[world]}</div></div><button type="button" className={styles.drawerClose} aria-label="Tutup catatan" onClick={() => setNotesOpen(false)}><X size={16} aria-hidden="true" /></button></div>
        {!noteCount && <p className={styles.muted}>Tidak ada catatan. Data periode dan pembanding lengkap, semua URL terbaca.</p>}
        {data.coverageGaps.length > 0 && <div className={styles.card}><b className={styles.warn}>Data parsial</b>
          <dl style={{ margin: '8px 0 0', display: 'grid', gap: 6 }}>{data.coverageGaps.map(g => <div key={g.account_id}><dt style={{ fontWeight: 600 }}>{data.accounts.find(a => a.account_id === g.account_id)?.account_name || g.account_id}</dt><dd style={{ margin: 0 }} className={styles.muted}>{[g.currentMissing > 0 && `periode ${g.currentMissing} hari`, g.baselineMissing > 0 && `pembanding ${g.baselineMissing} hari`].filter(Boolean).join(' · ')} · {g.firstMissing} – {g.lastMissing}</dd></div>)}</dl>
          {canSync && <button type="button" className={styles.button} style={{ marginTop: 8 }} disabled={busy} onClick={() => void sync()}>Sync</button>}</div>}
        {(data.destinations.missing_ads > 0 || data.destinations.multi_ads > 0) && <div className={styles.card}><b className={styles.warn}>URL landing page</b>
          <p className={styles.muted}>{data.destinations.missing_ads} ad dengan URL belum terbaca · {data.destinations.multi_ads} ad dengan beberapa URL. Metrik tetap dihitung sekali; ad ini belum masuk template mana pun.</p>
          {data.destinations.missing.map(ad => <div className={styles.namingIssue} key={`${ad.account_id}:${ad.ad_id}`}><b>{ad.ad_name}</b><small>{ad.account_name} · ad {ad.ad_id}</small>
            {canMap && <button className={styles.button} onClick={() => setDestinationEditor({ accountId: ad.account_id, adId: ad.ad_id, name: ad.ad_name, url: '' })}>Tetapkan URL</button>}</div>)}
          {destinationEditor && <form className={styles.editor} style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); void verifyDestination(); }}>
            <p><b>{destinationEditor.name}</b><br /><span className={styles.muted}>Gunakan Website URL yang sudah diperiksa di Ads Manager. URL ini berlaku selama creative yang sama digunakan.</span></p>
            <label>Website URL<input required type="url" maxLength={4096} value={destinationEditor.url} onChange={e => setDestinationEditor({ ...destinationEditor, url: e.target.value })} /></label>
            <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>Simpan URL terverifikasi</button><button type="button" className={styles.button} disabled={busy} onClick={() => setDestinationEditor(null)}>Batal</button></div>
          </form>}</div>}
        {data.objectiveUnknownAds > 0 && <div className={styles.card}><b className={styles.warn}>Objective belum terbaca</b><p className={styles.muted}>{data.objectiveUnknownAds} ad. Gunakan Sync pemetaan di <Link href="/dashboard/meta-funnels/mapping">Pemetaan Ads</Link> untuk melengkapinya.</p></div>}
        {dataNotes.filter(n => n.note === 'unmapped_cep').map(n => <div key={n.note} className={styles.card}><b className={styles.warn}>{n.title}</b><p className={styles.muted}>{n.text}</p>
          {canMap && <Link href="/dashboard/meta-funnels/mapping">Buka Pemetaan Ads →</Link>}</div>)}
        {unassignedRules.length > 0 && <div className={styles.card}><b className={styles.warn}>Template belum ditetapkan</b><p className={styles.muted}>{unassignedRules.length} tujuan. Atur di <Link href="/dashboard/meta-funnels/templates">Template funnel</Link>.</p></div>}
      </aside>
    </>}
  </div>;
}
