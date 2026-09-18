import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAccountInsights } from '../lib/meta-marketing';

test('failed pagination rejects the snapshot instead of replacing spend with partial data', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ data: [{ spend: '10' }], paging: { next: 'https://graph.facebook.com/next' } }))
      : new Response('{}', { status: 429 });
  };
  try {
    await assert.rejects(fetchAccountInsights('act_test', '2026-09-18', '2026-09-18', 'test'), /pagination failed/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
