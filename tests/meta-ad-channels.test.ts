import test from 'node:test';
import assert from 'node:assert/strict';
import { META_AD_CHANNELS, metaAdChannelCounts, metaAdChannelLabel, validateMetaAdChannel } from '../lib/meta-ad-channels';
import { metaReportBrandSections, metaReportQuery, type RawMetaReport } from '../lib/meta-ad-report';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';

test('web channel scope defaults to non-CPAS and rejects aggregate or malformed scopes', () => {
  assert.equal(validateMetaAdChannel(), 'non_cpas');
  for (const channel of META_AD_CHANNELS) assert.equal(validateMetaAdChannel(channel), channel);
  for (const value of ['all', '', null, {}, ['cpas'], 1]) assert.throws(() => validateMetaAdChannel(value), /Jenis iklan/);
  assert.deepEqual(META_AD_CHANNELS.map(metaAdChannelLabel), ['Non-CPAS','CPAS','Perlu verifikasi']);
  assert.deepEqual(metaAdChannelCounts({ cpas: 10 }), { non_cpas: 0, cpas: 10, unknown: 0 });
});
test('every cached view has a distinct channel scope and preserves brand and dimensions', () => {
  const input = { from: '2026-10-01', to: '2026-10-02', brandId: '1', filters: { cep: 'joint' }, groupKey: 'landing:unknown' };
  for (const view of ['overview','daily','trends','creatives'] as const) {
    const queries = META_AD_CHANNELS.map(channel => metaReportQuery({ ...input, channel }, defaultFunnel(), view));
    assert.equal(new Set(queries.map(q => JSON.stringify(q))).size, 3);
    for (const q of queries) { assert.equal(q.brand, '1'); assert.equal(q.filters.cep, 'joint'); }
  }
  // Integrations without a channel retain the existing RPC behavior.
  assert.equal(metaReportQuery(input, defaultFunnel()).channel, null);
});
test('brand sections fetch only the selected channel before aggregating landing pages', async () => {
  const seen: string[] = [];
  await metaReportBrandSections({ from: '2026-10-01', to: '2026-10-02', channel: 'cpas' }, defaultFunnel(),
    [{ account_id: 'act_1', default_brand_id: 1 }, { account_id: 'act_2', default_brand_id: 2 }],
    [{ id: 1, name: 'Roove' }, { id: 2, name: 'Pluve' }], async query => {
      seen.push(`${query.channel}:${query.brand}`);
      return { currencies: ['IDR'], summary: emptyTotals(), previous: emptyTotals(), groups: [], matchingAds: 0 } as unknown as RawMetaReport;
    });
  assert.deepEqual(seen.sort(), ['cpas:1','cpas:2']);
});
