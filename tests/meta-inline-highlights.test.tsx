import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultFunnel, emptyTotals, type SavedFunnel } from '../lib/meta-funnel-domain';
import { assignTemplateSections, responseMetrics, type ReportGroup } from '../lib/meta-funnel-templates';
import { brandHighlights, type Highlight } from '../lib/meta-ad-highlights';
import { buildCepView, cepHighlights } from '../lib/meta-cep-view';
import { cepGroupKey } from '../lib/meta-cep-key';
import { brandMetricHighlights, cepRowHighlights, destinationHighlights, highlightsForMetric, highlightSymbol, metaDataNotes } from '../lib/meta-inline-highlights';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const { create, act } = require('react-test-renderer');
const Results = require('../components/MetaTemplateResults').default;
const { MetaHighlightValue, MetaDataNotesTrigger } = require('../components/MetaInsightPopover');
const totals = (partial = {}) => ({ ...emptyTotals(), ...partial });
const group = (name: string, spend: number, clicks: number, purchases: number): ReportGroup => ({
  key: name, name: `https://example.com/${name}`, current: totals({ spend, impressions: 10000, outbound_clicks: clicks, lpv: 100, checkout: 50, purchases }),
  previous: totals({ spend, impressions: 10000, outbound_clicks: 200, lpv: 100, checkout: 50, purchases: 25 }),
  ad_ids: [name], ad_names: [name], accounts: ['Account'], landing_page_urls: [`https://example.com/${name}`], verified_ad_ids: [],
});
const config: SavedFunnel = { ...defaultFunnel(), id: 'template', updated_at: '' };
const { sections } = assignTemplateSections([group('expensive', 2000, 20, 10), group('typical', 1000, 200, 20), group('winner', 100, 200, 10)], [config],
  [{ id: 'rule', funnel_id: config.id, match_kind: 'domain', pattern: 'example.com' }]);
const summary = totals({ spend: 3100, impressions: 30000, outbound_clicks: 420, video_3s: 2000 });
const previous = totals({ spend: 3100, impressions: 30000, outbound_clicks: 900, video_3s: 5000 });
const highlights = brandHighlights({ world: 'website', sections, summary, previous, currency: 'IDR', missingUrls: 5,
  coverageGaps: [{ account_id: 'account', currentMissing: 1, baselineMissing: 0 }] });

test('performance rules carry raw formula/comparator evidence while data notes never attach to a metric', () => {
  for (const kind of ['leak', 'outlier', 'winner', 'weak_response']) assert.ok(highlights.some(h => h.kind === kind), kind);
  for (const h of highlights.filter(h => !['data', 'stable'].includes(h.kind))) {
    assert.ok(h.metric); assert.ok(h.comparison); assert.ok(Number.isFinite(h.comparison!.current));
  }
  const leak = highlights.find(h => h.kind === 'leak')!;
  assert.equal(leak.comparison?.basis, 'period'); assert.equal(highlightSymbol(leak), '↘');
  assert.equal(highlights.find(h => h.kind === 'outlier')?.comparison?.basis, 'template_median');
  assert.equal(highlightSymbol(highlights.find(h => h.kind === 'outlier')!), '!');
  assert.equal(highlightSymbol(highlights.find(h => h.kind === 'winner')!), '★');
  assert.ok(highlights.filter(h => h.kind === 'data').every(h => !h.metric && !h.comparison));
});

test('same metric ID with a changed formula cannot inherit an unrelated highlight; renamed formulas still match', () => {
  const ctr = responseMetrics('website').find(m => m.id === 'outbound_ctr')!;
  assert.equal(brandMetricHighlights(highlights, ctr).length, 1);
  assert.equal(brandMetricHighlights(highlights, { ...ctr, numerator: 'purchase_value', denominator: 'spend' }).length, 0);
  assert.equal(brandMetricHighlights(highlights, { ...ctr, id: 'custom', label: 'My CTR' }).length, 1);
  assert.equal(brandMetricHighlights(highlights, { ...ctr, multiplier: 100 }).length, 0);
  const own = destinationHighlights(highlights, config.id, 'expensive');
  assert.equal(highlightsForMetric(own, ctr).length, 2, 'stage decline and brand-average comparison both survive');
  assert.equal(destinationHighlights(highlights, 'other-template', 'expensive').length, 0);
  assert.equal(cepRowHighlights(highlights, 'expensive').length, 0);
});

