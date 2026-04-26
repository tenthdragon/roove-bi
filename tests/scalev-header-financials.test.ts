import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseScalevHeaderFinancialFields,
  parseScalevMoneyValue,
} from '../lib/scalev-header-financials';

test('parses decimal ScaleV money strings', () => {
  assert.equal(parseScalevMoneyValue('9500.00'), 9500);
  assert.equal(parseScalevMoneyValue('9500'), 9500);
});

test('parses rupiah-formatted ScaleV money strings', () => {
  assert.equal(parseScalevMoneyValue('Rp 9.500'), 9500);
  assert.equal(parseScalevMoneyValue('Rp9.500'), 9500);
});

test('returns null for missing or malformed ScaleV money values', () => {
  assert.equal(parseScalevMoneyValue(null), null);
  assert.equal(parseScalevMoneyValue(undefined), null);
  assert.equal(parseScalevMoneyValue(''), null);
  assert.equal(parseScalevMoneyValue('hello'), null);
});

test('prefers top-level header values over message_variables fallback', () => {
  assert.deepEqual(
    parseScalevHeaderFinancialFields({
      shipping_discount: '9500.00',
      discount_code_discount: '0.00',
      message_variables: {
        shipping_discount: 'Rp 1.000',
        discount_code_discount: 'Rp 2.000',
      },
    }),
    {
      shippingDiscount: 9500,
      shippingDiscountPresent: true,
      discountCodeDiscount: 0,
      discountCodeDiscountPresent: true,
    },
  );
});

test('falls back to message_variables when top-level fields are absent', () => {
  assert.deepEqual(
    parseScalevHeaderFinancialFields({
      message_variables: {
        shipping_discount: 'Rp 9.500',
        discount_code_discount: 'Rp 0',
      },
    }),
    {
      shippingDiscount: 9500,
      shippingDiscountPresent: true,
      discountCodeDiscount: 0,
      discountCodeDiscountPresent: true,
    },
  );
});

test('tracks missing fields without defaulting them to zero', () => {
  assert.deepEqual(
    parseScalevHeaderFinancialFields({
      message_variables: {},
    }),
    {
      shippingDiscount: null,
      shippingDiscountPresent: false,
      discountCodeDiscount: null,
      discountCodeDiscountPresent: false,
    },
  );
});
