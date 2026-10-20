import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultFunnel, emptyTotals, type Measure } from '../lib/meta-funnel-domain';
import type { TemplateGroup, TemplateSection } from '../lib/meta-funnel-templates';
import { sortMetaGroups } from '../lib/meta-table-sorting';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const { create, act } = require('react-test-renderer');
const Results = require('../components/MetaTemplateResults').default as typeof import('../components/MetaTemplateResults').default;
function group(name: string, value: number | null, checkout = 100, purchases = 10): TemplateGroup {
  return { key: name, name, current: { ...emptyTotals(), impressions: 1000, checkout, purchases }, previous: emptyTotals(),
    ad_ids: [name], accounts: ['Example'], ad_names: [name], landing_page_urls: [], verified_ad_ids: [],
    metrics: [{ id: 'roas', current: value, previous: null, change: null }] };
}
const stages: Measure[] = ['impressions', 'checkout', 'purchases'];
const groups = [group('Ad 10', 10), group('Ad 2', 2.44, 10, 5), group('Empty', null), group('Tie', 2.44), group('Small', 2.41), group('Zero', 0)];
const names = (rows: TemplateGroup[]) => rows.map(g => g.name);
const config = { ...defaultFunnel(), stages, metrics: [{ id: 'roas', label: 'ROAS', numerator: 'purchase_value' as const, denominator: 'spend' as const, format: 'multiple' as const, direction: 'higher' as const, monitor: true, min_denominator: 0 }] };
const section: TemplateSection = { key: 'example', funnelId: 'example', name: 'Example', kind: 'transaction', config, groups,
  summary: emptyTotals(), previous: emptyTotals(), metrics: [{ id: 'roas', current: 3, previous: null, change: null }], mainMetric: config.metrics[0], mainMedian: 2.44 };

test('numeric sorting uses raw precision, stable ties and zero; missing/non-finite values stay last both ways', () => {
  const before = JSON.stringify(groups);
  assert.deepEqual(names(sortMetaGroups(groups, { key: 'metric:roas', direction: 'descending' }, stages)), ['Ad 10', 'Ad 2', 'Tie', 'Small', 'Zero', 'Empty']);
  assert.deepEqual(names(sortMetaGroups(groups, { key: 'metric:roas', direction: 'ascending' }, stages)), ['Zero', 'Small', 'Ad 2', 'Tie', 'Ad 10', 'Empty']);
  for (const direction of ['ascending', 'descending'] as const) {
    assert.equal(sortMetaGroups([group('NaN', NaN), group('valid', 1), group('Infinity', Infinity)], { key: 'metric:roas', direction }, stages)[0].name, 'valid');
  }
  assert.equal(JSON.stringify(groups), before);
  assert.equal(sortMetaGroups(groups, null, stages), groups);
  assert.deepEqual(names(sortMetaGroups(groups.slice(0, 2), { key: 'name', direction: 'ascending' }, stages)), ['Ad 2', 'Ad 10']);
});

test('Funnel sorting compares the displayed step ratio, and puts zero-denominator rows last', () => {
  const rows = [group('ten of hundred', 1, 100, 10), group('five of ten', 1, 10, 5), group('no checkout', 1, 0, 20)];
  assert.deepEqual(names(sortMetaGroups(rows, { key: 'funnel', stage: 'purchases', direction: 'descending' }, stages)), ['five of ten', 'ten of hundred', 'no checkout']);
  assert.deepEqual(names(sortMetaGroups(rows, { key: 'funnel', stage: 'purchases', direction: 'ascending' }, stages)), ['ten of hundred', 'five of ten', 'no checkout']);
});

test('header clicks toggle direction, preserve totals/drawer group, and reset restores report order', async () => {
  let root: any, opened: TemplateGroup | null = null;
  await act(async () => { root = create(<Results section={section} world="website" currency="IDR" preferencesReady onOpenGroup={g => { opened = g; }} />); });
  const header = (label: string) => root.root.findByType('thead').findAllByType('button').find((n: any) => n.children[0] === label);
  const rows = () => root.root.findByType('tbody').findAllByType('tr').map((row: any) => row.findByType('button').children[0]);
  const total = () => root.root.findByType('tfoot').findAllByType('td')[0].children[0];
  const before = total();
  await act(async () => header('ROAS').props.onClick());
  assert.equal(root.root.findByProps({ 'aria-sort': 'descending' }).type, 'th');
  await act(async () => header('ROAS').props.onClick());
  assert.deepEqual(rows(), ['Zero', 'Small', 'Ad 2', 'Tie', 'Ad 10', 'Empty']);
  await act(async () => root.root.findByType('tbody').findAllByType('button')[0].props.onClick());
  assert.equal(opened, groups[5]); assert.equal(total(), before);
  await act(async () => header('Tujuan').props.onClick());
  assert.equal(rows()[0], 'Ad 2');
  await act(async () => header('Tujuan').props.onClick());
  assert.equal(rows()[0], 'Zero');
  await act(async () => root.root.findAllByType('button').find((n: any) => n.children.includes('Urutan awal')).props.onClick());
  assert.deepEqual(rows(), names(groups));
  assert.equal(root.root.findAllByType('th').filter((n: any) => n.props['aria-sort']).length, 0);
  await act(async () => root.unmount());
});

test('sort stays attached to metric after column reorder, resets when hidden, and supports Funnel selection and CPAS', async () => {
  let root: any;
  const render = (preference?: { order: string[]; hidden: string[] }) => <Results section={section} world="cpas" currency="IDR" preferencesReady preference={preference} onOpenGroup={() => {}} />;
  await act(async () => { root = create(render()); });
  const head = () => root.root.findByType('thead');
  assert.equal(head().findAllByType('button')[0].children[0], 'Ad');
  await act(async () => head().findAllByType('button')[1].props.onClick());
  await act(async () => root.update(render({ order: ['funnel', 'metric:roas'], hidden: [] })));
  assert.equal(root.root.findByProps({ 'aria-sort': 'descending' }).findByType('button').children[0], 'ROAS');
  await act(async () => root.update(render({ order: ['funnel', 'metric:roas'], hidden: ['metric:roas'] })));
  assert.equal(head().findAllByType('th').filter((n: any) => n.props['aria-sort']).length, 0);
  await act(async () => head().findByType('select').props.onChange({ target: { value: 'purchases' } }));
  assert.equal(root.root.findByType('tbody').findAllByType('button')[0].children[0], 'Ad 2');
  assert.equal(root.root.findByProps({ 'aria-sort': 'descending' }).findByType('button').children[0], 'Funnel');
  await act(async () => root.unmount());
});
