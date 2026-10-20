import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';
import { assignTemplateSections } from '../lib/meta-funnel-templates';
import { isDefaultMetaColumns, metaResultColumns, moveMetaColumn, parseMetaColumnPreference, reconcileMetaColumns, visibleMetaColumns } from '../lib/meta-column-preferences';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const { create, act } = require('react-test-renderer');
const Editor = require('../components/MetaColumnEditor').default as typeof import('../components/MetaColumnEditor').default;
const Results = require('../components/MetaTemplateResults').default as typeof import('../components/MetaTemplateResults').default;
const metrics = defaultFunnel().metrics.slice(0, 3), columns = metaResultColumns(metrics);
const tick = () => new Promise<void>(r => setImmediate(r));
const nodeMock = (element: any) => element.type === 'dialog' ? { showModal() {}, close() {} } : null;

test('saved visibility and order survive template edits; removed columns disappear and new ones are visible', () => {
  const saved = { order: ['metric:gone', 'funnel', 'metric:cpm', 'metric:spent'], hidden: ['metric:spent', 'metric:gone'] };
  const resolved = reconcileMetaColumns(columns, saved);
  assert.deepEqual(resolved, { order: ['funnel', 'metric:cpm', 'metric:spent', 'metric:outbound_ctr'], hidden: ['metric:spent'] });
  assert.deepEqual(visibleMetaColumns(columns, saved).map(c => c.label), ['Funnel', 'CPM', 'CTR (outbound link)']);
  assert.deepEqual(saved.hidden, ['metric:spent', 'metric:gone']);
  assert.equal(isDefaultMetaColumns(columns, reconcileMetaColumns(columns)), true);
  assert.equal(visibleMetaColumns(columns, { order: columns.map(c => c.key), hidden: columns.map(c => c.key) }).length, 1, 'A template edit cannot leave an identity-only table');
  assert.deepEqual(moveMetaColumn(resolved.order, 'funnel', 2), ['metric:cpm', 'metric:spent', 'funnel', 'metric:outbound_ctr']);
});

test('preference input rejects duplicate, malformed, oversized and inconsistent column keys', () => {
  for (const value of [null, {}, { order: ['funnel', 'funnel'], hidden: [] }, { order: ['bad'], hidden: [] },
    { order: ['funnel'], hidden: ['metric:cpm'] }, { order: Array.from({ length: 14 }, (_, i) => `metric:m${i}`), hidden: [] }]) {
    assert.throws(() => parseMetaColumnPreference(value));
  }
  assert.deepEqual(parseMetaColumnPreference({ order: ['funnel'], hidden: [] }), { order: ['funnel'], hidden: [] });
  assert.equal(metaResultColumns([{ ...metrics[0], id: 'funnel' }])[0].key, 'metric:funnel');
});

test('editing is draft-only; cancel discards changes; apply persists the chosen order and visibility', async () => {
  let saved: any = undefined, closed = 0, root: any;
  await act(async () => { root = create(<Editor name="Template A" columns={columns} onSave={async value => { saved = value; }} onClose={() => { closed++; }} />, { createNodeMock: nodeMock }); });
  const button = (label: string) => root.root.findAllByType('button').find((n: any) => n.props['aria-label'] === label || n.children.includes(label));
  await act(async () => root.root.findAllByType('input')[0].props.onChange({ target: { checked: false } }));
  await act(async () => button('Naikkan Funnel').props.onClick());
  assert.equal(saved, undefined);
  await act(async () => button('Batal').props.onClick());
  assert.equal(saved, undefined); assert.equal(closed, 1);
  await act(async () => button('Terapkan').props.onClick());
  assert.deepEqual(saved, { order: ['metric:spent', 'metric:cpm', 'funnel', 'metric:outbound_ctr'], hidden: ['metric:spent'] });
  assert.equal(closed, 2);
  await act(async () => root.unmount());
});

test('drag ordering, reset and failed saves retain a recoverable draft; all-hidden cannot be applied', async () => {
  let root: any, saved: any;
  await act(async () => { root = create(<Editor name="Template" columns={columns} preference={{ order: columns.map(c => c.key).reverse(), hidden: ['funnel'] }}
    onSave={async value => { saved = value; throw new Error('Offline'); }} onClose={() => { throw new Error('Must stay open'); }} />, { createNodeMock: nodeMock }); });
  const button = (label: string) => root.root.findAllByType('button').find((n: any) => n.props['aria-label'] === label || n.children.includes(label));
  const transfer = { effectAllowed: '', setData() {} };
  await act(async () => button('Geser kolom Spent').props.onDragStart({ dataTransfer: transfer }));
  await act(async () => root.root.findAllByType('li')[0].props.onDrop({ preventDefault() {} }));
  assert.equal(root.root.findAllByType('li')[0].findByType('label').children.at(-1), 'Spent');
  await act(async () => button('Reset ke default').props.onClick());
  assert.equal(saved, undefined);
  await act(async () => { button('Terapkan').props.onClick(); await tick(); });
  assert.equal(saved, null); assert.equal(root.root.findByProps({ role: 'alert' }).children[0], 'Offline');
  await act(async () => root.root.findAllByType('input').forEach((n: any) => n.props.onChange({ target: { checked: false } })));
  assert.equal(button('Terapkan').props.disabled, true);
  await act(async () => root.unmount());
});

test('table headers, data and totals share the selected order, with Tujuan pinned and funnel movable', async () => {
  const current = { ...emptyTotals(), spend: 1234, impressions: 1000, outbound_clicks: 100 };
  const funnel = { ...defaultFunnel(), metrics, id: 'template', updated_at: '' };
  const { sections } = assignTemplateSections([{ key: 'group', name: 'https://example.com', current, previous: emptyTotals(), ad_ids: ['1'], accounts: ['Account'], ad_names: ['Ad'], verified_ad_ids: [], landing_page_urls: ['https://example.com'] }],
    [funnel], [{ id: 'rule', funnel_id: 'template', match_kind: 'domain', pattern: 'example.com' }]);
  let root: any;
  await act(async () => { root = create(<Results section={sections[0]} world="website" currency="IDR" preferencesReady
    preference={{ order: ['funnel', 'metric:cpm', 'metric:spent', 'metric:outbound_ctr'], hidden: ['metric:spent', 'metric:outbound_ctr'] }} onOpenGroup={() => {}} />); });
  assert.deepEqual(root.root.findByType('thead').findAllByType('th').map((n: any) => n.findByType('button').children[0]), ['Tujuan', 'Funnel', 'CPM']);
  assert.equal(root.root.findByType('tbody').findAllByType('td').length, 3);
  assert.equal(root.root.findByType('tfoot').findAllByType('td').length, 2);
  const value = root.root.findByType('tbody').findAllByType('td')[2].findAllByType('span')[0].children[0];
  assert.equal(value, root.root.findByType('tfoot').findAllByType('td')[1].children[0]);
  assert.equal(sections[0].summary.spend, 1234); assert.equal(sections[0].config.metrics.length, 3);
  await act(async () => root.unmount());
});
