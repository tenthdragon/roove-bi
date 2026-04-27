import { unstable_cache } from 'next/cache';

import { createServiceSupabase } from './supabase-server';

export interface ShippingFeeRow {
  date: string;
  product: string | null;
  channel: string | null;
  shipping_charge: number | string | null;
}

interface DateRangeChunk {
  from: string;
  to: string;
}

const DEFAULT_CHUNK_DAYS = 7;
const DIRECT_QUERY_DAY_THRESHOLD = 14;
const CHUNK_CONCURRENCY = 4;

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function countDaysInclusive(from: string, to: string) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function splitIsoDateRange(from: string, to: string, maxDays = DEFAULT_CHUNK_DAYS): DateRangeChunk[] {
  const totalDays = countDaysInclusive(from, to);
  if (totalDays <= 0) return [];

  const chunks: DateRangeChunk[] = [];
  let cursor = from;

  while (cursor <= to) {
    const remainingDays = countDaysInclusive(cursor, to);
    const chunkDays = Math.min(maxDays, remainingDays);
    const chunkTo = addDays(cursor, chunkDays - 1);
    chunks.push({ from: cursor, to: chunkTo });
    cursor = addDays(chunkTo, 1);
  }

  return chunks;
}

function normalizeMoney(value: number | string | null | undefined) {
  return Number(value || 0);
}

export function mergeShippingFeeRows(groups: ShippingFeeRow[][]) {
  const merged = new Map<string, ShippingFeeRow>();

  groups.flat().forEach((row) => {
    const date = row.date;
    const product = row.product || 'Unknown';
    const channel = row.channel || 'Unknown';
    const key = `${date}|${product}|${channel}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        date,
        product,
        channel,
        shipping_charge: normalizeMoney(row.shipping_charge),
      });
      return;
    }

    existing.shipping_charge = normalizeMoney(existing.shipping_charge) + normalizeMoney(row.shipping_charge);
  });

  return Array.from(merged.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
      || (a.product || '').localeCompare(b.product || '')
      || (a.channel || '').localeCompare(b.channel || '')
  );
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume()),
  );

  return results;
}

function isStatementTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /statement timeout|canceling statement due to statement timeout/i.test(error.message);
}

async function fetchShippingFeeChunk(from: string, to: string) {
  const svc = createServiceSupabase();
  const result = await svc.rpc('get_daily_shipping_charge_data', { p_from: from, p_to: to });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data ?? []) as ShippingFeeRow[];
}

async function fetchShippingFeeRangeUncached(from: string, to: string): Promise<ShippingFeeRow[]> {
  const totalDays = countDaysInclusive(from, to);
  if (totalDays <= 0) return [];

  if (totalDays <= DIRECT_QUERY_DAY_THRESHOLD) {
    try {
      return await fetchShippingFeeChunk(from, to);
    } catch (error) {
      if (!isStatementTimeoutError(error) || totalDays === 1) throw error;
    }
  }

  const chunkSize = totalDays > DEFAULT_CHUNK_DAYS ? DEFAULT_CHUNK_DAYS : Math.max(1, Math.floor(totalDays / 2));
  const chunks = splitIsoDateRange(from, to, chunkSize);
  const chunkRows = await runWithConcurrency(
    chunks,
    CHUNK_CONCURRENCY,
    async (chunk) => fetchShippingFeeRangeUncached(chunk.from, chunk.to),
  );

  return mergeShippingFeeRows(chunkRows);
}

const getCachedShippingFeeRange = unstable_cache(
  async (from: string, to: string) => fetchShippingFeeRangeUncached(from, to),
  ['shipping-fee-range-v1'],
  { revalidate: 300 },
);

export async function getShippingFeeRange(from: string, to: string) {
  return getCachedShippingFeeRange(from, to);
}
