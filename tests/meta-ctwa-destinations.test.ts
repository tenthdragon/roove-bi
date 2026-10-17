import test from 'node:test';
import assert from 'node:assert/strict';
import { ctwaDestination, ctwaLabel, whatsappDestinationUrl, templateDestinationRule } from '../lib/meta-ctwa-destinations';
import { assignTemplateSections, defaultLeadFunnel, matchDestinationTemplate, validateTemplateRule, type ReportGroup, type TemplateRule } from '../lib/meta-funnel-templates';
import { emptyTotals, type SavedFunnel } from '../lib/meta-funnel-domain';
import { applyMetaTemplateRules } from '../lib/meta-template-settings';

const url = 'https://api.whatsapp.com/send';
const identity = (numbers: string[], page = '123') => ({ contact_identity: { version: 1, creative_id: '1', adset_id: '2', page_id: page,
  page_ids: [page], page_sources: { promoted: page }, whatsapp_phone_numbers: numbers, whatsapp_sources: [] }, destination_type: 'WHATSAPP' });
const dest = (brandId = '1', numbers = ['+628111111111'], accountId = 'act_1', adId = '1') => ctwaDestination({ brandId, accountId, adId, urls: [url], metadata: identity(numbers) })!;

test('CTWA identity separates brands and numbers but merges the same brand and number across accounts', () => {
  assert.equal(dest().key, dest('1', ['+628111111111'], 'act_2', '2').key);
  assert.notEqual(dest().key, dest('2').key);
  assert.notEqual(dest().key, dest('1', ['+628222222222']).key);
  assert.equal(ctwaLabel(dest(), 'Roove'), 'WhatsApp · Roove · +628111111111');
  assert.deepEqual(validateTemplateRule(templateDestinationRule({ key: dest().key, destination: dest(), landing_page_urls: [url] })), { match_kind: 'ctwa', pattern: dest().key });
  assert.throws(() => validateTemplateRule({ match_kind: 'ctwa', pattern: 'ctwa:anything' }));
  assert.throws(() => validateTemplateRule({ match_kind: 'ctwa', pattern: 'ctwa:1:phone:08111111111' }));
});

test('missing numbers isolate Page/account; multiple numbers stay on one ad without inferred allocation', () => {
  const missing = dest('1', []);
  assert.equal(missing.status, 'missing');
  assert.equal(missing.key, 'ctwa:1:missing:act_1:page:123');
  assert.notEqual(missing.key, dest('1', [], 'act_2').key);
  const multiple = dest('1', ['+628111111111', '+628222222222']);
  assert.equal(multiple.phone_number, null); assert.equal(multiple.status, 'multiple');
  assert.notEqual(multiple.key, dest('1', ['+628111111111', '+628222222222'], 'act_1', '2').key);
  assert.equal(ctwaDestination({ brandId: '1', accountId: 'act_1', adId: '1', urls: [url] })?.key, 'ctwa:1:missing:act_1:ad:1');
});

test('only direct WhatsApp destinations are classified; websites, redirect queries and lookalike hosts are excluded', () => {
  for (const value of ['https://roove.co.id/wa', 'https://api.whatsapp.com.evil.test/send?phone=628111111111', 'https://example.com/?next=https://api.whatsapp.com/send', 'https://user@api.whatsapp.com/send']) {
    assert.equal(whatsappDestinationUrl(value).whatsapp, false);
    assert.equal(ctwaDestination({ brandId: '1', accountId: 'act_1', adId: '1', urls: [value] }), null);
  }
  for (const value of ['https://wa.me/628111111111', 'https://api.whatsapp.com/send?text=hi&phone=%2B628111111111', 'https://web.whatsapp.com/send?phone=628111111111']) {
    assert.equal(ctwaDestination({ brandId: '1', accountId: 'act_1', adId: '1', urls: [value] })?.phone_number, '+628111111111');
  }
  assert.equal(ctwaDestination({ brandId: '1', accountId: 'act_1', adId: '1', urls: [], metadata: identity(['+628111111111']) })?.status, 'known');
});