test('CEP expensive, opportunity and decline evidence stays scoped to the CEP row, never intention cells or URL rows', () => {
  const groups = [group('expensive', 2000, 20, 10), group('typical', 1000, 200, 20), group('winner', 100, 400, 10)]
    .map(g => ({ ...g, key: cepGroupKey(g.key, 'disc') }));
  const view = buildCepView(groups, 'website', summary, previous);
  const insights = cepHighlights(view, 'IDR');
  for (const severity of ['bad', 'good', 'warn']) assert.ok(insights.some(h => h.kind === 'cep' && h.severity === severity));
  for (const h of insights.filter(h => h.kind === 'cep')) {
    assert.ok(h.metric); assert.ok(h.comparison);
    assert.equal(cepRowHighlights([h], h.groupKey!).length, 1);
    assert.equal(destinationHighlights([{ ...h, sectionKey: config.id }], config.id, h.groupKey!).length, 0);
  }
});

test('data note count includes unmapped CEP and additional existing warnings without duplicating missing URLs', () => {
  const cepNote: Highlight = { kind: 'data', severity: 'warn', title: 'CEP belum terpetakan', text: '24%', weight: 0, note: 'unmapped_cep' };
  const input = { highlights: [...highlights, cepNote], destinations: { missing_ads: 5, multi_ads: 2 }, objectiveUnknownAds: 3 };
  const before = JSON.stringify(input);
  const notes = metaDataNotes(input);
  assert.deepEqual(notes.map(n => n.note).sort(), ['coverage', 'missing_url', 'multi_url', 'objective', 'unmapped_cep']);
  assert.equal(JSON.stringify(input), before);
});

test('hidden columns retain every row insight, while unrelated cells and totals have no markers', async () => {
  let root: any;
  const section = sections[0];
  const render = (hidden: string[]) => <Results section={section} world="website" currency="IDR" highlights={highlights} preferencesReady
    preference={{ order: [...section.config.metrics.map(m => `metric:${m.id}`), 'funnel'], hidden }} onOpenGroup={() => {}} />;
  await act(async () => { root = create(render([])); });
  const row = () => root.root.findByType('tbody').findAllByType('tr')[0];
  const rowBadge = () => row().findAllByType(MetaHighlightValue).find((node: any) => node.props.label === 'Sorotan https://example.com/expensive');
  const count = rowBadge().props.highlights.length;
  assert.ok(count >= 3);
  assert.equal(root.root.findByType('tfoot').findAllByType(MetaHighlightValue).length, 0);
  assert.ok(row().findAllByType(MetaHighlightValue).some((n: any) => n.props.highlights.length === 0));
  await act(async () => root.update(render([...section.config.metrics.filter(m => m.id !== 'spent').map(m => `metric:${m.id}`), 'funnel'])));
  assert.equal(rowBadge().props.highlights.length, count);
  assert.equal(row().findAllByType('td').length, 2);
  await act(async () => root.unmount());
});

test('neutral data notes have no warning marker; clicking a warning trigger opens the existing notes panel', async () => {
  let root: any, opened = 0;
  await act(async () => { root = create(<MetaDataNotesTrigger notes={[]} onOpen={() => opened++} />); });
  assert.equal(root.root.findByType('button').children[0], 'Catatan data');
  const notes = metaDataNotes({ highlights, destinations: { missing_ads: 5, multi_ads: 0 }, objectiveUnknownAds: 0 });
  await act(async () => root.update(<MetaDataNotesTrigger notes={notes} onOpen={() => opened++} />));
  const button = root.root.findByType('button');
  assert.equal(button.props['aria-label'], 'Catatan data: 2 jenis masalah');
  await act(async () => button.props.onClick());
  assert.equal(opened, 1);
  await act(async () => root.unmount());
});
