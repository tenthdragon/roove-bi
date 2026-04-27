import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countDaysInclusive,
  mergeShippingFeeRows,
  splitIsoDateRange,
} from '../lib/shipping-fee-data';

test('counts inclusive day spans correctly', () => {
  assert.equal(countDaysInclusive('2026-04-01', '2026-04-01'), 1);
  assert.equal(countDaysInclusive('2026-04-01', '2026-04-07'), 7);
  assert.equal(countDaysInclusive('2026-04-01', '2026-04-26'), 26);
});

test('splits date ranges into non-overlapping fixed-size chunks', () => {
  assert.deepEqual(
    splitIsoDateRange('2026-04-01', '2026-04-15', 7),
    [
      { from: '2026-04-01', to: '2026-04-07' },
      { from: '2026-04-08', to: '2026-04-14' },
      { from: '2026-04-15', to: '2026-04-15' },
    ],
  );
});

test('merges chunked shipping fee rows back into stable grouped totals', () => {
  const merged = mergeShippingFeeRows([
    [
      { date: '2026-04-01', product: 'Alpha', channel: 'Shopee', shipping_charge: 1000 },
      { date: '2026-04-01', product: 'Alpha', channel: 'TikTok Shop', shipping_charge: 500 },
    ],
    [
      { date: '2026-04-01', product: 'Alpha', channel: 'Shopee', shipping_charge: '250' },
      { date: '2026-04-02', product: 'Beta', channel: 'Shopee', shipping_charge: 750 },
    ],
  ]);

  assert.deepEqual(merged, [
    { date: '2026-04-01', product: 'Alpha', channel: 'Shopee', shipping_charge: 1250 },
    { date: '2026-04-01', product: 'Alpha', channel: 'TikTok Shop', shipping_charge: 500 },
    { date: '2026-04-02', product: 'Beta', channel: 'Shopee', shipping_charge: 750 },
  ]);
});
