import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMarketplaceTrackingFromScalevOrder,
  extractMarketplaceTrackingFromWebhookData,
  normalizeMarketplaceTracking,
} from '../lib/marketplace-tracking';

test('normalizes marketplace tracking values into uppercase alphanumerics', () => {
  assert.equal(normalizeMarketplaceTracking('SPXID-123 456 789'), 'SPXID123456789');
  assert.equal(normalizeMarketplaceTracking('  jp-001/abc  '), 'JP001ABC');
  assert.equal(normalizeMarketplaceTracking(''), null);
});

test('extracts marketplace tracking from webhook payload aliases', () => {
  assert.equal(
    extractMarketplaceTrackingFromWebhookData({ shipment_receipt: 'spxid-123 456 789' }),
    'SPXID123456789',
  );
  assert.equal(
    extractMarketplaceTrackingFromWebhookData({ destination_address: { tracking_number: 'jnt-001-abc' } }),
    'JNT001ABC',
  );
});

test('prefers formal marketplace tracking column before raw_data fallback', () => {
  assert.equal(
    extractMarketplaceTrackingFromScalevOrder({
      marketplace_tracking_number: 'spxid123',
      raw_data: { tracking_number: 'should-not-win' },
    }),
    'SPXID123',
  );

  assert.equal(
    extractMarketplaceTrackingFromScalevOrder({
      marketplace_tracking_number: null,
      raw_data: {
        projection_rows: [{ tracking_number: 'jnt-777-xyz' }],
      },
    }),
    'JNT777XYZ',
  );
});
