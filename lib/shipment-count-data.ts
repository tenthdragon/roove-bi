import { unstable_cache } from 'next/cache';

import { createServiceSupabase } from './supabase-server';

export interface DailyShipmentCountRow {
  date: string;
  product: string | null;
  channel: string | null;
  order_count: number | string | null;
}

interface DateRangeChunk {
  from: string;
  to: string;
}

const DEFAULT_CHUNK_DAYS = 7;
const CHUNK_CONCURRENCY = 2;

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function countShipmentDaysInclusive(from: string, to: string) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function splitShipmentDateRange(
  from: string,
  to: string,
  maxDays = DEFAULT_CHUNK_DAYS,
): DateRangeChunk[] {
  const totalDays = countShipmentDaysInclusive(from, to);
  if (totalDays <= 0) return [];

  const chunks: DateRangeChunk[] = [];
  let cursor = from;

  while (cursor <= to) {
    const chunkDays = Math.min(maxDays, countShipmentDaysInclusive(cursor, to));
    const chunkTo = addDays(cursor, chunkDays - 1);
    chunks.push({ from: cursor, to: chunkTo });
    cursor = addDays(chunkTo, 1);
  }

  return chunks;
}

export function mergeDailyShipmentCountRows(groups: DailyShipmentCountRow[][]) {
  const merged = new Map<string, DailyShipmentCountRow>();

  groups.flat().forEach((row) => {
    const product = row.product || 'Unknown';
    const channel = row.channel || 'Unknown';
    const key = `${row.date}|${product}|${channel}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        date: row.date,
        product,
        channel,
        order_count: Number(row.order_count || 0),
      });
      return;
    }

    existing.order_count = Number(existing.order_count || 0) + Number(row.order_count || 0);
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

async function fetchDailyShipmentCountChunk(
  workspaceId: string,
  from: string,
  to: string,
) {
  const svc = createServiceSupabase();
  const result = await svc.rpc('get_workspace_daily_shipment_counts', {
    p_workspace_id: workspaceId,
    p_from: from,
    p_to: to,
  });

  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as DailyShipmentCountRow[];
}

async function fetchDailyShipmentCountsUncached(
  workspaceId: string,
  from: string,
  to: string,
): Promise<DailyShipmentCountRow[]> {
  const totalDays = countShipmentDaysInclusive(from, to);
  if (totalDays <= 0) return [];

  if (totalDays <= DEFAULT_CHUNK_DAYS) {
    try {
      return await fetchDailyShipmentCountChunk(workspaceId, from, to);
    } catch (error) {
      if (!isStatementTimeoutError(error) || totalDays === 1) throw error;
    }
  }

  const chunkSize = totalDays > DEFAULT_CHUNK_DAYS
    ? DEFAULT_CHUNK_DAYS
    : Math.max(1, Math.floor(totalDays / 2));
  const chunks = splitShipmentDateRange(from, to, chunkSize);
  const chunkRows = await runWithConcurrency(
    chunks,
    CHUNK_CONCURRENCY,
    (chunk) => fetchDailyShipmentCountsUncached(
      workspaceId,
      chunk.from,
      chunk.to,
    ),
  );

  return mergeDailyShipmentCountRows(chunkRows);
}

const getCachedDailyShipmentCounts = unstable_cache(
  fetchDailyShipmentCountsUncached,
  ['daily-shipment-counts-v1-workspace'],
  {
    revalidate: 300,
    tags: ['daily-shipment-counts'],
  },
);

export async function getDailyShipmentCounts(
  workspaceId: string,
  from: string,
  to: string,
) {
  return getCachedDailyShipmentCounts(workspaceId, from, to);
}
