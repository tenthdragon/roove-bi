import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFunnel, emptyTotals, metricValue, type SavedFunnel } from '../lib/meta-funnel-domain';
import { assignTemplateSections, cpasSection, defaultLeadFunnel, matchTemplateRule, median, responseMetrics, suggestTemplate, templateKind, templateMainMetric, validateTemplateRule, type ReportGroup, type TemplateRule } from '../lib/meta-funnel-templates';
import { brandHealth, brandHighlights } from '../lib/meta-ad-highlights';
import { applyMetaTemplateRules, metaTemplateError, type MetaTemplateConfiguration } from '../lib/meta-template-settings';
import { evaluateWorkspaceAlerts } from '../lib/meta-funnel-store';
import { shiftDay } from '../lib/meta-funnel-domain';
import { getTodayWIB } from '../lib/sync-schedule';
import type { SupabaseClient } from '@supabase/supabase-js';

const trx: SavedFunnel = { ...defaultFunnel(), id: 'trx', updated_at: '' };
const lead: SavedFunnel = { ...defaultLeadFunnel(), id: 'lead', updated_at: '' };
const rules: TemplateRule[] = [
  { id: 'r1', funnel_id: 'trx', match_kind: 'domain', pattern: 'purvu.id' },
  { id: 'r2', funnel_id: 'lead', match_kind: 'prefix', pattern: 'https://purvu.id/konsultasi' },
  { id: 'r3', funnel_id: 'trx', match_kind: 'exact', pattern: 'https://purvu.id/konsultasi-promo' },
];
const group = (name: string, current: Partial<ReturnType<typeof emptyTotals>>, previous: Partial<ReturnType<typeof emptyTotals>> = {}, urls = [name]): ReportGroup => ({
  key: `landing:${name}`, name, current: { ...emptyTotals(), ...current }, previous: { ...emptyTotals(), ...previous },
  ad_ids: ['1'], accounts: ['A'], ad_names: ['a'], landing_page_urls: urls, verified_ad_ids: [],
});

test('changing URL assignments recomputes precedence and counts without changing performance or row order', () => {
  const templates: MetaTemplateConfiguration['templates'] = [trx, lead].map(t => ({ ...t, version: 1, kind: templateKind(t), mainMetric: templateMainMetric(t), rules: 0 }));
  const urls = ['https://purvu.id/konsultasi-sendi', 'https://purvu.id/serum'];
  const data = { templates, rules: [] as MetaTemplateConfiguration['rules'], reportVersion: '15',
    landingPages: urls.map((url, i) => ({ key: `landing:${url}`, url, spend: 100 + i, ads: 2 + i, brands: ['Purvu'], accounts: ['RTI'],
      evidence: { purchases: i, leads: 0, conversations: 0 }, rule: null, templateId: null, templateName: null,
      suggestion: suggestTemplate({ purchases: i, leads: 0, conversations: 0 }, templates) })) };
  const assigned = applyMetaTemplateRules(data, rules);
  assert.deepEqual(assigned.landingPages.map(lp => lp.templateId), ['lead', 'trx']);
  assert.deepEqual(assigned.templates.map(t => t.rules), [2, 1]);
  const overridden = applyMetaTemplateRules(assigned, [...rules, { id: 'exact', funnel_id: 'trx', match_kind: 'exact', pattern: urls[0] }]);
  assert.equal(overridden.landingPages[0].templateId, 'trx');
  const removed = applyMetaTemplateRules(overridden, rules);
  assert.equal(removed.landingPages[0].templateId, 'lead', 'Deleting exact rule restores prefix rule');
  assert.deepEqual(removed.landingPages.map(({ key, spend, ads, evidence, accounts, brands }) => ({ key, spend, ads, evidence, accounts, brands })),
    data.landingPages.map(({ key, spend, ads, evidence, accounts, brands }) => ({ key, spend, ads, evidence, accounts, brands })));
  assert.equal(removed.reportVersion, '15');
  assert.ok(data.landingPages.every(lp => lp.templateId === null), 'A failed optimistic save can restore the unchanged snapshot');
  const archived = applyMetaTemplateRules(assigned, rules.filter(r => r.funnel_id !== 'lead'), templates.filter(t => t.id !== 'lead'));
  assert.equal(archived.landingPages[0].templateId, 'trx', 'Archiving restores remaining matching rule');
});

