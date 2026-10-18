import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMappingUnitBatch, buildWorklist, buildWorklistRows, labelOptions } from '../lib/meta-ad-worklist';
import { parseAdMapping, type AdMapping } from '../lib/meta-ad-mapping';

const ad = (id: string, name: string, patch: Partial<AdMapping> = {}): AdMapping => ({
  account_id: 'act_1', ad_id: id, ad_name: name, creative_id: `c${id}`, effective_status: 'ACTIVE', landing_page_urls: ['https://purvu.id/x'],
  auto_mapping: parseAdMapping(name), overrides: {}, source: 'inventory', first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-10-17T00:00:00Z', revision: 1, ad_channel: 'non_cpas', ...patch,
});
const accounts = [{ account_id: 'act_1', account_name: 'Purvu ID' }];
const mappings = [
  ad('1', '[kulit][conv] Serum'),
  ad('2', '[lupa+rawat+sendi][cons] Lutut', { landing_page_urls: [] }),
  ad('3', 'Tanpa bracket', { ad_channel: 'unknown', ad_channel_reason: 'Bukti tujuan belum cukup' }),
  ad('4', '[rambut][disc] Lama', { effective_status: 'PAUSED' }),
  ad('5', '[kuku][conv] CPAS', { landing_page_urls: [], ad_channel: 'cpas' }),
  ad('6', '[tulang][conv] WA', { landing_page_urls: [], overrides: { intention: 'conv' } }),
];
const activity = [
  { account_id: 'act_1', ad_id: '1', spend: 5000, impressions: 50000, last_active: '2026-10-14' },
  { account_id: 'act_1', ad_id: '2', spend: 9000, impressions: 90000, last_active: '2026-10-13' },
  { account_id: 'act_1', ad_id: '3', spend: 1000, impressions: 10000, last_active: '2026-10-10' },
  { account_id: 'act_1', ad_id: '5', spend: 2000, impressions: 20000, last_active: '2026-10-14' },
  { account_id: 'act_1', ad_id: '6', spend: 300, impressions: 3000, last_active: '2026-10-14' },
];
const verified = [{ account_id: 'act_1', ad_id: '2', creative_id: 'c2', landing_page_url: 'https://purvu.id/lutut' }];
const destinations = [{ account_id: 'act_1', ad_id: '6', creative_id: 'c6', classification: null, metadata: { destination_type: 'WHATSAPP', urls: [] } }];

