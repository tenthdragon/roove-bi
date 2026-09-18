import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOrderDetail } from '../lib/scalev-api';

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