test('template errors expose validation or a retry message without leaking production internals', () => {
  assert.match(metaTemplateError(new Error('Gagal memuat performa Meta: canceling statement due to statement timeout'), 'Gagal'), /Server sedang sibuk/);
  assert.equal(metaTemplateError(new Error('URL tidak valid. Gunakan URL lengkap dengan https://'), 'Gagal'), 'URL tidak valid. Gunakan URL lengkap dengan https://');
  for (const secret of ['database credentials: private', 'An error occurred in the Server Components render. digest: 123']) {
    assert.equal(metaTemplateError(new Error(secret), 'Belum berhasil disimpan.'), 'Belum berhasil disimpan.');
  }
});

test('the next incremental sync evaluates a saved template even when attribution lag predates the refreshed day', async () => {
  const today = getTodayWIB(), end = shiftDay(today, -2), start = shiftDay(end, -1);
  const config = { ...defaultFunnel(), alerts_enabled: true, lag_days: 2, window_days: 1, min_impressions: 0, min_spend: 0 };
  const tables: Record<string, unknown[]> = {
    meta_ad_funnels: [{ id: 'trx', config, version: 2, updated_at: new Date().toISOString() }],
    meta_ad_sync_coverage: [start, end].map(metric_date => ({ account_id: 'act_1', metric_date })),
    meta_ad_daily_metrics: [start, end].map((metric_date, i) => ({ account_id: 'act_1', account_name: 'A', ad_id: '1', ad_name: 'Test',
      metric_date, currency: 'IDR', landing_page_urls: ['https://purvu.id/serum'], metrics: { ...emptyTotals(), spend: 100, impressions: 1000, outbound_clicks: i ? 50 : 100 } })),
  };
  const saved: unknown[] = [];
  const svc = { from(table: string) {
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, gte() { return this; }, lte() { return this; },
      range() { return this; }, limit() { return this; },
      upsert(payload: unknown) { saved.push(payload); return Promise.resolve({ error: null }); },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject); } };
    return query;
  } } as unknown as SupabaseClient;
  assert.equal(await evaluateWorkspaceAlerts(svc, 'workspace', ['act_1'], { from: shiftDay(today, -1), to: shiftDay(today, -1) }), 1);
  assert.equal(saved.length, 1);
  saved.length = 0;
  tables.meta_ad_sync_coverage = [];
  assert.equal(await evaluateWorkspaceAlerts(svc, 'workspace', ['act_1'], { from: shiftDay(today, -1), to: shiftDay(today, -1) }), 0, 'Incomplete coverage still blocks alerts');
  assert.equal(saved.length, 0);
});