test('rows rank active ads by spend, read verified, WhatsApp and Shopee destinations, and flag only what the report cannot read', () => {
  const rows = buildWorklistRows({ mappings, activity, verified, destinations, accounts });
  assert.deepEqual(rows.map(r => r.ad_id), ['2', '1', '5', '3', '6', '4']);
  const byId = Object.fromEntries(rows.map(r => [r.ad_id, r]));
  assert.deepEqual(byId['1'].issues, []); assert.equal(byId['1'].cep.label, 'Kulit'); assert.equal(byId['1'].cep.recognized, true);
  assert.deepEqual(byId['2'].issues, []); assert.equal(byId['2'].urlSource, 'verified'); assert.equal(byId['2'].cep.recognized, false); assert.equal(byId['2'].cep.label, 'lupa+rawat+sendi');
  assert.deepEqual(byId['3'].issues, ['cep', 'intention', 'channel']);
  assert.equal(byId['4'].active, false); assert.equal(byId['4'].spend, 0);
  assert.equal(byId['5'].urlSource, 'shopee'); assert.deepEqual(byId['5'].issues, []);
  assert.equal(byId['6'].urlSource, 'whatsapp'); assert.equal(byId['6'].intention.manual, true); assert.deepEqual(byId['6'].issues, []);
});
test('the worklist scopes to active ads by default, counts tiles over the scope, and pages the filtered rows', () => {
  const base = { mappings, activity, verified, destinations, accounts };
  const list = buildWorklist({ ...base });
  assert.equal(list.activeAds, 5); assert.equal(list.inactiveAds, 1); assert.equal(list.scopeAds, 5); assert.equal(list.total, 5);
  assert.deepEqual(list.tiles.map(t => [t.issue, t.ads, t.spend]), [['cep', 1, 1000], ['intention', 1, 1000], ['destination', 0, 0], ['channel', 1, 1000]]);
  assert.equal(list.clean, false);
  const withInactive = buildWorklist({ ...base, includeInactive: true });
  assert.equal(withInactive.total, 6); assert.equal(withInactive.rows.at(-1)?.ad_id, '4');
  const cepOnly = buildWorklist({ ...base, issue: 'cep' });
  assert.deepEqual(cepOnly.rows.map(r => r.ad_id), ['3']); assert.equal(cepOnly.tiles[0].ads, 1, 'tiles ignore the issue filter');
  const searched = buildWorklist({ ...base, search: 'lutut' });
  assert.deepEqual(searched.rows.map(r => r.ad_id), ['2'], 'search covers verified URLs');
  const paged = buildWorklist({ ...base, page: 2, pageSize: 2 });
  assert.deepEqual(paged.rows.map(r => r.ad_id), ['5', '3']); assert.equal(paged.total, 5);
  const cpas = buildWorklist({ ...base, channel: 'cpas' });
  assert.deepEqual(cpas.rows.map(r => r.ad_id), ['5']);
  const filtered = buildWorklist({ ...base, filters: { cep: '__unknown__' } });
  assert.deepEqual(filtered.rows.map(r => r.ad_id), ['3']);
  assert.equal(buildWorklist({ ...base, mappings: [mappings[0]], activity: activity.slice(0, 1) }).clean, true);
});
test('new units report how many ads and how much spend still rely on them, and label pickers list known keys first', () => {
  const units = [{ dimension: 'cep', unit_key: 'lupa+rawat+sendi', label: 'lupa+rawat+sendi', review_status: 'new' as const, first_seen_at: '', last_seen_at: '' }, { dimension: 'keyword', unit_key: 'serum', label: 'serum', review_status: 'new' as const, first_seen_at: '', last_seen_at: '' }];
  const list = buildWorklist({ mappings, activity, verified, destinations, accounts, units });
  assert.deepEqual(list.units, [{ dimension: 'cep', unit_key: 'lupa+rawat+sendi', label: 'lupa+rawat+sendi', ads: 1, spend: 9000 }]);
  const options = labelOptions('cep', list.rows, units);
  assert.deepEqual(options.slice(0, 5).map(o => o.value), ['skin', 'joint', 'bone', 'hair', 'nail']);
  assert.ok(options.some(o => o.value === 'lupa+rawat+sendi'));
  assert.deepEqual(labelOptions('intention', []).map(o => o.label), ['Discovery', 'Consideration', 'Conversion']);
});

test('a term with more than 300 ads remains open until the final batch succeeds', async () => {
  const remaining = Array.from({ length: 301 }, (_, i) => String(i)); let confirmations = 0;
  const save = async (ids: string[]) => { assert.ok(ids.length <= 300); for (const id of ids) remaining.splice(remaining.indexOf(id), 1); return { saved: ids.length, failed: [] }; };
  const confirm = async () => { confirmations++; };
  const first = await applyMappingUnitBatch([...remaining], save, confirm);
  assert.equal(first.saved, 300); assert.equal(first.truncated, true); assert.equal(confirmations, 0); assert.equal(remaining.length, 1);
  const last = await applyMappingUnitBatch([...remaining], save, confirm);
  assert.equal(last.saved, 1); assert.equal(last.truncated, false); assert.equal(confirmations, 1); assert.equal(remaining.length, 0);
});
test('partial mapping failures keep the term open and preserve failed ad diagnostics', async () => {
  let confirmed = false;
  const result = await applyMappingUnitBatch(['1', '2'], async () => ({ saved: 1, failed: [{ adId: '2', error: 'Revision changed' }] }), async () => { confirmed = true; });
  assert.equal(confirmed, false); assert.equal(result.saved, 1); assert.deepEqual(result.failed, [{ adId: '2', error: 'Revision changed' }]);
});
test('destination evidence from an older creative cannot clear a worklist issue', () => {
  const changed = ad('7', '[kulit][conv] Changed', { landing_page_urls: [] });
  for (const metadata of [{ urls: ['https://old.example/'], destination_type: 'WEBSITE' }, { urls: [], destination_type: 'WHATSAPP' }]) {
    const hint = { account_id: 'act_1', ad_id: '7', creative_id: 'older', classification: null, metadata };
    const input = { mappings: [changed], activity: [], verified: [], destinations: [hint], accounts };
    const stale = buildWorklistRows(input)[0]; assert.ok(stale.issues.includes('destination')); assert.deepEqual(stale.urls, []);
    const current = buildWorklistRows({ ...input, destinations: [{ ...hint, creative_id: 'c7' }] })[0]; assert.ok(!current.issues.includes('destination'));
  }
});
