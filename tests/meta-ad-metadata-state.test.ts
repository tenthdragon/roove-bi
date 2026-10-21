import test from 'node:test';
import assert from 'node:assert/strict';
import { metaMetadataSource, metadataRefreshDecision } from '../lib/meta-ad-metadata-state';
const ad = { id: '10', updated_time: '2026-10-16T00:00:00Z', creative: { id: '20' }, adset_id: '30',
  adset: { id: '30', updated_time: '2026-10-16T00:00:00Z', destination_type: 'WHATSAPP', promoted_object: { page_id: '1', whatsapp_phone_number: '+628123456789' } } };
const creative = { creative_format: 'video', ad_id: '10', creative_id: '20', updated_at: '2026-10-17T10:00:00Z' };
const destination = { ad_id: '10', creative_id: '20', adset_id: '30', observed_at: '2026-10-17T10:00:00Z', metadata: { contact_identity: { version: 1 } } };
test('metadata fingerprint detects creative, ad-set destination, phone and provider timestamp changes', () => {
  const base = metaMetadataSource(ad);
  for (const patch of [{ creative: { id: '21' } }, { updated_time: '2026-10-17T00:00:00Z' },
    { adset: { ...ad.adset, id: '31' } }, { adset: { ...ad.adset, promoted_object: { ...ad.adset.promoted_object, whatsapp_phone_number: '+628999999999' } } },
    { adset: { ...ad.adset, updated_time: '2026-10-17T00:00:00Z' } }]) assert.notEqual(metaMetadataSource({ ...ad, ...patch }).source_fingerprint, base.source_fingerprint);
  assert.equal(metaMetadataSource({ ...ad, name: 'new name only', adset: { ...ad.adset, promoted_object: { whatsapp_phone_number: '+628123456789', page_id: '1' } } }).source_fingerprint, base.source_fingerprint);
});
test('existing successful caches are adopted once; identical later versions skip provider metadata calls', () => {
  const source = metaMetadataSource(ad), state = { ad_id: '10', ...source, observed_at: '2026-10-17T10:01:00Z' };
  assert.equal(metadataRefreshDecision(source, undefined, creative, destination), 'adopt');
  assert.equal(metadataRefreshDecision(source, state, creative, destination), 'cached');
  assert.equal(metadataRefreshDecision(metaMetadataSource({ ...ad, updated_time: '2026-10-17T00:00:00Z' }), state, creative, destination), 'refresh');
});
test('missing, older, wrong-identity and incomplete caches cannot certify unchanged metadata', () => {
  const source = metaMetadataSource(ad);
  for (const [c, d] of [[undefined, destination], [creative, undefined], [{ ...creative, creative_id: '21' }, destination],
    [creative, { ...destination, adset_id: '31' }], [{ ...creative, updated_at: '2026-10-15T00:00:00Z' }, destination],
    [creative, { ...destination, metadata: {} }]] as const) assert.equal(metadataRefreshDecision(source, undefined, c, d), 'refresh');
  assert.equal(metadataRefreshDecision(metaMetadataSource({ ...ad, updated_time: undefined }), undefined, creative, destination), 'refresh');
  assert.equal(metadataRefreshDecision(source, undefined, creative, { ...destination, metadata: { contact_identity_checked: true } }), 'adopt', 'A successful read that found no contact identity is still cacheable');
});

test('unclassified legacy creatives refresh once; inspected unknown formats are cacheable', () => {
  const source = metaMetadataSource(ad), state = { ad_id: '10', ...source, observed_at: '2026-10-17T10:01:00Z' };
  assert.equal(metadataRefreshDecision(source, state, { ...creative, creative_format: null }, destination), 'refresh');
  assert.equal(metadataRefreshDecision(source, state, { ...creative, creative_format: 'unknown' }, destination, Date.parse(creative.updated_at) + 60_000), 'cached');
});

test('unknown formats retry after one day while known unchanged formats remain cached', () => {
  const source = metaMetadataSource(ad), state = { ad_id: '10', ...source, observed_at: creative.updated_at };
  const now = Date.parse(creative.updated_at) + 86_400_000;
  assert.equal(metadataRefreshDecision(source, state, { ...creative, creative_format: 'unknown' }, destination, now), 'refresh');
  assert.equal(metadataRefreshDecision(source, state, creative, destination, now), 'cached');
});
