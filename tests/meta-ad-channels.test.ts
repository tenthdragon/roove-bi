import test from 'node:test';
import assert from 'node:assert/strict';
import { META_AD_CHANNELS, metaAdChannelCounts, metaAdChannelLabel, validateMetaAdChannel } from '../lib/meta-ad-channels';
import { metaReportBrandSections, metaReportCepShares, metaReportQuery, type RawMetaReport } from '../lib/meta-ad-report';
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

test('CEP spend shares combine only the two overview worlds and preserve brand and dimension scope', async () => {
  const seen: string[] = [];
  const shares = await metaReportCepShares({ from: '2026-10-01', to: '2026-10-02', brandId: '1', filters: { intention: 'disc' } }, defaultFunnel(), async query => {
    seen.push(String(query.channel));
    assert.equal(query.groupBy, 'cep_intention');
    assert.equal(query.brand, '1'); assert.equal(query.filters.intention, 'disc');
    // An aggregate query would include 900 of unverified-channel spend.
    const groups = query.channel === 'non_cpas' ? [
      { key: 'cep:skin:disc', current: { spend: 60 } }, { key: 'cep:__unknown__:disc', current: { spend: 10 } },
    ] : query.channel === 'cpas' ? [{ key: 'cep:skin:disc', current: { spend: 30 } }]
      : [{ key: 'cep:joint:disc', current: { spend: 900 } }];
    return { groups, summary: { ...emptyTotals(), spend: groups.reduce((s, g) => s + g.current.spend, 0) } } as RawMetaReport;
  });
  assert.deepEqual(seen.sort(), ['cpas', 'non_cpas']);
  assert.deepEqual(shares.map(s => [s.cep, s.share]), [['skin', 0.9], ['__unknown__', 0.1]]);
});
test('CEP spend shares decode free-form keys before constructing the original CEP filter value', async () => {
  const shares = await metaReportCepShares({ from: '2026-10-01', to: '2026-10-02' }, defaultFunnel(), async query => ({
    groups: query.channel === 'non_cpas' ? [{ key: 'cep:new%3Acep%25:disc', current: { spend: 100 } }] : [],
    summary: { ...emptyTotals(), spend: query.channel === 'non_cpas' ? 100 : 0 },
  } as unknown as RawMetaReport));
  assert.equal(shares[0].cep, 'new:cep%');
  assert.equal(shares[0].share, 1);
});
