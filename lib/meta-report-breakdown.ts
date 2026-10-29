import type { RawMetaReport } from './meta-ad-report';

export type MetaBreakdownGroup = Pick<RawMetaReport['groups'][number], 'key' | 'format_breakdown' | 'optimization_breakdown' | 'partnership_breakdown'>;

// A delayed child response must not overwrite current totals, names, sorting,
// template assignments or highlights. Callers additionally guard scope/revision.
export function mergeMetaBreakdown<T extends MetaBreakdownGroup>(groups: T[], children: MetaBreakdownGroup[]): T[] {
  const byKey = new Map(children.map(child => [child.key, child]));
  return groups.map(group => {
    const child = byKey.get(group.key);
    return { ...group, format_breakdown: child?.format_breakdown || [],
      optimization_breakdown: child?.optimization_breakdown || [], partnership_breakdown: child?.partnership_breakdown || [] };
  });
}
