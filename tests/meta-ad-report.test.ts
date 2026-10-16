import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFunnel, emptyTotals, metricValue } from '../lib/meta-funnel-domain';
import { metaReportBrandSections, metaReportGroups, metaReportHistory, metaReportOptions, metaReportQuery, type RawMetaReport } from '../lib/meta-ad-report';

const config = defaultFunnel();
const raw = (patch: Partial<RawMetaReport> = {}): RawMetaReport => ({ currencies: ['IDR'], summary: emptyTotals(), previous: emptyTotals(), groups: [], coverage: [], facets: [], facetTotals: {}, brandCounts: {}, matchingAds: 0, objectiveUnknownAds: 0,
  destinations: { urls: 0, missing_ads: 0, multi_ads: 0, missing: [] }, history: [], historyComplete: true, creatives: [], ...patch });
test('cached query separates dates, scope, filters and views without reading focused history for overview', () => {
  const input = { from: '2026-10-01', to: '2026-10-13', groupKey: 'landing:https://example.com/', brandId: '1', filters: { cep: 'joint' } };
  const q = metaReportQuery(input, { ...config, account_ids: ['act_2', 'act_1'] });
  assert.equal(q.groupKey, null); assert.equal(q.view, 'overview'); assert.deepEqual(q.config.account_ids, ['act_1', 'act_2']);
  const history = metaReportQuery(input, config, 'trends', 'month');
  assert.equal(history.groupKey, input.groupKey); assert.equal(history.period, 'month'); assert.equal(history.view, 'trends');
  assert.notDeepEqual(q, metaReportQuery({ ...input, brandId: '2' }, config));
  assert.notDeepEqual(q, metaReportQuery({ ...input, filters: { cep: 'bone' } }, config));
  assert.notDeepEqual(q, metaReportQuery({ ...input, to: '2026-10-12' }, config));
});
test('ratios derive from database event sums and keep zero-denominator values absent', () => {
  const groups = metaReportGroups(raw({ groups: [{ key: 'landing:x', name: 'x', current: { ...emptyTotals(), spend: 100, impressions: 1000, outbound_clicks: 50, lpv: 40 }, previous: { ...emptyTotals(), spend: 50, impressions: 100, outbound_clicks: 10 }, ad_ids: ['1','2'], ad_names: ['[joint][cons] A'], accounts: ['A'], landing_page_urls: ['https://example.com/'], verified_ad_ids: [] }] }), config);
  assert.equal(groups[0].metrics.find(m => m.id === 'outbound_ctr')?.current, 0.05);
  assert.equal(groups[0].metrics.find(m => m.id === 'lpv_rate')?.current, 0.8);
  assert.equal(groups[0].metrics.find(m => m.id === 'purchase_rate')?.current, null);
  assert.deepEqual(groups[0].creatives, []);
  assert.equal(metaReportGroups(raw({ groups: [{ ...groups[0], name: '', ad_ids: ['1'] }] }), config)[0].name, '1');
});
test('daily comparison keeps the preceding day while incomplete buckets remain gaps', () => {
  const report = raw({ history: [
    { date: '2026-09-30', totals: { ...emptyTotals(), spend: 50 }, complete: true, partial: false },
    { date: '2026-10-01', totals: { ...emptyTotals(), spend: 100 }, complete: true, partial: false },
    { date: '2026-10-02', totals: emptyTotals(), complete: false, partial: false },
  ] });
  const points = metaReportHistory(report, config, 'daily');
  assert.equal(points.length, 2); assert.equal(points[0].metrics.spent, 100);
  assert.equal('previousMetrics' in points[0] && points[0].previousMetrics.spent, 50);
  assert.equal(points[1].metrics.spent, null); assert.equal(points[1].complete, false);
});
test('mixed currencies never produce monetary trend metrics', () => {
  const points = metaReportHistory(raw({ currencies: ['IDR','USD'], history: [{ date: '2026-10-01', totals: { ...emptyTotals(), spend: 100 }, complete: true, partial: true }] }), config, 'trends');
  assert.equal(points[0].complete, false); assert.equal(points[0].metrics.spent, null); assert.equal(points[0].partial, true);
});
test('facet totals remain database distinct-ad counts even when one ad appears under multiple reported objectives', () => {
  const options = metaReportOptions(raw({ facets: [{ dimension: 'objective', value: 'OUTCOME_SALES', count: 3 }, { dimension: 'objective', value: 'OUTCOME_TRAFFIC', count: 3 }, { dimension: 'cep', value: 'joint', count: 0 }], facetTotals: { objective: 4 }, brandCounts: { '1': 4 } }), [{ account_id: 'act_1', default_brand_id: 1 }], [{ id: 1, name: 'Roove' }]);
  assert.equal(options.dimensionOptions.objectiveTotal, 4);
  assert.deepEqual(options.dimensionOptions.objectives.map(o => o.label), ['Sales','Traffic']);
  assert.deepEqual(options.dimensionOptions.ceps, [{ value: 'joint', label: 'Sendi', count: 0 }]);
  assert.equal(options.brandOptions.total, 4);
});
test('brands outside the saved monitoring account scope remain selectable with zero ads', () => {
  const options = metaReportOptions(raw({ brandCounts: { '1': 4 } }),
    [{ account_id: 'act_1', default_brand_id: 1 }, { account_id: 'act_2', default_brand_id: 2 }],
    [{ id: 1, name: 'Roove' }, { id: 2, name: 'Pluve' }]);
  assert.deepEqual(options.brandOptions.choices.map(b => [b.label, b.count]), [['Roove', 4], ['Pluve', 0]]);
  assert.equal(options.brandOptions.total, 4);
});

