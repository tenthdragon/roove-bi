import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMarketplaceIntakeShippingCost,
  resolveMarketplaceIntakeShippingFinancials,
} from '../lib/marketplace-intake-shipping';

test('resolves Shopee shipping as buyer paid plus company discount', () => {
  const shipping = resolveMarketplaceIntakeShippingFinancials({
    rawMeta: { platform: 'shopee' },
    rawRows: [{
      'Ongkos Kirim Dibayar oleh Pembeli': '91.000',
      'Perkiraan Ongkos Kirim': '151.000',
      'Estimasi Potongan Biaya Pengiriman': '60.000',
    }],
  });

  assert.equal(shipping.platform, 'shopee');
  assert.equal(shipping.grossAmount, 151000);
  assert.equal(shipping.buyerAmount, 91000);
  assert.equal(shipping.companyDiscountAmount, 60000);
  assert.equal(shipping.platformDiscountAmount, 0);
});

test('preserves explicit zero buyer shipping for Shopee free-shipping orders', () => {
  const shipping = resolveMarketplaceIntakeShippingFinancials({
    rawMeta: {
      platform: 'shopee',
      shippingCost: 90000,
    },
    rawRows: [{
      'Ongkos Kirim Dibayar oleh Pembeli': '0',
      'Perkiraan Ongkos Kirim': '90.000',
      'Estimasi Potongan Biaya Pengiriman': '90.000',
    }],
  });

  assert.equal(shipping.grossAmount, 90000);
  assert.equal(shipping.buyerAmount, 0);
  assert.equal(shipping.companyDiscountAmount, 90000);
  assert.equal(shipping.companyDiscountPresent, true);
});

test('resolves TikTok shipping by excluding platform subsidy from app gross shipping', () => {
  const shipping = resolveMarketplaceIntakeShippingFinancials({
    rawMeta: { platform: 'tiktok' },
    rawRows: [{
      'Original Shipping Fee': '25.000',
      'Shipping Fee After Discount': '12.500',
      'Shipping Fee Seller Discount': '7.500',
      'Shipping Fee Platform Discount': '5.000',
    }],
  });

  assert.equal(shipping.platform, 'tiktok');
  assert.equal(shipping.originalGrossAmount, 25000);
  assert.equal(shipping.grossAmount, 20000);
  assert.equal(shipping.buyerAmount, 12500);
  assert.equal(shipping.companyDiscountAmount, 7500);
  assert.equal(shipping.platformDiscountAmount, 5000);
});

test('wrapper falls back to generic shipping cost when only legacy raw_meta exists', () => {
  assert.deepEqual(
    resolveMarketplaceIntakeShippingCost({
      shippingCost: 'Rp 56.300',
    }),
    {
      amount: 56300,
      present: true,
      source: 'rawMeta.shippingCost',
    },
  );
});
