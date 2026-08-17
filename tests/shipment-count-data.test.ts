import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countShipmentDaysInclusive,
  mergeDailyShipmentCountRows,
  splitShipmentDateRange,
} from '../lib/shipment-count-data';

test('splits shipment ranges into bounded inclusive chunks', () => {
  assert.equal(countShipmentDaysInclusive('2026-08-01', '2026-08-15'), 15);
  assert.deepEqual(
    splitShipmentDateRange('2026-08-01', '2026-08-15', 7),
    [
      { from: '2026-08-01', to: '2026-08-07' },
      { from: '2026-08-08', to: '2026-08-14' },
      { from: '2026-08-15', to: '2026-08-15' },
    ],
  );
});

test('merges duplicate shipment buckets and normalizes nullable dimensions', () => {
  assert.deepEqual(
    mergeDailyShipmentCountRows([
      [
        { date: '2026-08-02', product: 'Roove', channel: 'Shopee', order_count: 3 },
        { date: '2026-08-01', product: null, channel: null, order_count: '2' },
      ],
      [
        { date: '2026-08-02', product: 'Roove', channel: 'Shopee', order_count: '4' },
      ],
    ]),
    [
      { date: '2026-08-01', product: 'Unknown', channel: 'Unknown', order_count: 2 },
      { date: '2026-08-02', product: 'Roove', channel: 'Shopee', order_count: 7 },
    ],
  );
});
