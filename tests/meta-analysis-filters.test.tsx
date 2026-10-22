import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analysisFilterOptions, optimizationFilterKey, parseOptimizationFilter, validateAnalysisFilters, type MetaAnalysisFilters } from '../lib/meta-analysis-filters';
import { metaReportQuery } from '../lib/meta-ad-report';
import { defaultFunnel } from '../lib/meta-funnel-domain';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_t, n) => String(n) }) }; };
const { create, act } = require('react-test-renderer');
const { default: Filters, MetaActiveFilters } = require('../components/MetaAnalysisFilters');
const purchase = { objective: 'OUTCOME_SALES', optimization_goal: 'OFFSITE_CONVERSIONS', conversion_event: 'PURCHASE', custom_conversion_id: null };
const key = optimizationFilterKey(purchase);
const selection: MetaAnalysisFilters = { optimization: key, format: 'video', partnership: 'partnership', cep: 'joint' };

test('analysis validation retains independent dimensions, canonicalizes optimization and rejects malformed filters', () => {
  assert.deepEqual(validateAnalysisFilters({ ...selection, optimization: JSON.stringify(Object.values(purchase), null, 2) }), selection);
  assert.deepEqual(parseOptimizationFilter(key), purchase);
  assert.deepEqual(validateAnalysisFilters({ format: 'unknown', partnership: 'unknown' }), { format: 'unknown', partnership: 'unknown' });
  for (const patch of [{ optimization: '{}' }, { optimization: '[null]' }, { optimization: '[null,null,null,12]' }, { optimization: '[null,null,null,"not-an-id"]' },
    { optimization: ['PURCHASE'] }, { optimization: '[null,true,null,null]' }, { format: 'Video' }, { partnership: false }, { partnership: null }, null, []]) {
    assert.throws(() => validateAnalysisFilters(patch as any), /Filter/);
  }
  assert.notEqual(key, optimizationFilterKey({ ...purchase, optimization_goal: 'VALUE' }));
  assert.notEqual(key, optimizationFilterKey({ ...purchase, custom_conversion_id: '123' }));
});
test('all views include every selected filter in the report/cache query without sharing unfiltered cache keys', () => {
  const base = { from: '2026-10-01', to: '2026-10-20', brandId: '1', filters: selection };
  for (const view of ['overview', 'daily', 'trends', 'creatives'] as const) for (const groupBy of ['landing_page', 'ad', 'cep_intention'] as const) {
    const q = metaReportQuery({ ...base, groupBy }, defaultFunnel(), view);
    for (const dimension of Object.keys(selection) as (keyof MetaAnalysisFilters)[]) {
      assert.equal(q.filters[dimension], selection[dimension]);
      assert.notEqual(JSON.stringify(q), JSON.stringify(metaReportQuery({ ...base, groupBy, filters: { ...selection, [dimension]: undefined } }, defaultFunnel(), view)));
    }
  }
});
const options = analysisFilterOptions({ analysisFacets: [
  { dimension: 'optimization', value: '["OUTCOME_SALES", "OFFSITE_CONVERSIONS", "PURCHASE", null]', count: 7 },
  { dimension: 'format', value: 'video', count: 2 }, { dimension: 'format', value: 'image', count: 5 },
  { dimension: 'partnership', value: 'partnership', count: 1 }, { dimension: 'partnership', value: 'non_partnership', count: 5 }, { dimension: 'partnership', value: 'unknown', count: 1 },
], analysisFacetTotals: { optimization: 7, format: 7, partnership: 7 } });
test('analysis options use database distinct counts, canonical keys and keep unknown separate from non-partnership', () => {
  assert.equal(options.optimization.choices[0].value, key);
  assert.equal(options.optimization.choices[0].label, 'Sales · Purchase');
  assert.equal(options.format.total, 7);
  assert.equal(options.partnership.choices.find(c => c.value === 'unknown')?.label, 'Belum diketahui');
  assert.equal(options.partnership.choices.find(c => c.value === 'non_partnership')?.count, 5);
});
test('filter controls combine selections; chips remove one filter or reset all without altering breakdown state', async () => {
  let root: any, value: MetaAnalysisFilters = {}, breakdown = 'format';
  function Probe() {
    const [filters, setFilters] = React.useState<MetaAnalysisFilters>({}); value = filters;
    return <><Filters value={filters} ready analysisReady analysis={options} loading={false} onChange={setFilters}/>
      <MetaActiveFilters value={filters} onChange={setFilters}/><select aria-label="Rincian tabel" value={breakdown} onChange={(e: any) => { breakdown = e.target.value; }}/></>;
  }
  await act(async () => { root = create(<Probe/>); });
  for (const [name, selected] of [['Optimasi', key], ['Format iklan', 'video'], ['Partnership', 'partnership']]) {
    await act(async () => root.root.findByProps({ 'aria-label': 'Filter ' + name }).props.onChange({ target: { value: selected } }));
  }
  assert.deepEqual(value, { optimization: key, format: 'video', partnership: 'partnership' });
  assert.equal(breakdown, 'format');
  await act(async () => root.root.findByProps({ 'aria-label': 'Hapus filter Format iklan' }).props.onClick());
  assert.deepEqual(value, { optimization: key, partnership: 'partnership' });
  await act(async () => root.root.findAllByType('button').find((b: any) => b.children.includes('Reset filter')).props.onClick());
  assert.deepEqual(value, {});
  await act(async () => root.unmount());
});
test('zero-result or unavailable choices preserve selected values and always allow clearing a filter', async () => {
  let root: any, changed: any;
  await act(async () => { root = create(<><Filters value={selection} ready analysisReady analysis={analysisFilterOptions({})} loading={false} onChange={(v: any) => { changed=v; }}/><MetaActiveFilters value={selection} onChange={(v: any) => { changed=v; }}/></>); });
  const optimization = root.root.findByProps({ 'aria-label': 'Filter Optimasi' });
  assert.equal(optimization.props.value, key);
  assert.match(JSON.stringify(optimization.toJSON?.() || root.toJSON()), /Sales · Purchase/);
  await act(async () => root.root.findByProps({ 'aria-label': 'Hapus filter Partnership' }).props.onClick());
  assert.equal(changed.partnership, undefined); assert.equal(changed.optimization, key);
  await act(async () => root.update(<Filters value={selection} ready={false} analysisReady={false} loading onChange={() => {}}/>));
  assert.ok(root.root.findAllByType('select').every((s: any) => s.props.disabled));
  assert.equal(root.root.findByProps({ 'aria-label': 'Filter Optimasi' }).props.value, key);
  await act(async () => root.unmount());
});
