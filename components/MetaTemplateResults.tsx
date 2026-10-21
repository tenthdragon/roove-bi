'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import { MEASURES, type Measure } from '@/lib/meta-funnel-domain';
import { creativeFormatGroups, TEMPLATE_KIND_LABELS, WORLD_LABELS, type MetaBrandWorld, type TemplateGroup, type TemplateSection } from '@/lib/meta-funnel-templates';
import { formatChange, formatCompactMoney, formatCount, formatMetric } from '@/lib/meta-format';
import { metaResultColumns, visibleMetaColumns, type MetaColumnPreference } from '@/lib/meta-column-preferences';
import { metaStageValue, sortMetaGroups, type MetaTableSort } from '@/lib/meta-table-sorting';
import type { Highlight } from '@/lib/meta-ad-highlights';
import { destinationHighlights, highlightsForMetric, type HighlightPeriod } from '@/lib/meta-inline-highlights';
import { MetaHighlightValue } from '@/components/MetaInsightPopover';
import MetaColumnEditor from '@/components/MetaColumnEditor';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

function Delta({ value, direction = 'higher', neutral = false }: { value: number | null; direction?: 'higher' | 'lower'; neutral?: boolean }) {
  if (value === null) return <span className={styles.neutral}>—</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span className={neutral ? styles.neutral : good ? styles.good : styles.bad}>{formatChange(value)}</span>;
}
function StageChips({ group, stages, currency, highlights, period, onDetail }: { group: TemplateGroup; stages: Measure[]; currency: string; highlights: Highlight[]; period?: HighlightPeriod; onDetail: () => void }) {
  const steps = stages.filter(s => s !== 'spend');
  return <div className={styles.stageChips}>{steps.map((stage, i) => {
    const value = metaStageValue(group, stages, stage);
    return <span key={stage} className={styles.stageChip} title={`${MEASURES[stage]}${i ? ` ÷ ${MEASURES[steps[i - 1]]}` : ''}`}>{MEASURES[stage].replace('Landing page views', 'LPV').replace('Initiate checkout', 'IC').replace('Add to cart', 'ATC').replace('Outbound clicks', 'Outbound').replace('Messaging conversations', 'Conv')} <MetaHighlightValue highlights={i === 0 ? [] : highlightsForMetric(highlights, { id: stage, label: '', numerator: stage, denominator: steps[i - 1], format: 'percent', direction: 'higher', monitor: true, min_denominator: 0 })} currency={currency} period={period} onDetail={onDetail}>{i === 0 ? formatCount(value) : formatMetric(value, 'percent', currency)}</MetaHighlightValue></span>;
  })}</div>;
}

