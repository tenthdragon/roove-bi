/** Bounded, memory-only navigation cache. Keys include user, access and workspace. */
export function createMetaOverviewCache<T>(ttl = 300_000, limit = 20) {
  const entries = new Map<string, { data: T; expires: number }>();
  const pending = new Map<string, Promise<unknown>>();
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.expires <= Date.now()) { entries.delete(key); return; }
      return entry.data;
    },
    set(key: string, data: T) {
      entries.delete(key);
      entries.set(key, { data, expires: Date.now() + ttl });
      while (entries.size > limit) entries.delete(entries.keys().next().value!);
    },
    delete(key: string) { entries.delete(key); },
    request<R>(key: string, load: () => Promise<R>): Promise<R> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<R>;
      const result = Promise.resolve().then(load).finally(() => pending.delete(key));
      pending.set(key, result);
      return result;
    },
  };
}
