/**
 * Simple client-side cache for dashboard data.
 * Data only changes on upload/sync, so we can safely cache
 * and invalidate manually when needed.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry<any>>();

function makeCacheKey(table: string, from: string, to: string, extra?: string): string {
  return `${table}:${from}:${to}${extra ? ':' + extra : ''}`;
}

export function getCached<T>(table: string, from: string, to: string, extra?: string): T | null {
  const key = makeCacheKey(table, from, to, extra);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(table: string, from: string, to: string, data: T, extra?: string): void {
  const key = makeCacheKey(table, from, to, extra);
  cache.set(key, { data, timestamp: Date.now(), key });
}

/**
 * Invalidate all cache entries (call after upload/sync).
 */
export function invalidateAll(): void {
  cache.clear();
}

/**
 * Invalidate entries for a specific table.
 */
export function invalidateTable(table: string): void {
  for (const [key] of cache) {
    if (key.startsWith(table + ':')) {
      cache.delete(key);
    }
  }
}
