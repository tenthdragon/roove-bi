'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getMetaFunnelCreatives, getMetaFunnelHistory } from '@/lib/meta-funnel-actions';
import { getMetaGroupAds } from '@/lib/meta-brand-actions';
import { MEASURES, metricValue, relativeChange, shiftDay, type AdCreative, type FunnelMetric, type Measure } from '@/lib/meta-funnel-domain';
import { WORLD_CHANNEL, type MetaBrandWorld, type TemplateGroup, type TemplateSection } from '@/lib/meta-funnel-templates';
import type { AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import { formatChange, formatCount, formatMetric } from '@/lib/meta-format';
import MetaSparkline from './MetaSparkline';
import MetaAdCreative from './MetaAdCreative';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type Ads = Extract<Awaited<ReturnType<typeof getMetaGroupAds>>, { schemaReady: true }>['ads'];
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const CTR: FunnelMetric = { id: 'ctr', label: 'CTR', numerator: 'outbound_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: false, min_denominator: 0 };
const SPEND: FunnelMetric = { id: 'spend', label: 'Spend', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: false, min_denominator: 0 };

/** Side panel for one landing page or CPAS ad group: stages, 14-day trend, and the ads behind it. */
export default function MetaGroupDrawer({ group, section, world, input, currency, onClose }: {
  group: TemplateGroup; section: TemplateSection; world: MetaBrandWorld;
  input: { from: string; to: string; brandId: string; filters: AdDimensionFilters }; currency: string; onClose: () => void;
}) {
  const [ads, setAds] = useState<Ads>([]); const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [history, setHistory] = useState<{ date: string; value: number | null }[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const main = section.mainMetric;
  const groupBy = world === 'website' ? 'landing_page' as const : 'ad' as const;
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    const base = { from: input.from, to: input.to, brandId: input.brandId, filters: input.filters, channel: WORLD_CHANNEL[world], groupBy };
    Promise.all([
      getMetaGroupAds({ from: input.from, to: input.to, brandId: input.brandId, filters: input.filters, world, adIds: group.ad_ids }),
      getMetaFunnelCreatives({ ...base, groupKey: group.key }).catch(() => null),
      main ? getMetaFunnelHistory({ ...base, from: shiftDay(input.to, -13), groupKey: group.key, view: 'daily' }).catch(() => null) : Promise.resolve(null),
    ]).then(([adResult, creativeResult, historyResult]) => {
      if (!alive) return;
      if (adResult.schemaReady) setAds(adResult.ads);
      if (creativeResult?.schemaReady) setCreatives(creativeResult.creatives);
      if (historyResult?.schemaReady && main) setHistory(historyResult.history.map(p => ({ date: p.date, value: p.complete ? metricValue(p.totals, main) : null })));
    }).catch(e => { if (alive) setError(message(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [group.key, group.ad_ids, input.from, input.to, input.brandId, input.filters, world, groupBy, main]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const stages = section.config.stages.filter((s): s is Measure => s !== 'spend');
  const first = stages.length ? group.current[stages[0]] : 0;
  const mainNow = main ? metricValue(group.current, main) : null, mainBefore = main ? metricValue(group.previous, main) : null;
  const mainChange = relativeChange(mainNow, mainBefore);
  const mainGood = main && mainChange !== null ? (main.direction === 'higher' ? mainChange >= 0 : mainChange <= 0) : null;
  return <>
    <div className={styles.drawerBackdrop} onClick={onClose} aria-hidden="true" />
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Detail ${group.name}`}>
      <div className={styles.drawerHead}>
        <div><div className={styles.muted}>{world === 'website' ? `Landing page · ${section.name}` : 'Ad · CPAS Shopee'}</div><h2>{group.name}</h2><div className={styles.muted}>{group.ad_ids.length} ad · {group.accounts.join(', ')}</div></div>
        <button type="button" className={styles.drawerClose} aria-label="Tutup detail" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <div className={styles.miniGrid}>
        <div className={styles.mini}><span className={styles.muted}>Spend</span><strong>{formatMetric(group.current.spend, 'money', currency)}</strong></div>
        <div className={styles.mini}><span className={styles.muted}>{main?.label || 'Hasil utama'}</span><strong className={mainGood === null ? '' : mainGood ? styles.good : styles.bad}>{main ? formatMetric(mainNow, main.format, currency) : '—'}</strong></div>
        <div className={styles.mini}><span className={styles.muted}>vs periode lalu</span><strong className={mainGood === null ? '' : mainGood ? styles.good : styles.bad}>{formatChange(mainChange)}</strong></div>
      </div>
      {group.landing_page_urls.length > 0 && <div className={styles.muted}>{group.landing_page_urls.map(url => <div key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></div>)}</div>}
      <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Tahap funnel</h3><span>Rasio terhadap tahap sebelumnya</span></div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{stages.map((stage, i) => {
          const value = group.current[stage], prev = i ? group.current[stages[i - 1]] : 0;
          const ratio = i && prev > 0 ? value / prev : null;
          return <div key={stage} className={styles.stageRow}><span>{MEASURES[stage]}</span><div className={styles.stageTrack}><div className={styles.stageFill} style={{ width: `${first > 0 ? Math.max(1, Math.min(100, value / first * 100)) : 0}%` }} /></div><span className={styles.num}>{i === 0 ? formatCount(value) : formatMetric(ratio, 'percent', currency)}</span></div>;
        })}</div>
      </div>
      {main && <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Tren 14 hari · {main.label}</h3><span>{history.filter(p => p.value !== null).length} hari lengkap</span></div>
        <div style={{ marginTop: 8 }}><MetaSparkline values={history.map(p => p.value)} label={`Tren ${main.label} 14 hari`} /></div>
      </div>}
      <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Ad yang mengarah ke sini</h3><span>{ads.length} ad · urut spend</span></div>
        {loading && <p role="status" className={styles.muted}>Memuat ad…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{ads.map(ad => {
          const creative = creatives.find(c => c.ad_id === ad.ad_id);
          const value = main ? metricValue(ad.current, main) : null;
          return <div key={ad.key} className={styles.adRow}>
            {creative ? <MetaAdCreative creative={creative} /> : <div className={styles.adThumb}>Ad</div>}
            <div><b title={ad.name}>{ad.name}</b><small>{ad.account} · {formatMetric(ad.current.spend, SPEND.format, currency)} · CTR {formatMetric(metricValue(ad.current, CTR), 'percent', currency)}</small></div>
            <div className={styles.adResult}>{main ? `${main.label} ${formatMetric(value, main.format, currency)}` : formatCount(ad.current.purchases)}</div>
          </div>;
        })}</div>
      </div>
    </aside>
  </>;
}
