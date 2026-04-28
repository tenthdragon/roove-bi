import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackingLookupBounds,
  findWebhookRowByTrackingInRows,
  resolvePromoteExistingSourceBehavior,
} from '../lib/marketplace-intake-app-promote';

test('buildTrackingLookupBounds widens tracking lookup around shipment date', () => {
  assert.deepEqual(
    buildTrackingLookupBounds('2026-04-21'),
    {
      lookupStart: '2026-04-14T00:00:00+07:00',
      lookupEnd: '2026-05-06T00:00:00+07:00',
    },
  );
});

test('findWebhookRowByTrackingInRows matches raw-data tracking with store guard', () => {
  const match = findWebhookRowByTrackingInRows({
    trackingNumber: 'jx-9160 446823',
    storeName: 'Roove Main Store - Marketplace',
    rows: [
      {
        id: 1,
        order_id: '260423MZLERQO',
        external_id: null,
        source: 'webhook',
        business_code: 'RTI',
        scalev_id: null,
        marketplace_tracking_number: null,
        store_name: 'Roove Main Store - Marketplace',
        raw_data: {
          shipment_receipt: 'JX9160446823',
        },
      },
      {
        id: 2,
        order_id: '260423OTHER',
        external_id: null,
        source: 'webhook',
        business_code: 'RTI',
        scalev_id: null,
        marketplace_tracking_number: null,
        store_name: 'Purvu The Secret Store - Markerplace',
        raw_data: {
          shipment_receipt: 'JX0000000000',
        },
      },
    ],
  });

  assert.equal(match?.id, 1);
});

test('findWebhookRowByTrackingInRows rejects duplicate matches for the same tracking number', () => {
  assert.throws(() => {
    findWebhookRowByTrackingInRows({
      trackingNumber: 'SPX123',
      storeName: null,
      rows: [
        {
          id: 1,
          order_id: 'A',
          external_id: null,
          source: 'webhook',
          business_code: 'RTI',
          scalev_id: null,
          marketplace_tracking_number: 'SPX123',
          store_name: 'Store A',
        },
        {
          id: 2,
          order_id: 'B',
          external_id: null,
          source: 'webhook',
          business_code: 'RTI',
          scalev_id: null,
          marketplace_tracking_number: 'SPX123',
          store_name: 'Store B',
        },
      ],
    });
  }, /lebih dari satu webhook row/i);
});

test('resolvePromoteExistingSourceBehavior allows marketplace intake to seed authoritative rows', () => {
  assert.equal(resolvePromoteExistingSourceBehavior(null), 'insert');
  assert.equal(resolvePromoteExistingSourceBehavior(''), 'insert');
  assert.equal(resolvePromoteExistingSourceBehavior('webhook'), 'update');
  assert.equal(resolvePromoteExistingSourceBehavior('marketplace_api_upload'), 'update');
  assert.equal(resolvePromoteExistingSourceBehavior('ops_upload'), 'skip');
});
