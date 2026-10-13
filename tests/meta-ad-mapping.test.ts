import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdMapping, mappingUnit, effectiveMappingValue, type AdMapping } from '../lib/meta-ad-mapping';

test('all six Wulan brackets survive parsing, while actual URL remains independent', () => {
  const name = '[sendi][cons][lupa+rawat+sendi][video][cantik-luar-dalam][Partnership ad wulanarisandhy] – Copy 2';
  const p = parseAdMapping(name);
  assert.equal(p.tags.length, 6); assert.equal(p.tags[0].key, 'joint'); assert.equal(p.tags[0].raw, 'sendi');
  assert.equal(p.tags[1].key, 'cons'); assert.equal(p.tags[2].key, 'lupa+rawat+sendi');
  assert.equal(p.tags[4].dimension, 'bracket_5'); assert.deepEqual(p.issues, []);
  assert.equal('landing_page_urls' in p, false); assert.equal(p.tags[5].raw, 'Partnership ad wulanarisandhy');
});
test('new CEP and intention create usable independent keys without rejecting the ad', () => {
  const p = parseAdMapping('[metabolic][retention][new-creative]');
  assert.deepEqual(p.tags.map(t => t.key), ['metabolic', 'retention', 'new-creative']);
  assert.ok(p.tags.every(t => !t.recognized)); assert.deepEqual(p.issues, []);
});
test('normalization merges case/whitespace variants but retains original tokens and compound values', () => {
  const p = parseAdMapping('  [ SENDI ] [Consideration][Lupa+Rawat+Sendi]');
  assert.equal(p.tags[0].key, 'joint'); assert.equal(p.tags[0].raw, ' SENDI ');
  assert.equal(p.tags[1].key, 'cons'); assert.equal(p.tags[2].key, 'lupa+rawat+sendi');
  assert.equal(mappingUnit('bracket_3', 'é').key, mappingUnit('bracket_3', 'e\u0301').key);
});
test('malformed names keep parseable units and free-text keywords without assigning late brackets to CEP', () => {
  const p = parseAdMapping('Wulan Wulan VIDEO [video] [broken');
  assert.equal(p.tags[0].dimension, 'bracket_1'); assert.ok(p.issues.length);
  assert.deepEqual(p.keywords.map(k => k.key), ['wulan', 'video', 'broken']);
  assert.equal(parseAdMapping('[x[sendi][cons]').tags[0].dimension, 'bracket_1');
  assert.equal(parseAdMapping('[sendi] creative [video]').tags[1].dimension, 'bracket_2');
});
test('empty brackets keep positional meaning and manual values take precedence independently', () => {
  const p = parseAdMapping('[][cons][video]');
  assert.equal(p.tags[0].dimension, 'intention'); assert.equal(p.tags[1].position, 3); assert.ok(p.issues.length);
  const ad = { auto_mapping: parseAdMapping('[sendi][cons] creative'), overrides: { cep: 'bone' } } as AdMapping;
  assert.equal(effectiveMappingValue(ad, 'cep'), 'bone'); assert.equal(effectiveMappingValue(ad, 'intention'), 'cons');
});
