import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAttributedRevenueAfterAdminFee,
  calculateRoasAfterAdminFee,
  resolveShopeeAdminFeeRate,
} from '../lib/shopee-campaign-metrics';

test('resolves the latest Shopee admin fee assumption effective on a metric date', () => {
  const rates = [
    { effective_from: '2026-05-01', rate: 0.21 },
    { effective_from: '2026-10-01', rate: 0.23 },
  ];

  assert.equal(resolveShopeeAdminFeeRate(rates, '2026-09-09'), 0.21);
  assert.equal(resolveShopeeAdminFeeRate(rates, '2026-10-01'), 0.23);
  assert.equal(resolveShopeeAdminFeeRate(rates, '2026-04-30'), null);
});

test('calculates attributed revenue and ROAS after configured admin fee', () => {
  assert.equal(calculateAttributedRevenueAfterAdminFee(1_000_000, 0.21), 790_000);
  assert.equal(calculateRoasAfterAdminFee(1_000_000, 200_000, 0.21), 3.95);
});

test('does not fabricate adjusted ROAS when no assumption or spend is available', () => {
  assert.equal(calculateRoasAfterAdminFee(1_000_000, 200_000, null), null);
  assert.equal(calculateRoasAfterAdminFee(1_000_000, 0, 0.21), null);
});