export default function MetaTemplateResults({ section, world, currency, preference, preferencesReady, onSave, savedSort, onSaveSort, onOpenGroup, highlights = [], period }: {
  section: TemplateSection; world: MetaBrandWorld; currency: string; preference?: MetaColumnPreference | null;
  preferencesReady: boolean; onSave?: (value: MetaColumnPreference | null) => Promise<void>;
  savedSort?: MetaTableSort | null; onSaveSort?: (value: MetaTableSort | null) => Promise<void>;
  onOpenGroup: (group: TemplateGroup) => void; highlights?: Highlight[]; period?: HighlightPeriod;
}) {
  const [editing, setEditing] = useState(false), [notice, setNotice] = useState('');
  const [localSort, setSort] = useState<MetaTableSort | null>(null);
  const [savingSort, setSavingSort] = useState(false), [sortError, setSortError] = useState('');
  const saveLock = useRef(false);
  const sort = onSaveSort ? savedSort ?? null : localSort;
  const sortDisabled = editing || savingSort || !!onSaveSort && !preferencesReady;
  async function changeSort(next: MetaTableSort | null) {
    if (saveLock.current || sortDisabled) return;
    if (!onSaveSort) { setSort(next); return; }
    saveLock.current = true; setSavingSort(true); setSortError(''); setNotice('');
    try { await onSaveSort(next); setNotice('Pengurutan disimpan.'); }
    catch (error) { setSortError(error instanceof Error ? error.message : 'Pengurutan gagal disimpan. Silakan coba lagi.'); }
    finally { saveLock.current = false; setSavingSort(false); }
  }
  const [funnelStage, setFunnelStage] = useState<Measure | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const columns = metaResultColumns(section.config.metrics), visible = visibleMetaColumns(columns, preference);
  const steps: Measure[] = section.config.stages.filter(s => s !== 'spend');
  const selectedStage = sort?.key === 'funnel' && steps.includes(sort.stage) ? sort.stage : funnelStage && steps.includes(funnelStage) ? funnelStage : steps[0];
  const sortAvailable = !sort || sort.key === 'name' || visible.some(c => c.key === sort.key)
    && (sort.key !== 'funnel' || steps.includes(sort.stage));
  const activeSort = sortAvailable ? sort : null;
  useEffect(() => { if (!sortAvailable && !onSaveSort) setSort(null); }, [sortAvailable, onSaveSort]);
  const groups = useMemo(() => sortMetaGroups(section.groups, activeSort, section.config.stages), [section.groups, section.config.stages, activeSort]);
  function sortButton(key: MetaTableSort['key'], label: string) {
    const current = activeSort?.key === key ? activeSort.direction : null;
    const next = current === 'ascending' ? 'descending' : current === 'descending' ? 'ascending' : key === 'name' ? 'ascending' : 'descending';
    const directionLabel = key === 'name' ? next === 'ascending' ? 'A–Z' : 'Z–A' : next === 'ascending' ? 'rendah ke tinggi' : 'tinggi ke rendah';
    const Icon = current === 'ascending' ? ArrowUp : current === 'descending' ? ArrowDown : ArrowUpDown;
    const description = `Urutkan ${label}${key === 'funnel' ? ` berdasarkan ${MEASURES[selectedStage]}` : ''}: ${directionLabel}`;
    return <button type="button" className={styles.resultSortButton} disabled={sortDisabled} aria-label={description} title={description}
      onClick={() => void changeSort(key === 'funnel' ? { key, stage: selectedStage, direction: next } : { key, direction: next })}>
      {label}<Icon size={14} aria-hidden="true" /></button>;
  }
  const close = () => { setEditing(false); trigger.current?.focus(); };
  return <div className={styles.sectionCard}>
    <div className={styles.sectionHead}>
      <div><span className={`${styles.templateTag} ${world === 'cpas' ? styles.templateTagCpas : ''}`}>{world === 'cpas' ? 'CPAS' : 'TEMPLATE'}</span><strong>{section.name}</strong><span>{section.config.stages.filter(s => s !== 'spend').map(s => MEASURES[s]).join(' → ')} · {section.groups.length} {world === 'website' ? 'tujuan' : 'ad'} · {formatCompactMoney(section.summary.spend, currency)}</span></div>
      <div><span>{section.mainMetric && section.mainMedian !== null ? `Median ${section.mainMetric.label} ${formatMetric(section.mainMedian, section.mainMetric, currency)}` : TEMPLATE_KIND_LABELS[section.kind]}</span>
        {activeSort && <button type="button" className={styles.button} disabled={sortDisabled} onClick={() => void changeSort(null)}>Urutan awal</button>}
        {onSave && <button ref={trigger} type="button" className={`${styles.button} ${styles.columnSettingsButton}`} disabled={!preferencesReady || savingSort} aria-haspopup="dialog" onClick={() => { setNotice(''); setEditing(true); }}><SlidersHorizontal size={14} />Atur kolom</button>}
      </div>
    </div>
    {savingSort && <p role="status" className={styles.muted}>Menyimpan pengurutan…</p>}
    {sortError && <p role="alert" className={styles.error}>{sortError}</p>}
    {notice && <p role="status" className={styles.columnSaved}>{notice}</p>}
    {editing && onSave && <MetaColumnEditor key={JSON.stringify(columns.map(c => c.key))} name={section.name} columns={columns} preference={preference} onClose={close}
      onSave={async value => { await onSave(value); setNotice('Pengaturan kolom disimpan.'); }} />}
    {!section.groups.length ? <p className={styles.muted} style={{ padding: '12px 16px' }}>Belum ada ad {WORLD_LABELS[world]} pada periode dan filter ini.</p> : <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
      <table className={styles.resultTable} aria-label={`Hasil ${section.name}`} style={{ minWidth: Math.max(380, 220 + visible.length * 110) }}>
        <thead><tr><th scope="col" aria-sort={activeSort?.key === 'name' ? activeSort.direction : undefined}>{sortButton('name', world === 'website' ? 'Tujuan' : 'Ad')}</th>{visible.map(column => <th key={column.key} scope="col" className={!column.metric ? styles.funnelCell : undefined}
          aria-sort={activeSort?.key === column.key ? activeSort.direction : undefined}
          title={column.metric ? column.metric.denominator ? `${MEASURES[column.metric.numerator]} ÷ ${MEASURES[column.metric.denominator]}` : MEASURES[column.metric.numerator] : undefined}>
          {sortButton(column.key as MetaTableSort['key'], column.label)}
          {!column.metric && <select className={styles.funnelSortStage} aria-label="Tahap Funnel untuk pengurutan" value={selectedStage} disabled={sortDisabled}
            onChange={e => { const stage = e.target.value as Measure; setFunnelStage(stage); void changeSort({ key: 'funnel', stage, direction: activeSort?.key === 'funnel' ? activeSort.direction : 'descending' }); }}>
            {steps.map((stage, index) => <option key={stage} value={stage}>{MEASURES[stage]}{index ? ' (rasio)' : ''}</option>)}
          </select>}
        </th>)}</tr></thead>
        <tbody>{groups.map(g => { const insights = destinationHighlights(highlights, section.key, g.key); return <Fragment key={g.key}><tr>
          <td><button type="button" className={styles.nameButton} onClick={() => onOpenGroup(g)}>{g.name}</button><small>{g.ad_ids.length} ad · {g.accounts.join(', ')}</small>{insights.length > 0 && <span className={styles.rowInsights}><MetaHighlightValue highlights={insights} currency={currency} period={period} onDetail={() => onOpenGroup(g)} label={`Sorotan ${g.name}`} /></span>}</td>
          {visible.map(column => {
            const m = column.metric;
            if (!m) return <td key={column.key} className={styles.funnelCell}><StageChips group={g} stages={section.config.stages} currency={currency} highlights={insights} period={period} onDetail={() => onOpenGroup(g)} /></td>;
            const c = g.metrics.find(v => v.id === m.id)!;
            return <td key={column.key}><span style={section.mainMetric?.id === m.id ? { fontWeight: 650 } : undefined}><MetaHighlightValue highlights={highlightsForMetric(insights, m)} currency={currency} period={period} onDetail={() => onOpenGroup(g)}>{formatMetric(c.current, m, currency)}</MetaHighlightValue></span><small><Delta value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>;
          })}
        </tr>
        {world === 'website' && creativeFormatGroups(g, section.config.metrics).map(child => <tr key={child.key} className={styles.formatSubrow}>
          <th scope="row"><span className={styles.formatLabel}>{child.name}</span><small>{child.ad_ids.length} ads</small></th>
          {visible.map(column => {
            const m = column.metric;
            if (!m) return <td key={column.key} className={styles.funnelCell}><StageChips group={child} stages={section.config.stages} currency={currency} highlights={[]} onDetail={() => {}} /></td>;
            const c = child.metrics.find(v => v.id === m.id)!;
            return <td key={column.key}><span>{formatMetric(c.current, m, currency)}</span><small><Delta value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>;
          })}
        </tr>)}
        </Fragment>; })}</tbody>
        <tfoot><tr><th scope="row">Total {section.name}</th>{visible.map(column => {
          const m = column.metric;
          if (!m) return <td key={column.key} className={styles.funnelCell} />;
          const c = section.metrics.find(v => v.id === m.id)!;
          return <td key={column.key}>{formatMetric(c.current, m, currency)}<small><Delta value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>;
        })}</tr></tfoot>
      </table>
    </div>}
  </div>;
}
