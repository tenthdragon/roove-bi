import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { classifyCreativeFormat } from '../lib/meta-creative-format';
import { normalizeCreativeMetadata } from '../lib/meta-ad-insights';
import { assignTemplateSections, creativeFormatGroups, type ReportGroup } from '../lib/meta-funnel-templates';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_t, n) => String(n) }) }; };
const { create, act } = require('react-test-renderer');
const Results = require('../components/MetaTemplateResults').default;

test('classifies provider assets, including carousel video cards, without name/thumbnail guesses', () => {
  for (const [creative, expected] of [
    [{ image_hash: 'hash' }, 'image'],
    [{ object_type: 'PHOTO' }, 'image'],
    [{ object_type: 'VIDEO' }, 'video'],
    [{ object_type: 'SHARE' }, 'unknown'],
    [{ object_story_spec: { link_data: { image_hash: 'hash' } } }, 'image'],
    [{ object_story_spec: { photo_data: { url: 'image' } } }, 'image'],
    [{ video_id: 'video', thumbnail_url: 'cover', image_url: 'cover' }, 'video'],
    [{ object_story_spec: { video_data: { video_id: 'video', image_hash: 'cover' } } }, 'video'],
    [{ object_story_spec: { link_data: { child_attachments: [{ video_id: 'video' }, { image_hash: 'image' }] } } }, 'carousel'],
    [{ asset_feed_spec: { ad_formats: ['CAROUSEL'], images: [{ hash: 'a' }, { hash: 'b' }] } }, 'carousel'],
    [{ asset_feed_spec: { images: [{ hash: 'a' }], videos: [{ video_id: 'b' }] } }, 'mixed'],
    [{ asset_feed_spec: { ad_formats: ['AUTOMATIC_FORMAT'], images: [{ hash: 'a' }] } }, 'mixed'],
    [{ asset_feed_spec: { ad_formats: ['CAROUSEL', 'SINGLE_IMAGE'] } }, 'mixed'],
    [{ asset_feed_spec: { ad_formats: ['SINGLE_IMAGE'], images: [{ hash: 'a' }, { hash: 'b' }] } }, 'image'],
    [{ asset_feed_spec: { videos: [{ video_id: 'a' }] } }, 'video'],
    [{ thumbnail_url: 'cover', name: '[image] marketing name' }, 'unknown'],
    [{ object_story_spec: { link_data: { link: 'https://example.com' } } }, 'unknown'],
    [{ asset_feed_spec: { images: [null], videos: [{}] } }, 'unknown'],
  ] as const) assert.equal(classifyCreativeFormat(creative), expected, JSON.stringify(creative));
  const normalized = normalizeCreativeMetadata('ad', '[image]', { id: 'creative', object_story_spec: { video_data: { video_id: 'v' } } });
  assert.equal(normalized.creative_format, 'video'); assert.equal(normalized.video_id, 'v');
});
const totals = (values: object) => ({ ...emptyTotals(), ...values });
const config = { ...defaultFunnel(), id: 'template', updated_at: '', metrics: [
  { id: 'spend', label: 'Spent', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: true, min_denominator: 0 },
  { id: 'ctr', label: 'CTR', numerator: 'outbound_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 0 },
] } as any;
const g: ReportGroup = { key: 'landing:https://example.com', name: 'https://example.com', ad_ids: ['i1','i2','v'], accounts: ['Account'], ad_names: [], verified_ad_ids: [], landing_page_urls: ['https://example.com'],
 current: totals({ spend: 300, impressions: 1000, outbound_clicks: 190 }), previous: totals({ spend: 150, impressions: 1000, outbound_clicks: 100 }),
 format_breakdown: [
  { format: 'video', ad_ids: ['v'], current: totals({ spend: 100, impressions: 900, outbound_clicks: 90 }), previous: totals({ spend: 50, impressions: 900, outbound_clicks: 90 }) },
  { format: 'image', ad_ids: ['i1','i2'], current: totals({ spend: 200, impressions: 100, outbound_clicks: 100 }), previous: totals({ spend: 100, impressions: 100, outbound_clicks: 10 }) },
 ] };
const section = assignTemplateSections([g], [config], [{ id: 'rule', funnel_id: 'template', match_kind: 'domain', pattern: 'example.com' }]).sections[0];
test('format rows calculate ratios from totals and keep current/prior comparisons separate from parent', () => {
 const children = creativeFormatGroups(section.groups[0], config.metrics);
 assert.deepEqual(children.map(c => c.name), ['Image','Video']);
 assert.equal(section.groups[0].metrics.find(m => m.id === 'ctr')?.current, .19);
 assert.equal(children[0].metrics.find(m => m.id === 'ctr')?.current, 1);
 assert.equal(children[1].metrics.find(m => m.id === 'ctr')?.current, .1);
 assert.equal(children[0].metrics.find(m => m.id === 'spend')?.change, 100);
 assert.equal(children.reduce((n,c) => n+c.current.spend,0), g.current.spend);
 assert.deepEqual(creativeFormatGroups({ ...section.groups[0], format_breakdown: undefined }, config.metrics), []);
});
test('destination children use the same visible columns and stay under their URL when sorting', async () => {
 const second = { ...section.groups[0], key: 'other', name: 'https://other.com', format_breakdown: undefined };
 let root: any;
 await act(async () => { root = create(<Results section={{ ...section, groups: [...section.groups, second] }} world="website" currency="IDR" preferencesReady onOpenGroup={() => {}} />); });
 const tbody = () => root.root.findByType('tbody');
 let rows = tbody().findAllByType('tr');
 assert.equal(rows.length, 4);
 assert.equal(rows[1].findByType('th').findByType('small').children.join(''), '2 ads');
 assert.match(JSON.stringify(rows[1].toJSON?.() || rows[1].findByType('th').children[0].children), /Image/);
 assert.equal(rows[0].findAllByType('td').length, rows[1].findAllByType('td').length + 1);
 const sort = root.root.findAllByType('button').find((b: any) => b.props['aria-label']?.startsWith('Urutkan Tujuan'));
 await act(async () => sort.props.onClick());
 rows=tbody().findAllByType('tr');
 const parent=rows.findIndex((row: any) => row.findAllByType('button').some((b: any) => b.children.join('') === g.name));
 assert.equal(rows[parent+1].findByType('th').children[0].children.join(''), 'Image');
 await act(async () => root.update(<Results section={section} world="website" currency="IDR" preferencesReady preference={{ hidden: ['metric:ctr'], order: ['metric:ctr','metric:spend','funnel'] }} onOpenGroup={() => {}} />));
 const updated=tbody().findAllByType('tr');
 assert.equal(updated[0].findAllByType('td').length, 3);
 assert.equal(updated[0].findAllByType('td').length, updated[1].findAllByType('td').length+1);
 await act(async () => root.unmount());
});

test('latest creative fallback is disclosed under the matching format row', async () => {
 const groups = section.groups.map(g => ({ ...g, format_breakdown: g.format_breakdown?.map(c => ({ ...c, latest_metadata_ad_ids: c.format === 'image' ? ['i1'] : [] })) }));
 let root: any;
 await act(async () => { root = create(<Results section={{ ...section, groups }} world="website" currency="IDR" preferencesReady onOpenGroup={() => {}} />); });
 assert.ok(root.root.findAllByType('small').some((node: any) => node.children.join('') === '1 memakai tipe terbaru'));
 await act(async () => root.unmount());
});
