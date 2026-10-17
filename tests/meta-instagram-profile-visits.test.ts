import test from 'node:test';
import assert from 'node:assert/strict';
import { AD_INSIGHT_FIELDS, normalizeAdInsight, normalizeInstagramProfileVisits, type RawAdInsight } from '../lib/meta-ad-insights';
import { emptyTotals, metricValue, sumMetricTotals, type FunnelMetric } from '../lib/meta-funnel-domain';
import { templateMainMetric } from '../lib/meta-funnel-templates';
import { createRequire } from 'node:module';
const { fetchVisits, payloadForFacts, chunks, unchangedPart } = createRequire(import.meta.url)('../scripts/ops/backfill-meta-instagram-profile-visits.cjs');
const raw: RawAdInsight = { ad_id: '1', ad_name: 'A', date_start: '2026-10-01', date_stop: '2026-10-01', spend: '120' };
const cost: FunnelMetric = { id: 'cpv', label: 'Cost per profile visit', numerator: 'spend', denominator: 'instagram_profile_visits', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 };
test('profile visits are requested as their own field and omitted values never become zero', () => {
  assert.ok(AD_INSIGHT_FIELDS.split(',').includes('instagram_profile_visits'));
  for (const value of [undefined, null, '', ' ', true, {}, -1, '-3', '1.5', Infinity, 'broken']) assert.equal(normalizeInstagramProfileVisits(value), null);
  for (const value of [0, '0', 37, '37']) assert.equal(normalizeInstagramProfileVisits(value), Number(value));
  assert.equal(normalizeAdInsight(raw).instagram_profile_visits, null);
  assert.equal(normalizeAdInsight({ ...raw, instagram_profile_visits: '0' }).instagram_profile_visits, 0);
  assert.equal(normalizeAdInsight({ ...raw, instagram_profile_visits: '37' }).spend, 120);
});
test('profile sums and costs reject partial coverage and preserve explicit zero', () => {
  assert.equal(sumMetricTotals([]).instagram_profile_visits, 0);
  assert.equal(sumMetricTotals([{ instagram_profile_visits: 5 }, { instagram_profile_visits: 0 }]).instagram_profile_visits, 5);
  const partial = sumMetricTotals([{ spend: 100, instagram_profile_visits: 5 }, { spend: 20 }]);
  assert.equal(partial.spend, 120); assert.equal(partial.instagram_profile_visits, null); assert.equal(metricValue(partial, cost), null);
  assert.equal(metricValue({ ...emptyTotals(), spend: 120, instagram_profile_visits: 20 }, cost), 6);
  assert.equal(metricValue({ ...emptyTotals(), spend: 120, instagram_profile_visits: 0 }, cost), null);
  assert.equal(templateMainMetric({ stages: ['impressions', 'instagram_profile_visits'], metrics: [cost] })?.id, 'cpv');
});
const response = (data: unknown, next?: string) => new Response(JSON.stringify({ data, paging: next ? { next } : undefined }), { headers: { 'facebook-api-version': 'v24.0' } });
const row = (ad = '1', visits?: string) => ({ ad_id: ad, adset_id: '3', date_start: '2026-10-01', date_stop: '2026-10-01', instagram_profile_visits: visits });
test('backfill follows all pages without leaking pagination tokens and scopes missing rows to existing facts', async () => {
  let calls = 0;
  const fetched = await fetchVisits('act_1', '2026-10-01', '2026-10-02', 'secret', async (url: URL) => {
    assert.equal(url.searchParams.has('access_token'), false); return ++calls === 1 ? response([row('1', '0')], 'https://graph.facebook.com/v24.0/next?access_token=secret') : response([row('2', '5')]);
  });
  assert.equal(fetched.calls, 2); assert.equal(fetched.apiVersion, 'v24.0');
  const facts = ['1', '2', '4'].map(ad_id => ({ ad_id, metric_date: '2026-10-01', raw_insights: { adset_id: '3' } }));
  assert.deepEqual(payloadForFacts(facts, fetched.rows).map((r: any) => r.instagram_profile_visits), [0, 5, null]);
  assert.equal(payloadForFacts(facts, fetched.rows).length, 3);
});
test('backfill rejects incomplete pagination, foreign hosts, repeated cursors and duplicate daily rows', async () => {
  let calls = 0;
  await assert.rejects(fetchVisits('act_1', '2026-10-01', '2026-10-02', 'secret', async () => ++calls === 1 ? response([row()], 'https://graph.facebook.com/next') : new Response('{"error":{"code":4}}', { status: 429 })), /Meta API 4/);
  await assert.rejects(fetchVisits('act_1', '2026-10-01', '2026-10-02', 'secret', async () => response([], 'https://example.com/next')), /host/);
  await assert.rejects(fetchVisits('act_1', '2026-10-01', '2026-10-02', 'secret', async () => response([], 'https://graph.facebook.com/next')), /Repeated/);
  await assert.rejects(fetchVisits('act_1', '2026-10-01', '2026-10-02', 'secret', async () => response([row(), row()])), /Duplicate/);
});
test('date chunks cover every day exactly once and conservation ignores only newly patched fields', () => {
  assert.deepEqual(chunks('2026-07-16', '2026-10-16'), [['2026-07-16', '2026-08-15'], ['2026-08-16', '2026-09-15'], ['2026-09-16', '2026-10-16']]);
  const before = { ad_id: '1', updated_at: 'same', metrics: { spend: 10 }, raw_insights: { actions: [1] } };
  const after = { ...before, metrics: { spend: 10, instagram_profile_visits: 5 }, raw_insights: { actions: [1], instagram_profile_visits: 5, ig_profile_visit_observation: {} } };
  assert.equal(unchangedPart(before), unchangedPart(after));
  assert.notEqual(unchangedPart(before), unchangedPart({ ...after, metrics: { ...after.metrics, spend: 11 } }));
});
