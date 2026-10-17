import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMetaCpas, type MetaCpasMetadata } from '../lib/meta-cpas-evidence';

const empty: MetaCpasMetadata = {
  urls: [], application_ids: [], android_packages: [], ios_app_ids: [], product_set_ids: [], destination_type: null,
};

test('empty metadata and generic app/catalog signals stay unknown', () => {
  assert.deepEqual(classifyMetaCpas(empty), { classification: 'unknown', evidence: [] });
  assert.equal(classifyMetaCpas({ ...empty, destination_type: 'APP' }).classification, 'unknown');
  assert.equal(classifyMetaCpas({ ...empty, product_set_ids: ['set-1'] }).classification, 'unknown');
  assert.equal(classifyMetaCpas({ ...empty, product_set_ids: ['set-1'] }, ['other-set']).classification, 'unknown');
});

test('exact Shopee app identities classify without URLs', () => {
  for (const metadata of [
    { ...empty, application_ids: ['957549474255294'] },
    { ...empty, android_packages: ['com.shopee.id'] },
    { ...empty, ios_app_ids: ['959841443'] },
  ]) assert.equal(classifyMetaCpas(metadata).classification, 'cpas');
  assert.equal(classifyMetaCpas({ ...empty, application_ids: ['9575494742552940'] }).classification, 'unknown');
  assert.equal(classifyMetaCpas({ ...empty, android_packages: ['com.shopee.id.evil'] }).classification, 'unknown');
  assert.equal(classifyMetaCpas({ ...empty, ios_app_ids: ['9598414430'] }).classification, 'unknown');
});

test('only workspace-verified product sets count as evidence', () => {
  const result = classifyMetaCpas({ ...empty, product_set_ids: ['set-1', 'set-2'] }, ['set-2']);
  assert.deepEqual(result, { classification: 'cpas', evidence: [{ type: 'verified_product_set_id', value: 'set-2' }] });
});

test('verified Shopee catalog is CPAS even with an explicit brand website destination', () => {
  const result = classifyMetaCpas({ ...empty, urls: ['https://roove.co.id/product'], product_set_ids: ['set-1'] }, ['set-1']);
  assert.deepEqual(result, { classification: 'cpas', evidence: [
    { type: 'verified_product_set_id', value: 'set-1' },
  ] });
  assert.equal(classifyMetaCpas({ ...empty, urls: ['https://roove.co.id/product'], product_set_ids: ['set-1'] }).classification, 'unknown');
});

test('an own website alone stays unknown without extra conflict evidence', () => {
  assert.deepEqual(classifyMetaCpas({ ...empty, urls: ['https://roove.co.id/product'] }), { classification: 'unknown', evidence: [] });
});

test('direct Shopee app identity takes precedence over an external website URL', () => {
  const result = classifyMetaCpas({ ...empty, application_ids: ['957549474255294'], urls: ['https://roove.co.id/product'] });
  assert.equal(result.classification, 'cpas');
  assert.deepEqual(result.evidence, [{ type: 'application_id', value: '957549474255294' }]);
});

test('canvas destination with verified product set remains CPAS without a website URL', () => {
  const result = classifyMetaCpas({ ...empty, destination_type: 'CANVAS', product_set_ids: ['set-1'] }, ['set-1']);
  assert.deepEqual(result, { classification: 'cpas', evidence: [{ type: 'verified_product_set_id', value: 'set-1' }] });
});

test('canonical Shopee marketplace and shortlink hosts count, including subdomains', () => {
  const result = classifyMetaCpas({ ...empty, urls: [
    'https://shopee.co.id/product/1?utm_source=meta',
    'https://s.shopee.co.id/product/2',
    'https://go.shp.ee/abc',
  ] });
  assert.equal(result.classification, 'cpas');
  assert.deepEqual(result.evidence.map(item => item.value), [
    'https://shopee.co.id/product/1', 'https://s.shopee.co.id/product/2', 'https://go.shp.ee/abc',
  ]);
});

test('spoofed hostnames and invalid URLs do not count', () => {
  const result = classifyMetaCpas({ ...empty, urls: [
    'https://shopee.co.id.evil.test/item', 'https://evil-shopee.co.id/item',
    'https://shp.ee.evil.test/x', 'https://user@shopee.co.id/item',
    'javascript:alert(1)', 'not a URL',
  ] });
  assert.deepEqual(result, { classification: 'unknown', evidence: [] });
});

test('Facebook wrapper counts only when its canonical target is a Shopee URL', () => {
  assert.equal(classifyMetaCpas({ ...empty, urls: [
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fshopee.co.id%2Fitem%2F1',
  ] }).classification, 'cpas');
  assert.equal(classifyMetaCpas({ ...empty, urls: [
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.test%2Fshopee.co.id',
  ] }).classification, 'unknown');
});

test('any explicit Shopee evidence qualifies even with other destination URLs', () => {
  const result = classifyMetaCpas({ ...empty, urls: ['https://example.test/', 'https://shp.ee/abc'] });
  assert.equal(result.classification, 'cpas');
  assert.equal(result.evidence.length, 1);
});
