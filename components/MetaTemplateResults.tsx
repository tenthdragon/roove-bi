'use client';

import { useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MEASURES, type Measure } from '@/lib/meta-funnel-domain';
import { TEMPLATE_KIND_LABELS, WORLD_LABELS, type MetaBrandWorld, type TemplateGroup, type TemplateSection } from '@/lib/meta-funnel-templates';
import { formatChange, formatCompactMoney, formatCount, formatMetric } from '@/lib/meta-format';
import { metaResultColumns, visibleMetaColumns, type MetaColumnPreference } from '@/lib/meta-column-preferences';
import MetaColumnEditor from '@/components/MetaColumnEditor';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

function Delta({ value, direction = 'higher', neutral = false }: { value: number | null; direction?: 'higher' | 'lower'; neutral?: boolean }) {
  if (value === null) return <span className={styles.neutral}>—</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span className={neutral ? styles.neutral : good ? styles.good : styles.bad}>{formatChange(value)}</span>;
}
function StageChips({ group, stages, currency }: { group: TemplateGroup; stages: Measure[]; currency: string }) {
  const steps = stages.filter(s => s !== 'spend');
  return <div className={styles.stageChips}>{steps.map((stage, i) => {
    const value = group.current[stage], prev = i ? group.current[steps[i - 1]] : 0;
    return <span key={stage} className={styles.stageChip} title={`${MEASURES[stage]}${i ? ` ÷ ${MEASURES[steps[i - 1]]}` : ''}`}>{MEASURES[stage].replace('Landing page views', 'LPV').replace('Initiate checkout', 'IC').replace('Add to cart', 'ATC').replace('Outbound clicks', 'Outbound').replace('Messaging conversations', 'Conv')} {i === 0 ? formatCount(value) : formatMetric(value != null && prev != null && prev > 0 ? value / prev : null, 'percent', currency)}</span>;
  })}</div>;
}

export default function MetaTemplateResults({ section, world, currency, preference, preferencesReady, onSave, onOpenGroup }: {
  section: TemplateSection; world: MetaBrandWorld; currency: string; preference?: MetaColumnPreference | null;
  preferencesReady: boolean; onSave?: (value: MetaColumnPreference | null) => Promise<void>;
  onOpenGroup: (group: TemplateGroup) => void;
}) {
  const [editing, setEditing] = useState(false), [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const columns = metaResultColumns(section.config.metrics), visible = visibleMetaColumns(columns, preference);
  const close = () => { setEditing(false); trigger.current?.focus(); };
  return <div className={styles.sectionCard}>
    <div className={styles.sectionHead}>
      <div><span className={`${styles.templateTag} ${world === 'cpas' ? styles.templateTagCpas : ''}`}>{world === 'cpas' ? 'CPAS' : 'TEMPLATE'}</span><strong>{section.name}</strong><span>{section.config.stages.filter(s => s !== 'spend').map(s => MEASURES[s]).join(' → ')} · {section.groups.length} {world === 'website' ? 'tujuan' : 'ad'} · {formatCompactMoney(section.summary.spend, currency)}</span></div>
      <div><span>{section.mainMetric && section.mainMedian !== null ? `Median ${section.mainMetric.label} ${formatMetric(section.mainMedian, section.mainMetric, currency)}` : TEMPLATE_KIND_LABELS[section.kind]}</span>
        {onSave && <button ref={trigger} type="button" className={`${styles.button} ${styles.columnSettingsButton}`} disabled={!preferencesReady} aria-haspopup="dialog" onClick={() => { setNotice(''); setEditing(true); }}><SlidersHorizontal size={14} />Atur kolom</button>}
      </div>
    </div>
    {notice && <p role="status" className={styles.columnSaved}>{notice}</p>}
    {editing && onSave && <MetaColumnEditor key={JSON.stringify(columns.map(c => c.key))} name={section.name} columns={columns} preference={preference} onClose={close}
      onSave={async value => { await onSave(value); setNotice('Pengaturan kolom disimpan.'); }} />}
    {!section.groups.length ? <p className={styles.muted} style={{ padding: '12px 16px' }}>Belum ada ad {WORLD_LABELS[world]} pada periode dan filter ini.</p> : <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
      <table className={styles.resultTable} aria-label={`Hasil ${section.name}`} style={{ minWidth: Math.max(380, 220 + visible.length * 110) }}>
        <thead><tr><th scope="col">{world === 'website' ? 'Tujuan' : 'Ad'}</th>{visible.map(column => <th key={column.key} scope="col" className={!column.metric ? styles.funnelCell : undefined}
          title={column.metric ? column.metric.denominator ? `${MEASURES[column.metric.numerator]} ÷ ${MEASURES[column.metric.denominator]}` : MEASURES[column.metric.numerator] : undefined}>{column.label}</th>)}</tr></thead>
        <tbody>{section.groups.map(g => <tr key={g.key}>
          <td><button type="button" className={styles.nameButton} onClick={() => onOpenGroup(g)}>{g.name}</button><small>{g.ad_ids.length} ad · {g.accounts.join(', ')}</small></td>
          {visible.map(column => {
            const m = column.metric;
            if (!m) return <td key={column.key} className={styles.funnelCell}><StageChips group={g} stages={section.config.stages} currency={currency} /></td>;
            const c = g.metrics.find(v => v.id === m.id)!;
            return <td key={column.key}><span style={section.mainMetric?.id === m.id ? { fontWeight: 650 } : undefined}>{formatMetric(c.current, m, currency)}</span><small><Delta value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>;
          })}
        </tr>)}</tbody>
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