test('rule validation canonicalizes URLs and domains and rejects junk', () => {
  assert.deepEqual(validateTemplateRule({ match_kind: 'exact', pattern: ' https://Purvu.id/serum/?utm_source=fb#top ' }), { match_kind: 'exact', pattern: 'https://purvu.id/serum' });
  assert.deepEqual(validateTemplateRule({ match_kind: 'domain', pattern: 'https://Purvu.ID/apa' }), { match_kind: 'domain', pattern: 'purvu.id' });
  assert.throws(() => validateTemplateRule({ match_kind: 'exact', pattern: 'purvu.id' }));
  assert.throws(() => validateTemplateRule({ match_kind: 'domain', pattern: 'not a domain' }));
  assert.throws(() => validateTemplateRule({ match_kind: 'regex', pattern: 'x' }));
});
test('matching precedence is exact, then longest prefix, then domain, and tracking params are ignored', () => {
  assert.equal(matchTemplateRule('https://purvu.id/serum-kulit?fbclid=1', rules)?.id, 'r1');
  assert.equal(matchTemplateRule('https://purvu.id/konsultasi-sendi', rules)?.id, 'r2');
  assert.equal(matchTemplateRule('https://purvu.id/konsultasi-promo', rules)?.id, 'r3');
  assert.equal(matchTemplateRule('https://shop.purvu.id/x', rules)?.id, 'r1');
  assert.equal(matchTemplateRule('https://nuvo.co.id/x', rules), null);
  assert.equal(matchTemplateRule('not a url', rules), null);
});
test('template kind and main cost metric follow stages and metrics', () => {
  assert.equal(templateKind(trx), 'transaction'); assert.equal(templateKind(lead), 'lead');
  assert.equal(templateMainMetric(trx)?.id, 'cpp'); assert.equal(templateMainMetric(lead)?.id, 'cpl');
  const custom = { stages: ['impressions', 'view_content'] as const, metrics: [] };
  assert.equal(templateKind({ stages: [...custom.stages], metrics: [] }), 'other');
  assert.equal(templateMainMetric({ stages: [...custom.stages], metrics: [] })?.denominator, 'view_content');
});
test('suggestions come only from unambiguous evidence and never assign', () => {
  assert.equal(suggestTemplate({ purchases: 31, leads: 0, conversations: 0 }, [trx, lead]).funnelId, 'trx');
  assert.equal(suggestTemplate({ purchases: 0, leads: 0, conversations: 12 }, [trx, lead]).funnelId, 'lead');
  assert.equal(suggestTemplate({ purchases: 12, leads: 40, conversations: 0 }, [trx, lead]).funnelId, null);
  assert.equal(suggestTemplate({ purchases: 0, leads: 0, conversations: 0 }, [trx, lead]).funnelId, null);
  assert.match(suggestTemplate({ purchases: 0, leads: 5, conversations: 0 }, [trx]).reason, /belum ada template Lead/);
});
test('sections carry per-template metrics and totals; unassigned keep a reason and suggestion', () => {
  const groups = [
    group('https://purvu.id/serum-kulit', { spend: 1000, impressions: 10000, outbound_clicks: 400, lpv: 300, checkout: 40, purchases: 20 }),
    group('https://purvu.id/konsultasi-sendi', { spend: 500, impressions: 5000, outbound_clicks: 200, lpv: 150, leads: 10 }),
    group('https://nuvo.co.id/promo', { spend: 300, purchases: 0, leads: 9 }),
    group('URL belum terbaca', { spend: 50 }, {}, []),
    group('Beberapa landing page (2 URL)', { spend: 70 }, {}, ['https://purvu.id/a', 'https://purvu.id/b']),
  ];
  const { sections, unassigned } = assignTemplateSections(groups, [trx, lead], rules);
  assert.deepEqual(sections.map(s => [s.name, s.groups.length, s.summary.spend]), [['Landing page performance', 1, 1000], ['Lead WhatsApp', 1, 500]]);
  assert.equal(sections[0].groups[0].metrics.find(m => m.id === 'cpp')?.current, 50);
  assert.equal(sections[1].groups[0].metrics.find(m => m.id === 'cpl')?.current, 50);
  assert.equal(sections[1].groups[0].metrics.some(m => m.id === 'cpp'), false);
  assert.deepEqual(unassigned.map(u => [u.reason, u.suggestion.funnelId]), [['no_rule', 'lead'], ['multi_url', null], ['no_url', null]]);
});
test('CPAS section judges Shopee purchases per ad and the shared response layer differs only in its last metric', () => {
  const section = cpasSection([group('ad A', { spend: 1000, impressions: 20000, outbound_clicks: 300, purchases: 10, purchase_value: 3600 })], { ...emptyTotals(), spend: 1000, purchases: 10, purchase_value: 3600 }, emptyTotals());
  assert.equal(section.groups[0].metrics.find(m => m.id === 'cpp')?.current, 100);
  assert.equal(section.metrics.find(m => m.id === 'roas')?.current, 3.6);
  assert.deepEqual(responseMetrics('website').map(m => m.id), ['cpm', 'outbound_ctr', 'hook_rate', 'lpv_rate']);
  assert.deepEqual(responseMetrics('cpas').map(m => m.id), ['cpm', 'outbound_ctr', 'hook_rate', 'purchase_per_click']);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); assert.equal(median([]), null);
});
test('highlights find the leaking stage, cost outliers, hidden winners, weak response and data notes, ranked by severity and spend', () => {
  const groups = [
    group('https://purvu.id/serum', { spend: 3000, impressions: 30000, outbound_clicks: 900, lpv: 600, atc: 90, checkout: 50, purchases: 30 }, { spend: 2800, impressions: 28000, outbound_clicks: 850, lpv: 580, atc: 85, checkout: 48, purchases: 29 }),
    group('https://purvu.id/rambut', { spend: 2500, impressions: 25000, outbound_clicks: 700, lpv: 450, atc: 40, checkout: 22, purchases: 10 }, { spend: 2400, impressions: 24000, outbound_clicks: 690, lpv: 440, atc: 70, checkout: 36, purchases: 14 }),
    group('https://purvu.id/kuku', { spend: 800, impressions: 8000, outbound_clicks: 250, lpv: 170, atc: 25, checkout: 14, purchases: 12 }, { spend: 700, impressions: 7000, outbound_clicks: 220, lpv: 150, atc: 22, checkout: 12, purchases: 10 }),
  ];
  const { sections, unassigned } = assignTemplateSections(groups, [trx], [{ id: 'd', funnel_id: 'trx', match_kind: 'domain', pattern: 'purvu.id' }]);
  const summary = sections[0].summary, previous = sections[0].previous;
  const highlights = brandHighlights({ world: 'website', sections, summary, previous, currency: 'IDR', unassigned,
    coverageGaps: [{ account_id: 'act_1', currentMissing: 2, baselineMissing: 0 }], missingUrls: 3 });
  const kinds = highlights.map(h => `${h.kind}:${h.severity}:${h.groupKey || ''}`);
  assert.ok(kinds.includes('leak:bad:landing:https://purvu.id/rambut'), kinds.join('\n'));
  assert.ok(kinds.includes('outlier:bad:landing:https://purvu.id/rambut'));
  assert.ok(kinds.includes('winner:good:landing:https://purvu.id/kuku'));
  assert.ok(kinds.filter(k => k.startsWith('data:warn')).length === 2);
  assert.equal(highlights[0].severity, 'bad'); assert.equal(highlights.at(-1)?.severity, 'good');
  assert.equal(brandHealth(highlights), 'bad');
  const leak = highlights.find(h => h.kind === 'leak')!;
  assert.match(leak.text, /Add to cart ÷ Landing page views/);
  const calm = brandHighlights({ world: 'website', sections: [], summary: emptyTotals(), previous: emptyTotals(), currency: 'IDR' });
  assert.deepEqual(calm.map(h => h.kind), ['stable']); assert.equal(brandHealth(calm), 'good');
  const weak = brandHighlights({ world: 'cpas', sections: [], currency: 'IDR', summary: { ...emptyTotals(), spend: 100, impressions: 10000, outbound_clicks: 80 }, previous: { ...emptyTotals(), spend: 100, impressions: 10000, outbound_clicks: 120 } });
  assert.equal(weak[0].kind, 'weak_response'); assert.match(weak[0].text, /CTR outbound turun -33%/);
  assert.equal(metricValue(summary, sections[0].mainMetric!), 6300 / 52);
});
