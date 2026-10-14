import assert from 'node:assert/strict';
import test from 'node:test';
import { metaBrandAccountIds, metaBrandOptions, UNMAPPED_META_BRAND, validateMetaBrandFilter } from '../lib/meta-ad-brands';
import { dimensionOptions, matchesAdDimensions, withAdDimensions } from '../lib/meta-ad-dimensions';
import { compareGroups, defaultFunnel, emptyTotals, hasCoverage, metricValue, totalFacts, trend, type AdFact } from '../lib/meta-funnel-domain';

const brands = [{ id: 1, name: 'Roove' }, { id: 2, name: 'Pluve' }, { id: 3, name: 'Calmara' }];
const accounts = [{ account_id: 'act_1', default_brand_id: 1 }, { account_id: 'act_2', default_brand_id: 1 }, { account_id: 'act_3', default_brand_id: 2 }, { account_id: 'act_4', default_brand_id: null }, { account_id: 'act_5', default_brand_id: 999 }, { account_id: 'act_6', default_brand_id: 3 }];
const fact = (account: string, id: string, spend: number, date = '2026-10-01'): AdFact => ({ account_id: account, account_name: account,
  ad_id: id, ad_name: '[sendi][cons] Same', campaign_objective: 'OUTCOME_SALES', metric_date: date, currency: 'IDR',
  landing_page_urls: ['https://example.com/shared'], metrics: { ...emptyTotals(), spend, impressions: spend, outbound_clicks: spend / 10, lpv: spend / 20 },
});

test('brand filter accepts canonical IDs and unmapped, and rejects invalid or unsafe input', () => {
  assert.equal(validateMetaBrandFilter(), undefined); assert.equal(validateMetaBrandFilter(''), undefined);
  assert.equal(validateMetaBrandFilter('1'), '1'); assert.equal(validateMetaBrandFilter(UNMAPPED_META_BRAND), UNMAPPED_META_BRAND);
  for (const value of ['0', '-1', '01', 'Roove', '1 OR true', '9007199254740992', null, 1]) assert.throws(() => validateMetaBrandFilter(value as string), /brand tidak valid/);
});

test('brand comes from account mapping; missing or unavailable workspace brands stay unmapped', () => {
  assert.deepEqual(metaBrandAccountIds(accounts, brands, '1'), ['act_1', 'act_2']);
  assert.deepEqual(metaBrandAccountIds(accounts, brands, '2'), ['act_3']);
  assert.deepEqual(metaBrandAccountIds(accounts, brands, UNMAPPED_META_BRAND), ['act_4', 'act_5']);
  assert.deepEqual(metaBrandAccountIds(accounts, brands), accounts.map(a => a.account_id));
  // A brand not present in the workspace's brand list cannot select another workspace's account.
  assert.deepEqual(metaBrandAccountIds(accounts, brands, '999'), []);
});

test('brand counts deduplicate ad-days by account and ad, sort by count, and preserve zero-count brands', () => {
  const options = metaBrandOptions(accounts, brands, [fact('act_1', '1', 100), fact('act_1', '1', 100, '2026-10-02'), fact('act_2', '1', 200), fact('act_3', '1', 999), fact('act_4', '9', 50), fact('act_outside', '1', 999)]);
  assert.equal(options.total, 4);
  assert.deepEqual(options.choices.map(o => [o.label, o.count]), [['Roove', 2], ['Brand belum dipetakan', 1], ['Pluve', 1], ['Calmara', 0]]);
});

test('brand plus CEP, intention, and objective scope totals, both breakdowns, comparisons, and trends identically', () => {
  const facts = [fact('act_1', '1', 100), fact('act_2', '1', 200), fact('act_3', '1', 999), fact('act_1', '1', 50, '2026-09-30'), { ...fact('act_2', '2', 999), ad_name: '[skin][conv] Other' }];
  const selected = metaBrandAccountIds(accounts, brands, '1');
  const rows = withAdDimensions(facts, []).filter(r => selected.includes(r.account_id) && matchesAdDimensions(r, { cep: 'joint', intention: 'cons', objective: 'OUTCOME_SALES' }));
  const config = defaultFunnel();
  const groups = compareGroups(rows, config, '2026-10-01', '2026-10-01');
  assert.equal(groups.length, 1); assert.equal(groups[0].current.spend, 300); assert.equal(groups[0].previous.spend, 50);
  assert.equal(compareGroups(rows, { ...config, group_by: 'ad_id' }, '2026-10-01', '2026-10-01').length, 2);
  const current = rows.filter(r => r.metric_date === '2026-10-01');
  assert.equal(totalFacts(current).spend, 300);
  assert.equal(metricValue(totalFacts(current), config.metrics.find(m => m.id === 'outbound_ctr')!), 0.1);
  for (const period of ['day', 'week', 'month'] as const) assert.equal(trend(current, config, '2026-10-01', '2026-10-01', period)[0].metrics.spent, 300);
});

test('brand options respect other filters while dimension choices stay within the selected brand', () => {
  const rows = withAdDimensions([fact('act_1', '1', 100), fact('act_3', '2', 200), { ...fact('act_3', '3', 200), campaign_objective: 'OUTCOME_TRAFFIC' }], []);
  const filters = { objective: 'OUTCOME_SALES' };
  const brandsForSales = metaBrandOptions(accounts, brands, rows.filter(r => matchesAdDimensions(r, filters)));
  assert.equal(brandsForSales.choices.find(b => b.value === '2')?.count, 1);
  const selected = metaBrandAccountIds(accounts, brands, '1');
  const dimensions = dimensionOptions([], rows.filter(r => selected.includes(r.account_id)), filters);
  assert.equal(dimensions.cepTotal, 1); assert.equal(dimensions.objectiveTotal, 1);
  assert.deepEqual(dimensions.objectives.map(o => o.value), ['OUTCOME_SALES']);
});

test('coverage for a brand requires its own accounts without blocking on other brands', () => {
  const selected = metaBrandAccountIds(accounts, brands, '1');
  const coverage = selected.map(account_id => ({ account_id, metric_date: '2026-10-01' }));
  assert.equal(hasCoverage(coverage, selected, '2026-10-01', '2026-10-01'), true);
  assert.equal(hasCoverage(coverage, accounts.map(a => a.account_id), '2026-10-01', '2026-10-01'), false);
  assert.equal(hasCoverage(coverage.slice(0, 1), selected, '2026-10-01', '2026-10-01'), false);
});
