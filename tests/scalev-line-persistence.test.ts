import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isTransientScalevLineError,
  ScalevLinePersistenceError,
  withScalevLineRetry,
} from '../lib/scalev-line-persistence';
import { buildScalevRepairPayload } from '../lib/scalev-sync-runner';
import { extractScalevNumericId } from '../lib/scalev-id';

test('ScaleV line retry recognizes database contention errors', () => {
  assert.equal(isTransientScalevLineError({ code: '40P01', message: 'deadlock detected' }), true);
  assert.equal(isTransientScalevLineError({ code: '55P03', message: 'lock not available' }), true);
  assert.equal(isTransientScalevLineError({ code: '23505', message: 'duplicate key' }), false);
});

test('ScaleV line retry recovers from a transient webhook-burst failure', async () => {
  let attempts = 0;
  const retryAttempts: number[] = [];

  const result = await withScalevLineRetry(async () => {
    attempts++;
    if (attempts < 3) {
      throw { code: '40P01', message: 'deadlock detected' };
    }
    return 'persisted';
  }, {
    baseDelayMs: 0,
    sleep: async () => {},
    random: () => 0.5,
    onRetry: ({ attempt }) => retryAttempts.push(attempt),
  });

  assert.equal(result, 'persisted');
  assert.equal(attempts, 3);
  assert.deepEqual(retryAttempts, [1, 2]);
});

test('ScaleV line retry surfaces permanent failures immediately', async () => {
  let attempts = 0;

  await assert.rejects(
    withScalevLineRetry(async () => {
      attempts++;
      throw { code: '23502', message: 'null value violates not-null constraint' };
    }, {
      baseDelayMs: 0,
      sleep: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof ScalevLinePersistenceError);
      assert.equal(error.code, '23502');
      assert.equal(error.attempts, 1);
      return true;
    },
  );

  assert.equal(attempts, 1);
});

test('raw ScaleV payload can repair missing lines without another API fetch', () => {
  const payload = buildScalevRepairPayload({
    order_id: '260819-ROOVE-001',
    scalev_id: null,
    status: 'shipped',
    store_name: 'Roove Main Store - Marketplace',
    platform: 'shopee',
    external_id: 'SHOPEE-001',
    financial_entity: 'Shopee',
    shipped_time: '2026-08-19T09:00:00+07:00',
    raw_data: {
      id: 987654,
      orderlines: [
        { product_name: 'Roove Blueberry 20sc', product_price: 199000 },
      ],
    },
  });

  assert.ok(payload);
  assert.equal(payload.id, '987654');
  assert.equal(payload.order_id, '260819-ROOVE-001');
  assert.equal(payload.status, 'shipped');
  assert.equal(payload.store.name, 'Roove Main Store - Marketplace');
  assert.equal(payload.shipped_time, '2026-08-19T09:00:00+07:00');
  assert.equal(payload.orderlines.length, 1);
});

test('ScaleV database ID extraction rejects webhook UUID event IDs', () => {
  assert.equal(extractScalevNumericId({ id: '019fbc6f-e2c8-7cfc-bfda-0262fd643d0d' }), null);
  assert.equal(extractScalevNumericId({ scalev_id: 987654 }), '987654');
  assert.equal(extractScalevNumericId({ id: 'event-id', raw_data: { scalev_id: '12345' } }), '12345');
});

test('repair payload is rejected when raw order lines are unavailable', () => {
  assert.equal(buildScalevRepairPayload({ raw_data: { id: 123 } }), null);
  assert.equal(buildScalevRepairPayload({ raw_data: { orderlines: [] } }), null);
});
