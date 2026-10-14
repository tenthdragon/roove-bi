import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMetaRange, completedMetaRange, metaReportPresets, metaCoverageGaps } from '../lib/meta-report-status';
import { daysBetween, shiftDay, type Coverage } from '../lib/meta-funnel-domain';
import { getTodayWIB } from '../lib/sync-schedule';
import { getPresetRanges } from '../lib/utils';
const today = '2026-10-14';
function coverage(from: string, to: string, accounts = ['act_1', 'act_2']) {
  const result: Coverage[] = [];
  for (const account_id of accounts) for (let d = from; d <= to; d = shiftDay(d, 1)) result.push({ account_id, metric_date: d });
  return result;
}

test('Meta caps the current day and recalculates an equally long baseline', () => {
  const range = completedMetaRange({ from: '2026-10-01', to: today }, today);
  assert.deepEqual(range, { from: '2026-10-01', to: '2026-10-13' });
  assert.equal(shiftDay(range.from, -daysBetween(range.from, range.to)), '2026-09-18');
  assert.deepEqual(metaCoverageGaps(coverage('2026-09-18', '2026-10-13'), ['act_1', 'act_2'], range), []);
});
test('historical and uninitialized selections retain their original dates', () => {
  assert.deepEqual(completedMetaRange({ from: '2026-09-01', to: '2026-09-30' }, today), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(completedMetaRange({ from: '', to: '' }, today), { from: '', to: '' });
});
test('an unfinished-only selection falls back to the last closed day across month, year, and leap-day boundaries', () => {
  for (const [today, yesterday] of [['2026-11-01', '2026-10-31'], ['2027-01-01', '2026-12-31'], ['2028-03-01', '2028-02-29']]) {
    assert.deepEqual(completedMetaRange({ from: today, to: today }, today), { from: yesterday, to: yesterday });
  }
  assert.equal(getTodayWIB(new Date('2026-10-13T17:01:00Z')), today);
});
test('Meta presets use only completed dates and exactly 7, 30, or 90 days', () => {
  const presets = metaReportPresets(today);
  assert.deepEqual(presets.find(p => p.label === 'Kemarin'), { label: 'Kemarin', from: '2026-10-13', to: '2026-10-13' });
  assert.equal(presets.some(p => p.label === 'Hari Ini'), false);
  for (const p of presets) assert.ok(p.from <= p.to && p.to < today);
  for (const n of [7, 30, 90]) { const p = presets.find(p => p.label === `${n} Hari`)!; assert.equal(daysBetween(p.from, p.to), n); }
  assert.deepEqual(presets.find(p => p.label === '90 Hari'), { label: '90 Hari', from: '2026-07-16', to: '2026-10-13' });
  assert.equal(metaReportPresets('2026-11-01').some(p => p.label === 'Bulan Ini'), false);
});
test('regular dashboard presets still include today and the original cut-off period', () => {
  const regular = getPresetRanges(new Date(`${today}T12:00:00+07:00`));
  assert.deepEqual(regular.find(p => p.label === 'Hari Ini'), { label: 'Hari Ini', from: today, to: today });
  assert.equal(regular.find(p => p.label === 'Bulan Ini')?.to, today);
  assert.equal(regular.find(p => p.label === 'Cut Off')?.to, '2026-10-25');
});
test('gaps identify the affected account and distinguish current and comparison dates', () => {
  const rows = coverage('2026-09-18', '2026-10-13').filter(c => c.account_id !== 'act_2' || !['2026-09-20', '2026-10-07'].includes(c.metric_date));
  assert.deepEqual(metaCoverageGaps(rows, ['act_1', 'act_2'], { from: '2026-10-01', to: '2026-10-13' }), [{ account_id: 'act_2', currentMissing: 1, baselineMissing: 1, firstMissing: '2026-09-20', lastMissing: '2026-10-07' }]);
  assert.deepEqual(metaCoverageGaps(rows, ['act_1'], { from: '2026-10-01', to: '2026-10-13' }), []);
});
test('baseline-only gaps do not classify current data as incomplete', () => {
  assert.deepEqual(metaCoverageGaps(coverage('2026-10-01', '2026-10-13', ['act_1']), ['act_1'], { from: '2026-10-01', to: '2026-10-13' }), [{ account_id: 'act_1', currentMissing: 0, baselineMissing: 13, firstMissing: '2026-09-18', lastMissing: '2026-09-30' }]);
});
test('successfully synchronized zero-delivery dates are complete, and an empty account scope produces no gap warning', () => {
  const range = { from: '2026-10-01', to: '2026-10-01' };
  assert.deepEqual(metaCoverageGaps(coverage('2026-09-30', '2026-10-01'), ['act_1', 'act_1'], range), []);
  assert.deepEqual(metaCoverageGaps([], [], range), []);
});

test('the Meta default follows completed days independently of other dashboard data dates', () => {
  assert.deepEqual(defaultMetaRange(today), { from: '2026-10-01', to: '2026-10-13' });
  assert.deepEqual(defaultMetaRange('2026-11-01'), { from: '2026-10-01', to: '2026-10-31' });
});
