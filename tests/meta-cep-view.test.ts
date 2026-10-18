import test from 'node:test';
import assert from 'node:assert/strict';
import { adGroup, defaultFunnel, emptyTotals, metricValue, type AdFact } from '../lib/meta-funnel-domain';
import { buildCepView, cepCostDiagnosis, cepFunnelMetric, cepHeat, cepHighlights, cepProgressMetrics, cepResultMetric, parseCepKey } from '../lib/meta-cep-view';
import type { ReportGroup } from '../lib/meta-funnel-templates';

const totals = (patch: Partial<ReturnType<typeof emptyTotals>>) => ({ ...emptyTotals(), ...patch });
const cell = (cep: string, intention: string, current: Partial<ReturnType<typeof emptyTotals>>, previous: Partial<ReturnType<typeof emptyTotals>> = current, ads = 2): ReportGroup => ({
  key: `cep:${cep}:${intention}`, name: `cep:${cep}:${intention}`, current: totals(current), previous: totals(previous), ad_ids: Array.from({ length: ads }, (_, i) => String(i)), accounts: ['A'], ad_names: [], landing_page_urls: [], verified_ad_ids: [],
});
const groups = [
  cell('skin', 'disc', { spend: 3000, impressions: 150000, outbound_clicks: 3300, lpv: 2400, atc: 200, purchases: 20 }),
  cell('skin', 'conv', { spend: 4000, impressions: 100000, outbound_clicks: 2000, lpv: 1500, atc: 300, purchases: 40 }),
  cell('joint', 'disc', { spend: 2500, impressions: 160000, outbound_clicks: 2400, lpv: 1700, atc: 90, purchases: 8 }, { spend: 2400, impressions: 150000, outbound_clicks: 3300, lpv: 2400, atc: 120, purchases: 12 }),
  cell('joint', 'conv', { spend: 5000, impressions: 120000, outbound_clicks: 1900, lpv: 1300, atc: 150, purchases: 16 }),
  cell('hair', 'cons', { spend: 900, impressions: 30000, outbound_clicks: 900, lpv: 700, atc: 90, purchases: 9 }),
  cell('nail', 'disc', { spend: 600, impressions: 20000, outbound_clicks: 700, lpv: 500, atc: 60, purchases: 6 }),
  cell('__unknown__', '__unknown__', { spend: 5000, impressions: 100000, outbound_clicks: 1500, purchases: 10 }),
];
const summary = groups.reduce((s, g) => { for (const k of Object.keys(s) as (keyof typeof s)[]) (s as any)[k] = ((s as any)[k] ?? 0) + ((g.current as any)[k] ?? 0); return s; }, emptyTotals());

