import test from 'node:test';
import assert from 'node:assert/strict';
import { newCepKey, resolveTaxonomy, validateCepSelection, validateIntention, type CepCategory, type TaxonomyRule } from '../lib/meta-ad-taxonomy';
import { parseAdMapping } from '../lib/meta-ad-mapping';
import { CEP_KEYS } from '../lib/meta-ad-naming';
import { metaReportCepShares } from '../lib/meta-ad-report';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';
import { buildCepView } from '../lib/meta-cep-view';
const catalog: CepCategory[] = Object.entries(CEP_KEYS).map(([key, label]) => ({ brand_id: 1, key, label, description: '', revision: 1 }));
const rules: TaxonomyRule[] = [{ brand_id: 1, dimension: 'cep', raw_key: 'sport', cep_keys: ['joint', 'bone'], intention_key: null, revision: 1 }, { brand_id: 1, dimension: 'intention', raw_key: 'educ', cep_keys: [], intention_key: 'cons', revision: 1 }];
test('Roove naming aliases resolve only through its own official catalog', () => {
  assert.deepEqual(resolveTaxonomy(1, parseAdMapping('[sendi][consideration] A'), {}, catalog).cep_keys, ['joint']);
  assert.deepEqual(resolveTaxonomy(2, parseAdMapping('[sendi][cons] A'), {}, catalog).cep_keys, []);
  assert.equal(resolveTaxonomy(2, parseAdMapping('[sendi][cons] A'), {}, catalog).intention_key, 'cons');
});
test('raw creative vocabulary stays evidence and never becomes a category', () => {
  const raw = parseAdMapping('[sport][tripeptide+cepat+diserap] A');const r = resolveTaxonomy(1, raw, {}, catalog);
  assert.deepEqual(r.cep_keys, []);assert.equal(r.intention_key, null);assert.equal(raw.tags[1].raw, 'tripeptide+cepat+diserap');
});
test('approved rules map old and future names to multiple CEPs and one intention', () => {
  for (const name of ['[sport][educ] Old', '[sport][educ] New']) {
    const r = resolveTaxonomy(1, parseAdMapping(name), {}, catalog, rules);assert.deepEqual(r.cep_keys, ['bone', 'joint']);assert.equal(r.intention_key, 'cons');assert.equal(r.cep_source, 'rule');
  }
  assert.deepEqual(resolveTaxonomy(2, parseAdMapping('[sport][educ] Other'), {}, catalog, rules).cep_keys, []);
});
test('manual selections and explicit unmapped decisions survive automatic naming changes', () => {
  for (const name of ['[sport][educ] Old', '[nail][conv] New']) {
    const r = resolveTaxonomy(1, parseAdMapping(name), { ceps: ['skin', 'joint'], intention: 'disc' }, catalog, rules);assert.deepEqual(r.cep_keys, ['joint', 'skin']);assert.equal(r.intention_key, 'disc');assert.equal(r.cep_source, 'manual');
    assert.deepEqual(resolveTaxonomy(1, parseAdMapping(name), { ceps: [] }, catalog, rules).cep_keys, []);
  }
});
test('writes reject another brand category, duplicates and arbitrary intentions', () => {
  assert.deepEqual(validateCepSelection(['skin', 'joint'], 1, catalog), ['joint', 'skin']);
  assert.throws(() => validateCepSelection(['skin', 'skin'], 1, catalog));assert.throws(() => validateCepSelection(['skin'], 2, catalog));
  assert.throws(() => validateIntention('features'));assert.equal(validateIntention('Consideration'), 'cons');
});
test('CEP participation uses the unique brand denominator instead of normalizing overlapping spend', async () => {
  const values = await metaReportCepShares({ from: '2026-10-01', to: '2026-10-17' }, defaultFunnel(), async q => ({ summary: { ...emptyTotals(), spend: q.channel === 'non_cpas' ? 100 : 0 }, groups: q.channel === 'non_cpas' ? ['skin', 'joint'].map(c => ({ key: `cep:${c}:cons`, current: { ...emptyTotals(), spend: 100 } })) : [] }) as any);
  assert.deepEqual(values.map(v => v.share), [1, 1]);
});
test('matrix intention totals stay unique when an ad appears in two CEP cohorts', () => {
  const totals = { ...emptyTotals(), spend: 100 };const groups = ['skin', 'joint'].map(c => ({ key: `cep:${c}:cons`, current: totals, previous: emptyTotals(), ad_ids: ['1'] })) as any;
  const view = buildCepView(groups, 'website', totals, emptyTotals(), { intentionTotals: [{ intention: 'cons', current: totals }], multiCepAds: 1 });
  assert.equal(view.totalSpend, 100);assert.equal(view.rows.reduce((sum, r) => sum + r.current.spend, 0), 200);assert.equal(view.columns.find(c => c.intention === 'cons')?.current.spend, 100);assert.equal(view.overlapAds, 1);
});

test('official zero-delivery CEP rows stay visible without counting as mapped activity', () => {
  const totals = { ...emptyTotals(), spend: 100 };const groups = [{ key: 'cep:skin:cons', current: totals, previous: emptyTotals(), ad_ids: ['1'] }] as any;
  const view = buildCepView(groups, 'website', totals, emptyTotals(), { cepLabels: Object.fromEntries(catalog.map(c => [c.key, c.label])) });
  assert.equal(view.rows.length, 5);assert.equal(view.mapped, 1);assert.equal(view.rows.find(r => r.cep === 'joint')?.current.spend, 0);
});

test('inactive CEPs remain in historical classifications but cannot be newly selected', () => {
  const retired = catalog.map(c => ({ ...c, is_active: c.key !== 'joint' }));
  assert.throws(() => validateCepSelection(['joint'], 1, retired));
  assert.deepEqual(validateCepSelection(['skin', 'joint'], 1, retired, ['joint']), ['joint', 'skin']);
  assert.throws(() => validateCepSelection(['joint'], 2, retired, ['joint']));
  assert.deepEqual(resolveTaxonomy(1, parseAdMapping('[joint][disc] History'), { ceps: ['joint'] }, retired).cep_keys, ['joint']);
  assert.deepEqual(resolveTaxonomy(1, parseAdMapping('[sport][disc] Rule'), {}, retired, rules).cep_keys, ['bone', 'joint']);
});
test('additional CEP identities are stable and brand scoped without limiting Roove to five', () => {
  assert.equal(newCepKey(1, ' Aktivitas Harian '), 'b1.aktivitas-harian');
  assert.notEqual(newCepKey(1, 'Aktivitas'), newCepKey(2, 'Aktivitas'));
  assert.throws(() => newCepKey(1, '---'));
  assert.equal(newCepKey(1, 'a'.repeat(100)).length, 80);
  const key = newCepKey(1, 'Aktivitas');
  assert.deepEqual(resolveTaxonomy(1, parseAdMapping('[aktivitas][disc] New'), {}, [...catalog, { brand_id: 1, key, label: 'Nama diperbarui', description: '', revision: 2 }]).cep_keys, [key]);
});

test('an additional category named Skin does not remap the legacy Skin cohort twice', () => {
  const key = newCepKey(1, 'Skin');
  assert.equal(key, 'b1.cep-skin');
  const expanded = [...catalog, { brand_id: 1, key, label: 'Skin', description: '', revision: 1 }];
  assert.deepEqual(resolveTaxonomy(1, parseAdMapping('[skin][disc] Existing'), {}, expanded).cep_keys, ['skin']);
});
