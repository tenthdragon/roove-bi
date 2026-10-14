import { daysBetween, shiftDay, type Coverage } from './meta-funnel-domain';
import { getPresetRanges } from './utils';

export function defaultMetaRange(today: string) {
  const to = shiftDay(today, -1);
  return { from: `${to.slice(0, 7)}-01`, to };
}
export function completedMetaRange(range: { from: string; to: string }, today: string) {
  if (!range.from || !range.to) return range;
  const to = range.to < today ? range.to : shiftDay(today, -1);
  return { from: range.from <= to ? range.from : to, to };
}
export function metaReportPresets(today: string) {
  const end = shiftDay(today, -1);
  return getPresetRanges(new Date(`${today}T12:00:00+07:00`)).flatMap(p => {
    if (p.label === 'Hari Ini') return [{ label: 'Kemarin', from: end, to: end }];
    const lengths: Record<string, number> = { '7 Hari': 7, '30 Hari': 30, '90 Hari': 90 };
    const length = lengths[p.label];
    if (length) return [{ ...p, from: shiftDay(end, 1 - length), to: end }];
    if (p.from > end) return [];
    return [{ ...p, to: p.to > end ? end : p.to }];
  });
}
export function metaCoverageGaps(coverage: Coverage[], accounts: string[], range: { from: string; to: string }) {
  const baselineFrom = shiftDay(range.from, -daysBetween(range.from, range.to));
  const available = new Set(coverage.map(c => `${c.account_id}:${c.metric_date}`));
  return [...new Set(accounts)].flatMap(account_id => {
    let currentMissing = 0, baselineMissing = 0;
    let firstMissing = '', lastMissing = '';
    for (let day = baselineFrom; day <= range.to; day = shiftDay(day, 1)) {
      if (available.has(`${account_id}:${day}`)) continue;
      if (day < range.from) baselineMissing++; else currentMissing++;
      firstMissing ||= day; lastMissing = day;
    }
    return currentMissing || baselineMissing ? [{ account_id, currentMissing, baselineMissing, firstMissing, lastMissing }] : [];
  });
}
