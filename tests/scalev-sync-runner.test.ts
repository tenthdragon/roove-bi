import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FULL_SYNC_BATCH_LIMIT,
  normalizeFullSyncBatchLimit,
  trimFullSyncBatch,
} from '../lib/scalev-sync-runner';
import { buildNextScalevSyncJobPayload } from '../lib/scalev-sync-job-payload';

test('normalizeFullSyncBatchLimit uses a safe default and clamps oversized values', () => {
  assert.equal(normalizeFullSyncBatchLimit(null), DEFAULT_FULL_SYNC_BATCH_LIMIT);
  assert.equal(normalizeFullSyncBatchLimit(0), DEFAULT_FULL_SYNC_BATCH_LIMIT);
  assert.equal(normalizeFullSyncBatchLimit(25), 25);
  assert.equal(normalizeFullSyncBatchLimit(9999), 250);
});

test('trimFullSyncBatch exposes a cursor when the full sync page overflows', () => {
  const rows = Array.from({ length: DEFAULT_FULL_SYNC_BATCH_LIMIT + 1 }, (_, index) => ({
    id: index + 1,
  }));

  const result = trimFullSyncBatch(rows, DEFAULT_FULL_SYNC_BATCH_LIMIT);

  assert.equal(result.rows.length, DEFAULT_FULL_SYNC_BATCH_LIMIT);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextAfterId, DEFAULT_FULL_SYNC_BATCH_LIMIT);
});

test('trimFullSyncBatch does not request a follow-up when the page is complete', () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ id: index + 11 }));
  const result = trimFullSyncBatch(rows, DEFAULT_FULL_SYNC_BATCH_LIMIT);

  assert.equal(result.rows.length, 3);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextAfterId, 13);
});

test('buildNextScalevSyncJobPayload chains only full sync jobs that still have more rows', () => {
  const nextPayload = buildNextScalevSyncJobPayload({
    id: 'job-1',
    job_name: 'scalev_sync',
    route: '/api/scalev-sync',
    mode: 'cron',
    status: 'running',
    payload: { mode: 'full', batch_limit: 80 },
    request_id: null,
    dedupe_key: null,
    requested_by: null,
    requested_by_name: null,
    attempt_count: 1,
    max_attempts: 3,
    priority: 20,
    available_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    locked_at: null,
    locked_by: null,
    duration_ms: null,
    rows_processed: null,
    result_summary: {},
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, {
    has_more: true,
    next_after_id: 8801,
  });

  assert.deepEqual(nextPayload, {
    mode: 'full',
    batch_limit: 80,
    after_id: 8801,
  });

  const noFollowUp = buildNextScalevSyncJobPayload({
    id: 'job-2',
    job_name: 'scalev_sync',
    route: '/api/scalev-sync',
    mode: 'manual',
    status: 'running',
    payload: { mode: 'date', date: '2026-05-06' },
    request_id: null,
    dedupe_key: null,
    requested_by: null,
    requested_by_name: null,
    attempt_count: 1,
    max_attempts: 3,
    priority: 20,
    available_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    locked_at: null,
    locked_by: null,
    duration_ms: null,
    rows_processed: null,
    result_summary: {},
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, {
    has_more: true,
    next_after_id: 9900,
  });

  assert.equal(noFollowUp, null);
});
