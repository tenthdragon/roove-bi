'use server';

import { createServiceSupabase } from '@/lib/service-supabase';
import {
  requireAnyDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import {
  runScalevSourceClassBackfill,
  type ScalevSourceClassBackfillSummary,
} from '@/lib/scalev-source-class-backfill';

export type ScalevSourceClassBackfillActionInput = {
  apply?: boolean;
  batchSize?: number;
  fromDate?: string | null;
  toDate?: string | null;
};

async function requireSourceClassBackfillAccess(label: string) {
  await requireDashboardTabAccess('warehouse', label);
  await requireAnyDashboardPermissionAccess(['admin:sync', 'whs:mapping'], label);
}

function getTodayJakartaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeDate(value: string | null | undefined, fallback: string) {
  const cleaned = String(value || '').trim() || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error('Format tanggal harus YYYY-MM-DD.');
  }
  return cleaned;
}

export async function runScalevSourceClassBackfillAction(
  input: ScalevSourceClassBackfillActionInput,
): Promise<ScalevSourceClassBackfillSummary> {
  await requireSourceClassBackfillAccess('Backfill Source Class ScaleV');

  const fromDate = normalizeDate(input.fromDate, '2026-04-21');
  const toDate = normalizeDate(input.toDate, getTodayJakartaDate());
  if (fromDate > toDate) {
    throw new Error('Tanggal awal tidak boleh lebih besar dari tanggal akhir.');
  }

  const batchSize = Math.max(1, Number(input.batchSize || 1000) || 1000);
  const svc = createServiceSupabase();

  return runScalevSourceClassBackfill({
    supabase: svc,
    apply: input.apply === true,
    batchSize,
    fromDate,
    toDate,
  });
}