test('two numbers share one template without sharing metrics, and an override affects only its destination', () => {
  const template: SavedFunnel = { ...defaultLeadFunnel(), id: 'lead', updated_at: '' };
  const other = { ...template, id: 'other' };
  const groups: ReportGroup[] = [dest(), dest('1', ['+628222222222']), dest('2')].map((destination, i) => ({
    key: destination.key, name: ctwaLabel(destination), destination, current: { ...emptyTotals(), spend: (i + 1) * 100, conversations: i + 1 }, previous: emptyTotals(),
    ad_ids: [String(i + 1)], ad_names: ['Ad'], accounts: ['Account'], landing_page_urls: [url], verified_ad_ids: [],
  }));
  const rules: TemplateRule[] = groups.map((g, i) => ({ id: String(i), funnel_id: 'lead', match_kind: 'ctwa', pattern: g.key }));
  const result = assignTemplateSections(groups, [template], rules);
  assert.deepEqual(result.sections[0].groups.map(g => g.current.spend), [300, 200, 100]);
  assert.equal(result.sections[0].summary.spend, 600);
  const withOverride = rules.map((r, i) => i === 1 ? { ...r, funnel_id: 'other' } : r);
  assert.deepEqual(groups.map(g => matchDestinationTemplate(g, withOverride)?.funnel_id), ['lead', 'other', 'lead']);
  const templates = [template, other].map(t => ({ ...t, kind: 'lead' as const, mainMetric: null, version: 1, rules: 0 }));
  const settings = { templates, rules: [], landingPages: groups.map(g => ({ ...g, url, evidence: g.current, rule: null, templateId: null, templateName: null, suggestion: { funnelId: null, kind: null, reason: '' } })) };
  const assigned = applyMetaTemplateRules(settings, withOverride);
  assert.deepEqual(assigned.landingPages.map(g => g.templateId), ['lead', 'other', 'lead']);
  assert.deepEqual(assigned.landingPages.map(g => g.current), groups.map(g => g.current));
  assert.equal(matchDestinationTemplate({ destination: dest(), landing_page_urls: [] }, rules)?.funnel_id, 'lead', 'CTWA does not require a website URL');
});

test('legacy URL template can be shared as fallback; an explicit destination assignment takes precedence', () => {
  const generic: TemplateRule = { id: 'url', funnel_id: 'lead', match_kind: 'exact', pattern: url };
  const scoped: TemplateRule = { id: 'number', funnel_id: 'other', match_kind: 'ctwa', pattern: dest().key };
  assert.equal(matchDestinationTemplate({ destination: dest(), landing_page_urls: [url] }, [generic, scoped])?.id, 'number');
  assert.equal(matchDestinationTemplate({ destination: dest('2'), landing_page_urls: [url] }, [generic, scoped])?.id, 'url');
  assert.equal(matchDestinationTemplate({ destination: dest(), landing_page_urls: [url, 'https://wa.me/628111111111'] }, [generic]), null, 'Never choose an arbitrary URL rule');
});

test('sync alerts use the same CTWA destination keys and do not dilute a decline with another number', async () => {
  const { evaluateWorkspaceAlerts } = await import('../lib/meta-funnel-store');
  const { getTodayWIB } = await import('../lib/sync-schedule');
  const { shiftDay } = await import('../lib/meta-funnel-domain');
  const end = shiftDay(getTodayWIB(), -2), start = shiftDay(end, -1);
  const config = { ...defaultLeadFunnel(), window_days: 1, lag_days: 2, min_spend: 0, min_impressions: 0,
    metrics: [{ id: 'cpc', label: 'Biaya / percakapan', numerator: 'spend' as const, denominator: 'conversations' as const, format: 'money' as const, direction: 'lower' as const, monitor: true, min_denominator: 1 }] };
  const tables: Record<string, any[]> = {
    meta_ad_funnels: [{ id: 'lead', config, version: 1, updated_at: '' }],
    meta_ad_accounts: [{ account_id: 'act_1', default_brand_id: 1 }],
    meta_ad_sync_coverage: [start, end].map(metric_date => ({ account_id: 'act_1', metric_date })),
    meta_landing_page_templates: [dest(), dest('1', ['+628222222222'])].map((d, i) => ({ id: String(i), funnel_id: 'lead', match_kind: 'ctwa', pattern: d.key })),
    meta_ad_destination_metadata: ['+628111111111', '+628222222222'].map((n, i) => ({ account_id: 'act_1', ad_id: String(i + 1), creative_id: '1', adset_id: '2', classification: 'unknown', metadata: identity([n]) })),
    meta_ad_daily_metrics: [start, end].flatMap((metric_date, day) => [1, 2].map(ad => ({ account_id: 'act_1', account_name: 'Account', ad_id: String(ad), ad_name: `Ad ${ad}`, creative_id: '1',
      raw_insights: { adset_id: '2' }, metric_date, currency: 'IDR', landing_page_urls: [url], metrics: { ...emptyTotals(), spend: 100, conversations: ad === 1 && day ? 5 : 10 } }))),
  };
  const saved: any[] = [];
  const svc = { from(table: string) { const query = { select() { return this; }, eq() { return this; }, order() { return this; }, gte() { return this; }, lte() { return this; }, range() { return this; }, limit() { return this; },
    upsert(payload: unknown) { saved.push(payload); return Promise.resolve({ error: null }); },
    then(resolve: any, reject: any) { return Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject); } }; return query; } };
  assert.equal(await evaluateWorkspaceAlerts(svc as any, 'workspace', ['act_1']), 1);
  assert.equal(saved[0].group_key, dest().key);
  assert.equal(saved[0].payload.current, 20); assert.equal(saved[0].payload.previous, 10);
  assert.deepEqual(saved[0].payload.suspects.map((s: any) => s.ad_id), ['1']);
  saved.length = 0;
  tables.meta_ad_destination_metadata[0].adset_id = '3';
  assert.equal(await evaluateWorkspaceAlerts(svc as any, 'workspace', ['act_1']), 0, 'A stale adset must not borrow the known phone rule');
});
