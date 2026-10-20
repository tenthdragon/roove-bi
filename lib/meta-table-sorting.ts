import { MEASURES, type Measure } from './meta-funnel-domain';
import type { TemplateGroup } from './meta-funnel-templates';

export type MetaTableSort = { direction: 'ascending' | 'descending' } & (
  { key: 'name' } | { key: `metric:${string}` } | { key: 'funnel'; stage: Measure }
);

/** Match the count/step ratio displayed in the Funnel cell. */
export function metaStageValue(group: TemplateGroup, stages: Measure[], stage: Measure): number | null {
  const steps: Measure[] = stages.filter(s => s !== 'spend');
  const index = steps.indexOf(stage);
  if (index < 0) return null;
  const value = group.current[stage];
  if (index === 0) return value;
  const denominator = group.current[steps[index - 1]];
  return value != null && denominator != null && denominator > 0 ? value / denominator : null;
}

export function sortMetaGroups(groups: TemplateGroup[], sort: MetaTableSort | null, stages: Measure[]): TemplateGroup[] {
  if (!sort) return groups;
  const sign = sort.direction === 'ascending' ? 1 : -1;
  if (sort.key === 'name') return [...groups].sort((a, b) => sign * a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }));
  const values = new Map(groups.map(g => [g, sort.key === 'funnel'
    ? metaStageValue(g, stages, sort.stage) : g.metrics.find(m => `metric:${m.id}` === sort.key)?.current]));
  // Sort a copy; stable ties preserve the original report order. Missing values
  // remain last in both directions, independently of formatted display strings.
  return [...groups].sort((a, b) => {
    const av = values.get(a), bv = values.get(b);
    const aMissing = av == null || !Number.isFinite(av), bMissing = bv == null || !Number.isFinite(bv);
    if (aMissing || bMissing) return Number(aMissing) - Number(bMissing);
    return sign * (av! - bv!);
  });
}

/** Validate untrusted saved/input settings before using a dynamic metric/stage key. */
export function parseMetaTableSort(value: unknown): MetaTableSort | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Pengurutan tidak valid.');
  const { key, direction, stage } = value as Record<string, unknown>;
  if (direction !== 'ascending' && direction !== 'descending') throw new Error('Arah pengurutan tidak valid.');
  if (key === 'funnel' && typeof stage === 'string' && stage !== 'spend' && Object.hasOwn(MEASURES, stage)) {
    return { key, direction, stage: stage as Measure };
  }
  if ((key === 'name' || typeof key === 'string' && /^metric:[a-zA-Z0-9_-]{1,50}$/.test(key)) && stage === undefined) {
    return { key: key as 'name' | `metric:${string}`, direction };
  }
  throw new Error('Kolom atau tahap pengurutan tidak valid.');
}
