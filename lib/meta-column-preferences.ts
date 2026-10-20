import type { FunnelMetric } from './meta-funnel-domain';

export type MetaColumnPreference = { order: string[]; hidden: string[] };
export type MetaResultColumn = { key: string; label: string; metric: FunnelMetric | null };
export const FUNNEL_COLUMN = 'funnel';

export function metaResultColumns(metrics: FunnelMetric[]): MetaResultColumn[] {
  return [...metrics.map(metric => ({ key: `metric:${metric.id}`, label: metric.label, metric })),
    { key: FUNNEL_COLUMN, label: 'Funnel', metric: null }];
}

export function parseMetaColumnPreference(value: unknown): MetaColumnPreference {
  if (!value || typeof value !== 'object') throw new Error('Pengaturan kolom tidak valid.');
  const { order, hidden } = value as MetaColumnPreference;
  const valid = (items: unknown): items is string[] => Array.isArray(items) && items.length <= 13
    && items.every(k => typeof k === 'string' && /^(funnel|metric:[a-zA-Z0-9_-]{1,50})$/.test(k))
    && new Set(items).size === items.length;
  if (!valid(order) || !valid(hidden) || hidden.some(k => !order.includes(k))) throw new Error('Pengaturan kolom tidak valid.');
  return { order: [...order], hidden: [...hidden] };
}

/** Keep saved choices, drop removed metrics, and append newly available columns. */
export function reconcileMetaColumns(columns: MetaResultColumn[], saved?: MetaColumnPreference | null): MetaColumnPreference {
  const keys = columns.map(c => c.key), known = new Set(keys);
  const order = [...new Set((saved?.order || []).filter(k => known.has(k)))];
  for (const key of keys) if (!order.includes(key)) order.push(key);
  const hidden = [...new Set((saved?.hidden || []).filter(k => known.has(k)))];
  // A template may remove the only visible metric since this preference was saved.
  if (order.length && order.every(k => hidden.includes(k))) hidden.splice(hidden.indexOf(order[0]), 1);
  return { order, hidden };
}

export function visibleMetaColumns(columns: MetaResultColumn[], saved?: MetaColumnPreference | null): MetaResultColumn[] {
  const { order, hidden } = reconcileMetaColumns(columns, saved);
  const byKey = new Map(columns.map(c => [c.key, c]));
  return order.filter(k => !hidden.includes(k)).map(k => byKey.get(k)!);
}

export function moveMetaColumn(order: string[], key: string, target: number): string[] {
  const from = order.indexOf(key);
  if (from < 0 || target < 0 || target >= order.length) return order;
  const next = [...order]; next.splice(from, 1); next.splice(target, 0, key); return next;
}

export function isDefaultMetaColumns(columns: MetaResultColumn[], value: MetaColumnPreference): boolean {
  return value.hidden.length === 0 && JSON.stringify(value.order) === JSON.stringify(columns.map(c => c.key));
}
