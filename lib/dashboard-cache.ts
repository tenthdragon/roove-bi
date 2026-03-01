/**
 * Simple in-memory cache for dashboard data.
 *
 * Keyed on "table + date range" so navigating between pages
 * that query the same Supabase table (e.g. Overview ↔ Products
 * both use daily_product_summary) won't re-fetch.
 *
 * TTL defaults to 5 minutes — short enough that fresh uploads
 * show up quickly, long enough to survive tab switching.
 */

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** Build a cache key from table name + date range (or any extra discriminator). */
function buildKey(table: string, from: string, to: string, extra = ''): string {
  return `${table}|${from}|${to}${extra ? '|' + extra : ''}`;
}

/** Return cached data if still valid, or null. */
export function getCached<T>(table: string, from: string, to: string, extra = ''): T | null {
  const key = buildKey(table, from, to, extra);
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

/** Store data in the cache. */
export function setCache<T>(table: string, from: string, to: string, data: T, extra = '', ttl = DEFAULT_TTL): void {
  const key = buildKey(table, from, to, extra);
  store.set(key, { data, expires: Date.now() + ttl });
}

/** Invalidate all entries whose key starts with a given table name. */
export function invalidateTable(table: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(table + '|')) store.delete(key);
  }
}

/** Invalidate the entire cache — call after data upload/mutation. */
export function invalidateAll(): void {
  store.clear();
}