test('cep_intention grouping mirrors the migration key, including unknown values', () => {
  const config = { ...defaultFunnel(), group_by: 'cep_intention' as const };
  const row = { account_id: 'act_1', account_name: 'A', ad_id: '1', ad_name: '[kulit][conv] X', metric_date: '2026-10-01', currency: 'IDR', metrics: emptyTotals(), cep_key: 'skin', intention_key: 'conv' } as AdFact;
  assert.deepEqual(adGroup(row, config), { key: 'cep:skin:conv', name: 'cep:skin:conv' });
  assert.equal(adGroup({ ...row, cep_key: null, intention_key: null }, config).key, 'cep:__unknown__:__unknown__');
  assert.deepEqual(parseCepKey('cep:skin:conv'), { cep: 'skin', intention: 'conv' });
  assert.equal(parseCepKey('landing:https://x'), null);
});
test('the matrix orders intentions discovery → consideration → conversion, puts unmapped last, and sums rows from cells', () => {
  const view = buildCepView(groups, 'website', summary, summary);
  assert.deepEqual(view.columns.map(c => c.intention), ['disc', 'cons', 'conv', '__unknown__']);
  assert.deepEqual(view.rows.map(r => r.cep), ['joint', 'skin', 'hair', 'nail', '__unknown__']);
  assert.equal(view.rows[0].label, 'Sendi'); assert.equal(view.rows.at(-1)?.label, 'Belum terpetakan');
  assert.equal(view.rows[0].current.spend, 7500); assert.equal(view.rows[0].ads, 4);
  assert.equal(view.rows[1].cells.conv?.current.purchases, 40); assert.equal(view.rows[1].cells.cons, undefined);
  assert.ok(Math.abs(view.rows.reduce((s, r) => s + r.spendShare, 0) - 1) < 1e-9);
  assert.ok(Math.abs(view.unknownShare - 5000 / 21000) < 1e-9);
  assert.equal(view.mapped, 4);
  assert.equal(view.resultMetric.id, 'cpp');
  assert.equal(view.medians.cpp, (100 + 7000 / 60) / 2, 'median of joint 312.5, skin 116.7, hair 100, nail 100');
});
test('the CEP lens lists response metrics plus the result cost, never a funnel ratio; CPL when leads dominate', () => {
  const cpp = cepResultMetric('website', totals({ purchases: 10, leads: 2 })), cpl = cepResultMetric('website', totals({ purchases: 1, leads: 20 }));
  assert.equal(cpp.id, 'cpp'); assert.equal(cpl.id, 'cpl'); assert.equal(cepResultMetric('cpas', totals({ leads: 99 })).id, 'cpp');
  const view = buildCepView(groups, 'website', summary, summary);
  assert.deepEqual(view.metrics.map(m => m.id), ['cpm', 'outbound_ctr', 'hook_rate', 'lpv_rate', 'cpp']);
  assert.equal(view.funnelMetric.id, 'purchase_per_lpv'); assert.ok('purchase_per_lpv' in view.medians);
  assert.equal(cepFunnelMetric('website', cpl).id, 'lead_per_lpv'); assert.equal(cepFunnelMetric('cpas', cpp).id, 'purchase_per_click');
  assert.deepEqual(cepProgressMetrics('website', cpp).map(m => m.id), ['atc_rate', 'purchase_per_lpv']);
  assert.deepEqual(cepProgressMetrics('cpas', cpp).map(m => m.id), ['purchase_per_click']);
});
test('a costly CEP is attributed to ad response, the funnel, both, or neither', () => {
  const view = buildCepView(groups, 'website', summary, summary);
  const joint = view.rows.find(r => r.cep === 'joint')!;
  const diagnosis = cepCostDiagnosis(view, joint);
  assert.equal(diagnosis.cause, 'both', JSON.stringify(diagnosis));
  assert.match(diagnosis.text, /karena keduanya/);
  const responseOnly = buildCepView([
    cell('a', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 500, lpv: 400, purchases: 20 }),
    cell('b', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
    cell('c', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
  ], 'website', totals({ spend: 3000, purchases: 180 }), totals({}));
  assert.equal(cepCostDiagnosis(responseOnly, responseOnly.rows.find(r => r.cep === 'a')!).cause, 'response');
  const funnelOnly = buildCepView([
    cell('a', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 20 }),
    cell('b', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
    cell('c', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
  ], 'website', totals({ spend: 3000, purchases: 180 }), totals({}));
  assert.equal(cepCostDiagnosis(funnelOnly, funnelOnly.rows.find(r => r.cep === 'a')!).cause, 'funnel');
  assert.equal(cepCostDiagnosis(funnelOnly, funnelOnly.rows.find(r => r.cep === 'b')!).cause, 'unknown');
});
test('heat is a capped signed log ratio against the CEP median with direction applied', () => {
  assert.equal(cepHeat(2, 1, 'higher'), 1); assert.equal(cepHeat(2, 1, 'lower'), -1);
  assert.ok(Math.abs(cepHeat(1.5, 1, 'higher')! - Math.log2(1.5)) < 1e-9);
  assert.equal(cepHeat(8, 1, 'higher'), 1); assert.equal(cepHeat(null, 1, 'higher'), null); assert.equal(cepHeat(1, 0, 'higher'), null);
});
test('WhatsApp conversation results use conversation cost and progress without requiring LPV', () => {
  const summary = totals({ spend: 3000, conversations: 60 });
  const result = cepResultMetric('website', summary);
  assert.equal(result.id, 'cost_per_conversation');
  assert.equal(metricValue(summary, result), 50);
  assert.equal(cepResultMetric('website', totals({ purchases: 70, conversations: 60 })).id, 'cpp');
  assert.equal(cepResultMetric('website', totals({ leads: 80, conversations: 60 })).id, 'cpl');
  assert.equal(cepFunnelMetric('website', result).id, 'conversation_per_click');
  assert.deepEqual(cepProgressMetrics('website', result).map(m => m.id), ['conversation_per_click']);
  const view = buildCepView([
    cell('a', 'disc', { spend: 1000, impressions: 10000, outbound_clicks: 200, conversations: 10 }),
    cell('b', 'disc', { spend: 1000, impressions: 10000, outbound_clicks: 200, conversations: 30 }),
    cell('c', 'disc', { spend: 1000, impressions: 10000, outbound_clicks: 200, conversations: 30 }),
  ], 'website', summary, totals({}));
  assert.equal(cepCostDiagnosis(view, view.rows.find(r => r.cep === 'a')!).cause, 'funnel');
});
test('missing or insufficient funnel observations cannot be called normal or used to rule out a destination problem', () => {
  for (const lpv of [0, 5]) {
    const view = buildCepView([
      cell('a', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 500, lpv, purchases: 10 }),
      cell('b', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
      cell('c', 'disc', { spend: 1000, impressions: 100000, outbound_clicks: 2000, lpv: 1600, purchases: 80 }),
    ], 'website', totals({ spend: 3000, purchases: 170 }), totals({}));
    const diagnosis = cepCostDiagnosis(view, view.rows.find(r => r.cep === 'a')!);
    assert.equal(diagnosis.cause, 'unknown'); assert.equal(diagnosis.funnelGap, null);
    assert.equal(view.medians.purchase_per_lpv, 0.05, 'low-sample CEPs do not distort the benchmark');
    assert.match(diagnosis.text, /belum cukup/);
    assert.doesNotMatch(diagnosis.text, /normal|bukan landing page|lebih mungkin dari CPM/);
  }
});
test('missing response observations or a zero benchmark leave cost attribution undetermined', () => {
  const view = buildCepView(groups, 'website', summary, summary);
  const row = view.rows[0];
  const withoutResponse = { ...row, current: { ...row.current, impressions: 0 } };
  assert.equal(cepCostDiagnosis(view, withoutResponse).cause, 'unknown');
  assert.equal(cepCostDiagnosis(view, withoutResponse).responseGap, null);
  assert.match(cepCostDiagnosis({ ...view, medians: { ...view.medians, purchase_per_lpv: 0 } }, row).text, /belum cukup/);
});
test('CEP highlights flag the costly CEP, the promising CEP, a weakening CEP, and unmapped spend', () => {
  const view = buildCepView(groups, 'website', summary, summary);
  const highlights = cepHighlights(view, 'IDR');
  const byTitle = Object.fromEntries(highlights.map(h => [h.title, h]));
  assert.equal(byTitle['CEP mahal']?.groupKey, 'joint');
  assert.match(byTitle['CEP mahal'].text, /Sendi menyerap 36% spend/);
  assert.match(byTitle['CEP mahal'].text, /karena keduanya|karena respon iklan|karena funnel/);
  assert.equal(byTitle['CEP berpotensi']?.groupKey, 'nail');
  assert.equal(byTitle['Respon CEP melemah']?.groupKey, 'joint');
  assert.equal(byTitle['CEP belum terpetakan']?.severity, 'warn');
  assert.match(byTitle['CEP belum terpetakan'].text, /24% spend/);
  assert.equal(metricValue(view.rows[0].current, view.resultMetric), 7500 / 24);
  const calm = cepHighlights(buildCepView(groups.slice(0, 2), 'website', summary, summary), 'IDR');
  assert.deepEqual(calm, [], 'two cells of one CEP give nothing to compare');
});
