import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createScalevFetch, scalevRetryDelay, ScalevThrottleError } from '../lib/scalev-request-budget';

test('Retry-After seconds/date takes precedence; epoch reset is respected without capping the provider cooldown',() => {
  const now = Date.parse('2026-11-10T10:00:00Z');
  assert.equal(scalevRetryDelay(new Response(null,{ headers: { 'Retry-After': '120','X-RateLimit-Reset': String(now/1000 + 300) } }),0,now),120000);
  assert.equal(scalevRetryDelay(new Response(null,{ headers: { 'Retry-After': new Date(now + 70000).toUTCString() } }),0,now),70000);
  assert.equal(scalevRetryDelay(new Response(null,{ status: 429,headers: { 'X-RateLimit-Reset': String(now/1000 + 3600) } }),0,now),3600000);
  assert.equal(scalevRetryDelay(new Response(null,{ status: 500,headers: { 'X-RateLimit-Reset': String(now/1000 + 3600) } }),0,now),1000);
  assert.equal(scalevRetryDelay(new Response(),1,now),2000);
});

test('independent callers share hashed credential slots and stagger starts',async () => {
  let now = 0; const next = new Map<string,number>(), hashes: string[] = [], fetched: number[] = [];
  const budget = async (hash: string,_blocked?: string,check?: boolean) => {
    assert.match(hash,/^[a-f0-9]{64}$/); hashes.push(hash);
    if (check) return 0;
    const slot = Math.max(next.get(hash) || 0,now); next.set(hash,slot + 250); return slot-now;
  };
  const fetcher: typeof fetch = async () => { fetched.push(now); return new Response(); };
  const wait = async (ms: number) => { now += ms; };
  const parser = createScalevFetch(budget,fetcher,wait), worker = createScalevFetch(budget,fetcher,wait);
  await parser('secret','https://api.scalev.id/v3/bundles');
  await worker('secret','https://api.scalev.id/v2/orders');
  await worker('different','https://api.scalev.id/v2/orders');
  assert.deepEqual(fetched,[0,250,250]); assert.equal(hashes[0],hashes[2]); assert.notEqual(hashes[0],hashes[4]);
});

test('a long shared cooldown stops before network access, while API failures never replay a POST',async () => {
  let calls = 0;
  const blocked = createScalevFetch(async () => 60000,async () => { calls++; return new Response(); });
  await assert.rejects(blocked('secret','https://api.scalev.id/v3/bundles'),ScalevThrottleError); assert.equal(calls,0);
  const blocks: string[] = [];
  const post = createScalevFetch(async (_hash,until) => { if (until) blocks.push(until); return 0; },async (_url,init) => {
    calls++; assert.equal(init?.method,'POST'); assert.equal(init?.redirect,'error');
    return new Response('plain text 429',{ status: 429,headers: { 'Retry-After': '120' } });
  });
  const start = Date.now();
  assert.equal((await post('secret','https://api.scalev.id/v3/stores/1/bundle-price-options',{ method: 'POST' })).status,429);
  assert.equal(calls,1); assert.ok(Date.parse(blocks[0]) >= start + 120000);
});

test('a newly announced cooldown invalidates a queued slot and reserves a staggered replacement',async () => {
  const delays = [250,1000,1250,0], calls: boolean[] = [], waited: number[] = [];
  const client = createScalevFetch(async (_hash,_until,check) => { calls.push(!!check); return delays.shift()!; },async () => new Response(),async ms => { waited.push(ms); });
  await client('secret','https://api.scalev.id/v3/bundles');
  assert.deepEqual(calls,[false,true,false,true]); assert.deepEqual(waited,[250,1250]);
});

test('exhausted successful response announces shared reset; invalid destination or missing budget fails closed',async () => {
  let calls = 0; const blocks: string[] = [];
  const reset = Math.ceil(Date.now()/1000) + 300;
  const client = createScalevFetch(async (_hash,until) => { if (until) blocks.push(until); return 0; },async () => { calls++; return new Response(null,{ headers: { 'X-RateLimit-Remaining': '0','X-RateLimit-Reset': String(reset) } }); });
  await client('secret','https://api.scalev.id/v2/orders'); assert.equal(Date.parse(blocks[0]),reset*1000);
  await assert.rejects(client('secret','https://attacker.invalid/'),/Tujuan/); assert.equal(calls,1);
  const unavailable = createScalevFetch(async () => { throw new Error('Budget unavailable'); },async () => { calls++; return new Response(); });
  await assert.rejects(unavailable('secret','https://api.scalev.id/v3/bundles'),/Budget unavailable/); assert.equal(calls,1);
});

test('a queue longer than the network deadline does not expire the request before it starts',async () => {
  let calls = 0;
  const client = createScalevFetch(async (_hash,_until,check) => check ? 0 : 50,async (_url,init) => {
    calls++; assert.ok(init?.signal); assert.equal(init.signal.aborted,false);
    await sleep(5); assert.equal(init.signal.aborted,false);
    assert.equal('timeoutMs' in init,false);
    return new Response();
  });
  await client('secret','https://api.scalev.id/v2/order/1',{ timeoutMs: 30 });
  assert.equal(calls,1);
});

test('independent caller cancellation stops both queue waiting and an active network request',async () => {
  let calls = 0;
  const waiting = new AbortController();
  const queued = createScalevFetch(async () => 19000,async () => { calls++; return new Response(); });
  const pending = queued('secret','https://api.scalev.id/v2/order/1',{ signal: waiting.signal,timeoutMs: 15000 });
  waiting.abort();
  await assert.rejects(pending,{ name: 'AbortError' }); assert.equal(calls,0);
  const active = new AbortController(), reason = new Error('Caller cancelled');
  const fetching = createScalevFetch(async () => 0,async (_url,init) => {
    assert.ok(init?.signal); active.abort(reason);
    assert.equal(init.signal.aborted,true); init.signal.throwIfAborted();
    return new Response();
  });
  await assert.rejects(fetching('secret','https://api.scalev.id/v2/order/1',{ signal: active.signal,timeoutMs: 15000 }),error => error === reason);
});
