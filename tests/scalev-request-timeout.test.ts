import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createScalevFetch } = require('../lib/scalev-request-budget');
require.cache[require.resolve('../lib/scalev-request-budget')] = { exports: { scalevFetch: createScalevFetch(async () => 0) } } as any;
const { fetchOrderDetail } = require('../lib/scalev-api');

test('ScaleV detail requests include a cancellation signal and propagate timeouts', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    throw new DOMException('Request timed out', 'TimeoutError');
  };
  try {
    await assert.rejects(fetchOrderDetail('test', 'https://api.scalev.id/v2', '123'), { name: 'TimeoutError' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
