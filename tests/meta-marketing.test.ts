import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMetaAdAccountDiscoveryTargets,
  getMetaTokenHealthWarning,
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
