import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMetaAdAccountDiscoveryTargets,
  getMetaTokenHealthWarning,
  selectPurchaseMetric,
} from '../lib/meta-marketing';

test('getMetaAdAccountDiscoveryTargets prefers Business Manager edges when META_BUSINESS_ID is configured', () => {
  assert.deepEqual(getMetaAdAccountDiscoveryTargets('123456789'), [
    {
      edge: '/123456789/owned_ad_accounts',
      label: 'business 123456789 owned ad accounts',
    },
    {
      edge: '/123456789/client_ad_accounts',
      label: 'business 123456789 client ad accounts',
    },
  ]);
});

test('getMetaAdAccountDiscoveryTargets falls back to /me/adaccounts without a business id', () => {
  assert.deepEqual(getMetaAdAccountDiscoveryTargets(null), [
    {
      edge: '/me/adaccounts',
      label: 'current actor ad accounts',
    },
  ]);
});

test('getMetaTokenHealthWarning does not warn for valid non-expiring system user tokens', () => {
  assert.equal(
    getMetaTokenHealthWarning({
      is_valid: true,
      expires_at: 0,
    }),
    null,
  );
});

test('getMetaTokenHealthWarning warns when a valid token is near expiry', () => {
  const warning = getMetaTokenHealthWarning({
    is_valid: true,
    expires_at: Math.floor((Date.UTC(2026, 6, 10, 0, 0, 0)) / 1000),
  }, Date.UTC(2026, 6, 5, 0, 0, 0));

  assert.deepEqual(warning, {
    warning: 'Token expires in 5 day(s). Please refresh it.',
    expires_at: new Date(Date.UTC(2026, 6, 10, 0, 0, 0)),
  });
});

test('selectPurchaseMetric prefers omni purchase without double counting overlapping actions', () => {
  assert.deepEqual(
    selectPurchaseMetric([
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '125000' },
      { action_type: 'omni_purchase', value: '150000' },
    ]),
    { actionType: 'omni_purchase', value: 150000 },
  );
});

test('selectPurchaseMetric falls back to a purchase-like action', () => {
  assert.deepEqual(
    selectPurchaseMetric([{ action_type: 'custom_marketplace_purchase', value: '87500.5' }]),
    { actionType: 'custom_marketplace_purchase', value: 87500.5 },
  );
});

test('selectPurchaseMetric ignores missing and invalid metrics', () => {
  assert.equal(selectPurchaseMetric(undefined), null);
  assert.equal(selectPurchaseMetric([{ action_type: 'omni_purchase', value: 'not-a-number' }]), null);
});
