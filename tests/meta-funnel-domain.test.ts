import test from 'node:test';
import assert from 'node:assert/strict';
import { compareGroups, defaultFunnel, diagnose, emptyTotals, evaluateDeclines, hasCoverage, matchesFunnel, metricValue, namingQuality, shiftDay, trend, validateFunnel, validateRange,
  type AdFact, type Coverage, type FunnelConfig, type Totals } from '../lib/meta-funnel-domain';
import { normalizeAdInsight, fetchAdInsights } from '../lib/meta-ad-insights';
import { parseRooveAdName } from '../lib/meta-ad-naming';

// Preserve the previously supported naming/rate rules as a regression fixture.
function legacyFunnel(): FunnelConfig {
  return { ...defaultFunnel(), group_by: 'cep_funnel', metrics: [
    { id: 'ctr', label: 'Link CTR', numerator: 'link_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 1000 },
    { id: 'lpv_rate', label: 'Click to LPV', numerator: 'lpv', denominator: 'link_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
    { id: 'purchase_rate', label: 'LPV to purchase', numerator: 'purchases', denominator: 'lpv', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
    { id: 'cpa', label: 'CPA', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 3 },
  ] };
}

function fact(date: string, metrics: Partial<Totals>, ad = '1', name = 'Creative A', account = 'act_1'): AdFact {
  return { account_id: account, account_name: account, ad_id: ad, ad_name: name, metric_date: date, currency: 'IDR', metrics: { ...emptyTotals(), ...metrics } };
}
function coverage(from: string, to: string, accounts = ['act_1']): Coverage[] {
  const rows: Coverage[] = [];
  for (const account_id of accounts) for (let d = from; d <= to; d = shiftDay(d, 1)) rows.push({ account_id, metric_date: d });
  return rows;
}
function alertConfig(): FunnelConfig {
  return { ...legacyFunnel(), window_days: 1, min_spend: 0, min_impressions: 0,
    metrics: [{ id: 'ctr', label: 'CTR', numerator: 'link_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 100 }] };
}

test('same names across accounts are grouped; aggregate CTR uses counts, not mean of rates', () => {
  const rows = [fact('2026-10-10', { impressions: 100, link_clicks: 10 }, '1', '  Creative   A '), fact('2026-10-10', { impressions: 900, link_clicks: 9 }, '2', 'creative a', 'act_2')];
  const [group] = compareGroups(rows, legacyFunnel(), '2026-10-10', '2026-10-10');
  assert.equal(group.current.impressions, 1000); assert.equal(group.current.link_clicks, 19);
  assert.equal(group.metrics.find(m => m.id === 'ctr')?.current, .019);
  assert.equal(group.accounts.length, 2); assert.equal(group.ad_ids.length, 2);
});
test('filter selects accounts and names before aggregation', () => {
  const config = { ...legacyFunnel(), account_ids: ['act_1'], match: 'exact' as const, name_filter: 'creative a' };
  const rows = [fact('2026-10-10', { spend: 1 }), fact('2026-10-10', { spend: 100 }, '2', 'Creative A variation'), fact('2026-10-10', { spend: 1000 }, '3', 'Creative A', 'act_2')];
  assert.equal(compareGroups(rows, config, '2026-10-10', '2026-10-10')[0].current.spend, 1);
});
test('period comparison uses equally long preceding period across month boundaries', () => {
  const rows = [fact('2026-09-29', { spend: 50 }), fact('2026-09-30', { spend: 70 }), fact('2026-10-01', { spend: 10 }), fact('2026-10-02', { spend: 20 }), fact('2026-09-28', { spend: 999 })];
  const [g] = compareGroups(rows, legacyFunnel(), '2026-10-01', '2026-10-02');
  assert.equal(g.current.spend, 30); assert.equal(g.previous.spend, 120);
});
test('weekly buckets begin Monday and monthly ratios use total events', () => {
  const config = alertConfig();
  const rows = [fact('2026-10-04', { impressions: 100, link_clicks: 10 }), fact('2026-10-05', { impressions: 900, link_clicks: 9 })];
  const weeks = trend(rows, config, '2026-10-04', '2026-10-05', 'week');
  assert.deepEqual(weeks.map(w => w.date), ['2026-09-28', '2026-10-05']);
  assert.equal(trend(rows, config, '2026-10-04', '2026-10-05', 'month')[0].metrics.ctr, .019);
});
test('daily buckets include successfully synced zero-delivery days', () => {
  const points = trend([fact('2026-10-01', { spend: 10 })], legacyFunnel(), '2026-10-01', '2026-10-03', 'day');
  assert.equal(points.length, 3); assert.equal(points[1].totals.spend, 0); assert.equal(points[1].metrics.cpa, null);
});
test('coverage must include every scoped account and date, including empty reports', () => {
  assert.equal(hasCoverage(coverage('2026-10-01', '2026-10-02'), ['act_1', 'act_2'], '2026-10-01', '2026-10-02'), false);
  assert.equal(hasCoverage(coverage('2026-10-01', '2026-10-02', ['act_1', 'act_2']), ['act_1', 'act_2'], '2026-10-01', '2026-10-02'), true);
  assert.equal(hasCoverage([], [], '2026-10-01', '2026-10-02'), false);
});
test('decline alarm needs complete history; explains weaker CTR and preserves suspect identity', () => {
  const rows = [fact('2026-10-01', { impressions: 1000, link_clicks: 100, spend: 100 }), fact('2026-10-02', { impressions: 1000, link_clicks: 50, spend: 100 })];
  assert.equal(evaluateDeclines(rows, [], alertConfig(), ['act_1'], '2026-10-02').length, 0);
  const [alarm] = evaluateDeclines(rows, coverage('2026-10-01', '2026-10-02'), alertConfig(), ['act_1'], '2026-10-02');
  assert.equal(alarm.change, -50); assert.equal(alarm.suspects[0].ad_id, '1');
  assert.match(alarm.insights.join(' '), /CTR turun/);
});
test('alerts ignore low sample sizes, new creatives, and unmonitored metrics', () => {
  const rows = [fact('2026-10-01', { impressions: 10, link_clicks: 5 }), fact('2026-10-02', { impressions: 10, link_clicks: 1 })];
  const cov = coverage('2026-10-01', '2026-10-02');
  assert.equal(evaluateDeclines(rows, cov, alertConfig(), ['act_1'], '2026-10-02').length, 0);
  assert.equal(evaluateDeclines([fact('2026-10-02', { impressions: 1000, link_clicks: 10 })], cov, alertConfig(), ['act_1'], '2026-10-02').length, 0);
  const config = alertConfig(); config.metrics[0].monitor = false;
  assert.equal(evaluateDeclines(rows, cov, config, ['act_1'], '2026-10-02').length, 0);
});
test('cost metric worsening means increasing; improvements do not trigger', () => {
  const config = alertConfig(); config.metrics = [{ id: 'cpa', label: 'CPA', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 }];
  const rows = [fact('2026-10-01', { spend: 100, purchases: 10 }), fact('2026-10-02', { spend: 100, purchases: 5 })];
  assert.equal(evaluateDeclines(rows, coverage('2026-10-01', '2026-10-02'), config, ['act_1'], '2026-10-02')[0].change, 100);
  rows[1].metrics.purchases = 20;
  assert.equal(evaluateDeclines(rows, coverage('2026-10-01', '2026-10-02'), config, ['act_1'], '2026-10-02').length, 0);
});
test('Meta overlapping event aliases are selected once; purchase revenue can use ROAS fallback', () => {
  const metrics = normalizeAdInsight({ ad_id: '1', ad_name: 'A', date_start: '2026-10-01', date_stop: '2026-10-01', spend: '100',
    actions: [{ action_type: 'omni_purchase', value: '3' }, { action_type: 'purchase', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
      { action_type: 'omni_add_to_cart', value: '7' }, { action_type: 'add_to_cart', value: '7' }],
    purchase_roas: [{ action_type: 'omni_purchase', value: '2.5' }] });
  assert.equal(metrics.purchases, 3); assert.equal(metrics.atc, 7); assert.equal(metrics.purchase_value, 250);
  assert.equal(metricValue(metrics, legacyFunnel().metrics.find(m => m.id === 'cpa')!), 100 / 3);
});
test('undefined denominators stay unknown, zero conversions are genuine zero for conversion rate', () => {
  const config = legacyFunnel(); const t = emptyTotals();
  assert.equal(metricValue(t, config.metrics[0]), null);
  t.lpv = 100; assert.equal(metricValue(t, config.metrics.find(m => m.id === 'purchase_rate')!), 0);
});
test('config validation rejects invalid metrics, duplicate IDs, and excessive windows', () => {
  assert.equal(validateFunnel(legacyFunnel()).name, legacyFunnel().name);
  const c = legacyFunnel(); c.metrics[0].numerator = '__proto__' as any;
  assert.throws(() => validateFunnel(c));
  const duplicate = legacyFunnel(); duplicate.metrics[1].id = duplicate.metrics[0].id;
  assert.throws(() => validateFunnel(duplicate));
  assert.throws(() => validateFunnel({ ...legacyFunnel(), window_days: 90 }));
  assert.throws(() => validateRange('2026-02-30', '2026-03-01'));
});
test('a failed second API page rejects the snapshot, without exposing bearer credentials', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer SECRET');
    assert.equal(String(url).includes('access_token='), false);
    return calls === 1 ? new Response(JSON.stringify({ data: [{ ad_id: '1' }], paging: { next: 'https://graph.facebook.com/next?access_token=SECRET' } }))
      : new Response(JSON.stringify({ error: { code: 17, message: 'Rate limit' } }), { status: 429 });
  };
  try { await assert.rejects(fetchAdInsights('act_1', '2026-10-01', '2026-10-01', 'SECRET'), /Rate limit/); assert.equal(calls, 2); }
  finally { globalThis.fetch = original; }
});
test('pagination rejects foreign hosts before sending a token', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ data: [], paging: { next: 'https://attacker.test/next' } })); };
  try { await assert.rejects(fetchAdInsights('act_1', '2026-10-01', '2026-10-01', 'SECRET'), /pagination host/); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});

test('Roove naming parses every documented CEP and funnel and preserves free creative names', () => {
  for (const cep of ['skin', 'joint', 'bone', 'hair', 'nail']) for (const funnel of ['disc', 'cons', 'conv']) {
    const parsed = parseRooveAdName(`[${cep}][${funnel}] Creative - Free 10 Sachet`);
    assert.equal(parsed.valid, true); assert.equal(parsed.cep, cep); assert.equal(parsed.funnel, funnel);
    assert.equal(parsed.creative_name, 'Creative - Free 10 Sachet');
  }
});
test('Roove naming rejects uppercase keys, spaced brackets, unknown tags, and missing creative names', () => {
  for (const name of ['[Skin][disc] A', '[skin] [disc] A', '[skin][DISC] A', '[skin][other] A', '[other][disc] A', '[skin][disc]   ', 'skin-disc A', 'Kulit Glowing Setiap Hari', '[__proto__][disc] A']) {
    const parsed = parseRooveAdName(name); assert.equal(parsed.valid, false, name);
    assert.equal(parsed.cep, null); assert.equal(parsed.funnel, null);
  }
});
test('CEP × funnel aggregates different creatives but never combines stages or guesses legacy tags', () => {
  const rows = [fact('2026-10-10', { impressions: 100, link_clicks: 10 }, '1', '[skin][disc] Kulit Glowing Setiap Hari'),
    fact('2026-10-10', { impressions: 900, link_clicks: 9 }, '2', '[skin][disc] Hook baru', 'act_2'),
    fact('2026-10-10', { spend: 40 }, '3', '[skin][cons] Testimoni Kulit Cerah 30 Hari'),
    fact('2026-10-10', { spend: 20 }, '4', 'Kulit Glowing'), fact('2026-10-10', { spend: 30 }, '5', 'Sendi Nyaman')];
  const groups = compareGroups(rows, legacyFunnel(), '2026-10-10', '2026-10-10');
  assert.equal(groups.length, 4);
  const skin = groups.find(g => g.key === 'cep_funnel:skin:disc')!;
  assert.equal(skin.ad_names.length, 2); assert.equal(skin.ad_ids.length, 2);
  assert.equal(skin.metrics.find(m => m.id === 'ctr')?.current, .019);
  assert.equal(groups.filter(g => !g.classified).length, 2);
  assert.equal(compareGroups(rows, { ...legacyFunnel(), group_by: 'cep' }, '2026-10-10', '2026-10-10').find(g => g.key === 'cep:skin')?.ad_ids.length, 3);
  assert.equal(compareGroups(rows, { ...legacyFunnel(), group_by: 'ad_name' }, '2026-10-10', '2026-10-10').length, 5);
});
test('CEP and stage filtering applies to trends and alerts, retaining individual suspect names', () => {
  const config: FunnelConfig = { ...alertConfig(), cep_keys: ['skin'], funnel_keys: ['disc'], naming_status: 'tagged' };
  const rows = [fact('2026-10-01', { impressions: 1000, link_clicks: 100 }, '1', '[skin][disc] Hook A'),
    fact('2026-10-02', { impressions: 1000, link_clicks: 40 }, '1', '[skin][disc] Hook A'),
    fact('2026-10-02', { impressions: 100000, link_clicks: 20000 }, '2', '[joint][disc] Hook B'),
    fact('2026-10-02', { impressions: 100000, link_clicks: 20000 }, '3', '[skin][conv] Promo')];
  const [alarm] = evaluateDeclines(rows, coverage('2026-10-01', '2026-10-02'), config, ['act_1'], '2026-10-02');
  assert.equal(alarm.group_key, 'cep_funnel:skin:disc'); assert.equal(alarm.change, -60);
  assert.equal(alarm.suspects[0].ad_name, '[skin][disc] Hook A');
  assert.equal(trend(rows, config, '2026-10-01', '2026-10-02', 'day', alarm.group_key)[1].metrics.ctr, .04);
  assert.equal(matchesFunnel(rows[0], { ...config, naming_status: 'untagged' }), false);
});
test('naming quality exposes malformed historical names even when category filters exclude them', () => {
  const config: FunnelConfig = { ...legacyFunnel(), cep_keys: ['skin'], naming_status: 'tagged' };
  const rows = [fact('2026-10-02', { spend: 100 }, '1', '[skin][disc] Hook A'),
    fact('2026-10-02', { spend: 200 }, '2', '[Skin][disc] Hook B'), fact('2026-10-02', { spend: 300 }, '3', 'Legacy')];
  const quality = namingQuality(rows, config, '2026-10-02', '2026-10-02');
  assert.equal(quality.valid_names, 1); assert.equal(quality.invalid_names, 2); assert.equal(quality.invalid_spend, 500);
  assert.equal(quality.invalid[0].name, 'Legacy');
});
test('old saved funnel grouping remains ad name and rejects unsupported category configuration', () => {
  const { group_by, cep_keys, funnel_keys, naming_status, ...legacy } = legacyFunnel();
  assert.equal(validateFunnel(legacy).group_by, 'ad_name');
  assert.throws(() => validateFunnel({ ...legacyFunnel(), cep_keys: ['unknown'] }));
  assert.throws(() => validateFunnel({ ...legacyFunnel(), group_by: '__proto__' }));
});
test('creative diagnosis does not call tiny video events on image ads a weakening hook', () => {
  const rows = [fact('2026-10-01', { impressions: 1000, video_3s: 2, thruplay: 1 }), fact('2026-10-02', { impressions: 1000, video_3s: 1 })];
  let [group] = compareGroups(rows, legacyFunnel(), '2026-10-02', '2026-10-02');
  assert.doesNotMatch(diagnose(group).join(' '), /Hook video|Retensi video/);
  rows[0].metrics.video_3s = 500; rows[1].metrics.video_3s = 200;
  [group] = compareGroups(rows, legacyFunnel(), '2026-10-02', '2026-10-02');
  assert.match(diagnose(group).join(' '), /Hook video/);
});