test('the nine report metrics use event totals, including CPM multiplier and IC/ATC', () => {
  const totals = { ...emptyTotals(), spend: 12500, impressions: 2500, outbound_clicks: 250, lpv: 200, atc: 40, checkout: 10, purchases: 2 };
  const values = Object.fromEntries(config.metrics.map(m => [m.id, metricValue(totals, m)]));
  assert.deepEqual(values, { spent: 12500, cpm: 5000, outbound_ctr: .1, lpv_rate: .8, atc_rate: .2, ic_rate: .25, purchase_rate: .2, cpic: 1250, cpp: 6250 });
  for (const metric of config.metrics.filter(m => m.denominator)) assert.equal(metricValue(emptyTotals(), metric), null);
});

test('brand sections isolate a shared landing page and retain filters and monitoring scope', async () => {
  const accounts = [{ account_id: 'act_1', default_brand_id: 1 }, { account_id: 'act_2', default_brand_id: 2 }];
  const brands = [{ id: 1, name: 'Roove' }, { id: 2, name: 'Pluve' }];
  const queries: any[] = [];
  const totals = {
    '1': { ...emptyTotals(), spend: 1000, impressions: 10000, atc: 10, checkout: 2 },
    '2': { ...emptyTotals(), spend: 3000, impressions: 1000, atc: 30, checkout: 20 },
  };
  const sections = await metaReportBrandSections({ from: '2026-10-01', to: '2026-10-02', filters: { cep: 'joint' } }, { ...config, account_ids: ['act_1','act_2'] }, accounts, brands, async q => {
    queries.push(q); const t = totals[q.brand as '1'|'2'];
    return raw({ summary: t, groups: [{ key: 'landing:https://shared.test', name: 'https://shared.test', current: t, previous: emptyTotals(), ad_ids: [q.brand!], ad_names: ['A'], accounts: [q.brand!], landing_page_urls: ['https://shared.test'], verified_ad_ids: [] }] });
  });
  assert.deepEqual(queries.map(q => q.brand).sort(), ['1','2']);
  assert.ok(queries.every(q => q.filters.cep === 'joint' && q.groupBy === 'landing_page' && q.config.account_ids.length === 2));
  assert.deepEqual(sections.map(s => s.name), ['Pluve','Roove']);
  assert.equal(sections[0].groups[0].current.spend, 3000); assert.equal(sections[1].groups[0].current.spend, 1000);
  assert.equal(metricValue(sections[0].summary, config.metrics.find(m => m.id === 'ic_rate')!), 20 / 30);
  assert.equal(sections.reduce((s, b) => s + b.summary.spend, 0), 4000);
});

test('a selected brand does not fetch or render other brand sections', async () => {
  assert.deepEqual(await metaReportBrandSections({ from: '2026-10-01', to: '2026-10-02', brandId: '1' }, config, [], [], async () => { throw new Error('Must not read another brand'); }), []);
});
