import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLandingPage, creativeLandingPages, landingPageGroup } from '../lib/meta-ad-destinations';
import { compareGroups, defaultFunnel, emptyTotals, evaluateDeclines, metricValue, trend, withLandingPages, type AdFact, type Totals } from '../lib/meta-funnel-domain';

function row(ad: string, urls: string[], metrics: Partial<Totals>, date = '2026-10-02', account = 'act_1'): AdFact {
  return { ad_id: ad, account_id: account, account_name: account, ad_name: `Creative ${ad}`, landing_page_urls: urls,
    currency: 'IDR', metric_date: date, metrics: { ...emptyTotals(), ...metrics } };
}
test('URL normalization removes only tracking and keeps functional parameters, path case and protocol', () => {
  assert.equal(canonicalLandingPage('https://ROOVE.co.id/osteoporosis/?utm_source=meta&fbclid=x#cta'), 'https://roove.co.id/osteoporosis');
  assert.equal(canonicalLandingPage('https://roove.co.id/LP?variant=b&utm_campaign=x&offer=a'), 'https://roove.co.id/LP?offer=a&variant=b');
  assert.notEqual(canonicalLandingPage('https://roove.co.id/LP?offer=a'), canonicalLandingPage('https://roove.co.id/LP?offer=b'));
  assert.notEqual(canonicalLandingPage('http://roove.co.id/LP'), canonicalLandingPage('https://roove.co.id/LP'));
  assert.equal(canonicalLandingPage('https://l.facebook.com/l.php?u=https%3A%2F%2Froove.co.id%2FLP%3Futm_source%3Dmeta'), 'https://roove.co.id/LP');
  for (const invalid of ['javascript:alert(1)', 'https://user:secret@roove.co.id', 'missing', '']) assert.equal(canonicalLandingPage(invalid), null);
});
test('destination extraction supports link, video CTA, carousel, template, and dynamic asset feeds', () => {
  assert.deepEqual(creativeLandingPages({ object_story_spec: { link_data: { link: 'https://roove.co.id/LP?utm_source=a' } } }), ['https://roove.co.id/LP']);
  assert.deepEqual(creativeLandingPages({ object_story_spec: { video_data: { call_to_action: { value: { link: 'https://roove.co.id/Video' } } } } }), ['https://roove.co.id/Video']);
  assert.deepEqual(creativeLandingPages({ object_story_spec: { template_data: { link: 'https://roove.co.id/Template' } } }), ['https://roove.co.id/Template']);
  assert.deepEqual(creativeLandingPages({ object_story_spec: { link_data: { link: 'https://roove.co.id/A', child_attachments: [{ link: 'https://roove.co.id/B' }] } } }), ['https://roove.co.id/A', 'https://roove.co.id/B']);
  assert.deepEqual(creativeLandingPages({ object_url: 'https://facebook.com/a-post', asset_feed_spec: { link_urls: [{ website_url: 'https://roove.co.id/A' }, { website_url: 'https://roove.co.id/A?utm_content=b' }] } }), ['https://roove.co.id/A']);
});
test('landing-page grouping ignores naming categories and aggregates ratios from event totals', () => {
  const rows = [row('1', ['https://roove.co.id/LP?utm_source=a'], { impressions: 100, outbound_clicks: 10, lpv: 8, atc: 4, checkout: 2, purchases: 1, spend: 10 }),
    row('2', ['https://roove.co.id/LP?utm_source=b'], { impressions: 900, outbound_clicks: 15, lpv: 12, atc: 4, checkout: 3, purchases: 1, spend: 90 }, '2026-10-02', 'act_2')];
  const config = { ...defaultFunnel(), cep_keys: ['skin'] as const, naming_status: 'tagged' as const };
  const [group] = compareGroups(rows, { ...config, cep_keys: [...config.cep_keys] }, '2026-10-02', '2026-10-02');
  assert.equal(group.ad_ids.length, 2); assert.equal(group.key, 'landing:https://roove.co.id/LP');
  assert.deepEqual(Object.fromEntries(group.metrics.map(m => [m.id, m.current])), { spent: 100, cpm: 100, outbound_ctr: .025, lpv_rate: .8, atc_rate: .4, ic_rate: .625, purchase_rate: .4, cpic: 20, cpp: 50 });
});
test('purchase ratio uses IC, undefined denominators remain unknown, and budget is absent', () => {
  const config = defaultFunnel(); const total = { ...emptyTotals(), lpv: 100, checkout: 10, purchases: 2 };
  assert.equal(metricValue(total, config.metrics.find(m => m.id === 'purchase_rate')!), .2);
  total.checkout = 0; assert.equal(metricValue(total, config.metrics.find(m => m.id === 'purchase_rate')!), null);
  assert.equal(config.metrics.length, 9); assert.equal(config.metrics.some(m => /budget|utili/i.test(m.id)), false);
});
test('multiple destinations are one separate group and never duplicate spent across URLs', () => {
  const rows = [row('1', ['https://roove.co.id/A', 'https://roove.co.id/B'], { spend: 100 }), row('2', ['https://roove.co.id/B', 'https://roove.co.id/A'], { spend: 50 }), row('3', [], { spend: 20 })];
  const groups = compareGroups(rows, defaultFunnel(), '2026-10-02', '2026-10-02');
  assert.equal(groups.length, 2); assert.equal(groups.reduce((sum, g) => sum + g.current.spend, 0), 170);
  assert.equal(groups.find(g => g.landing_page_urls.length === 2)?.current.spend, 150);
  assert.equal(landingPageGroup(['https://roove.co.id/B', 'https://roove.co.id/A']).key, landingPageGroup(['https://roove.co.id/A', 'https://roove.co.id/B']).key);
});
test('observed daily URLs take precedence over current cache and fallback is scoped by account and ad', () => {
  const rows = [row('1', ['https://roove.co.id/Old'], {}), row('2', [], {}), row('2', [], {}, '2026-10-02', 'act_2')];
  const creatives = [{ account_id: 'act_1', ad_id: '1', landing_page_urls: ['https://roove.co.id/New'] }, { account_id: 'act_1', ad_id: '2', landing_page_urls: ['https://roove.co.id/Cached'] }].map(c => ({ ...c, creative_id: null, name: '', body: null, video_id: null, thumbnail_url: null }));
  const enriched = withLandingPages(rows, creatives);
  assert.deepEqual(enriched.map(r => r.landing_page_urls), [['https://roove.co.id/Old'], ['https://roove.co.id/Cached'], []]);
});
test('verified destinations fill opaque partnership ads and survive an empty metadata refresh', () => {
  const facts = [row('120249986258640542', [], { spend: 100 })];
  const creative = { account_id: 'act_1', ad_id: '120249986258640542', creative_id: '1271310691584066', landing_page_urls: [], name: '', body: null, video_id: null, thumbnail_url: null };
  const verified = [{ account_id: 'act_1', ad_id: creative.ad_id, creative_id: creative.creative_id, landing_page_url: 'https://roove.co.id/osteoporosis' }];
  const enriched = withLandingPages(facts, [creative], verified);
  assert.equal(enriched[0].landing_page_source, 'verified'); assert.deepEqual(enriched[0].landing_page_urls, ['https://roove.co.id/osteoporosis']);
  const [group] = compareGroups(enriched, defaultFunnel(), '2026-10-02', '2026-10-02');
  assert.equal(group.key, 'landing:https://roove.co.id/osteoporosis'); assert.equal(group.current.spend, 100); assert.deepEqual(group.verified_ad_ids, [creative.ad_id]);
});
test('verified URLs never cross account or creative versions, or overwrite observed historical destinations', () => {
  const creative = { account_id: 'act_1', ad_id: '1', creative_id: '11', landing_page_urls: [], name: '', body: null, video_id: null, thumbnail_url: null };
  const verified = [{ account_id: 'act_1', ad_id: '1', creative_id: '11', landing_page_url: 'https://roove.co.id/Verified' }];
  const facts = [row('1', [], {}), row('1', [], {}, '2026-10-02', 'act_2'), { ...row('1', [], {}), creative_id: '10' }, row('1', ['https://roove.co.id/Historical'], {})];
  const enriched = withLandingPages(facts, [creative], verified);
  assert.deepEqual(enriched.map(r => r.landing_page_urls), [['https://roove.co.id/Verified'], [], [], ['https://roove.co.id/Historical']]);
  assert.deepEqual(withLandingPages([facts[0]], [{ ...creative, creative_id: '12' }], verified)[0].landing_page_urls, []);
  // A historical snapshot pinned to the old creative keeps its verified URL.
  const updated = { ...creative, creative_id: '12', landing_page_urls: ['https://roove.co.id/New'] };
  assert.deepEqual(withLandingPages([{ ...facts[0], creative_id: '11' }], [updated], verified)[0].landing_page_urls, ['https://roove.co.id/Verified']);
  assert.deepEqual(withLandingPages([{ ...facts[0], creative_id: '12' }], [updated], verified)[0].landing_page_urls, ['https://roove.co.id/New']);
});
test('daily trend and decline alerts follow the same URL grouping and outbound definition', () => {
  const config = { ...defaultFunnel(), window_days: 1, min_impressions: 0, min_spend: 0 };
  const rows = [row('1', ['https://roove.co.id/LP'], { impressions: 1000, outbound_clicks: 100 }, '2026-10-01'), row('1', ['https://roove.co.id/LP?utm_campaign=b'], { impressions: 1000, outbound_clicks: 50 })];
  const cov = [{ account_id: 'act_1', metric_date: '2026-10-01' }, { account_id: 'act_1', metric_date: '2026-10-02' }];
  const [alert] = evaluateDeclines(rows, cov, config, ['act_1'], '2026-10-02');
  assert.equal(alert.metric_id, 'outbound_ctr'); assert.equal(alert.change, -50); assert.match(alert.insights.join(' '), /Outbound CTR turun/);
  assert.equal(trend(rows, config, '2026-10-01', '2026-10-02', 'day', alert.group_key)[1].metrics.outbound_ctr, .05);
  assert.equal(evaluateDeclines(rows.map(r => ({ ...r, landing_page_urls: [] })), cov, config, ['act_1'], '2026-10-02').length, 0);
});
