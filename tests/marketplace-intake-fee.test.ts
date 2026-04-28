import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMarketplaceIntakeFeeFinancials } from '../lib/marketplace-intake-fee';

test('derives Shopee marketplace fee from buyer paid minus total payment', () => {
  const fee = resolveMarketplaceIntakeFeeFinancials({
    platform: 'shopee',
    orderAmount: 474500,
    buyerPaidAmount: 515000,
    totalPaymentAmount: 474500,
    shippingCost: 2000,
    lines: [
      { lineSubtotal: 515000, quantity: 1 },
    ],
  });

  assert.equal(fee.present, true);
  assert.equal(fee.amount, 40500);
  assert.equal(fee.source, 'shopee.buyer_paid_amount_minus_total_payment_amount');
  assert.equal(fee.shippingPassThroughAmount, 0);
  assert.equal(fee.nonShippingGapAmount, 40500);
});

test('falls back to line subtotal when Shopee buyer paid amount is unavailable', () => {
  const fee = resolveMarketplaceIntakeFeeFinancials({
    platform: 'shopee',
    orderAmount: 474500,
    totalPaymentAmount: 474500,
    lines: [
      { lineSubtotal: 515000, quantity: 1 },
    ],
  });

  assert.equal(fee.present, true);
  assert.equal(fee.amount, 40500);
  assert.equal(fee.source, 'shopee.line_subtotal_minus_total_payment_amount');
});

test('keeps TikTok marketplace fee unresolved when payout is not available from order export', () => {
  const fee = resolveMarketplaceIntakeFeeFinancials({
    platform: 'tiktok',
    orderAmount: 315000,
    shippingCost: 12000,
    lines: [
      { lineSubtotal: 280000, quantity: 1 },
    ],
  });

  assert.equal(fee.present, false);
  assert.equal(fee.amount, null);
  assert.equal(fee.source, 'tiktok.seller_payout_not_available_from_order_export');
  assert.equal(fee.grossGapAmount, 35000);
  assert.equal(fee.nonShippingGapAmount, 0);
});
