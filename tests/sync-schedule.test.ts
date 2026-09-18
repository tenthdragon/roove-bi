import test from 'node:test';
import assert from 'node:assert/strict';
import { getTodayWIB } from '../lib/sync-schedule';

test('intraday sync switches date at WIB midnight, not UTC midnight', () => {
  assert.equal(getTodayWIB(new Date('2026-09-18T16:59:59Z')), '2026-09-18');
  assert.equal(getTodayWIB(new Date('2026-09-18T17:00:00Z')), '2026-09-19');
  assert.equal(getTodayWIB(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
});
