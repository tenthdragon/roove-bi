// Coordinate cache misses across all report scopes in one app process. The
// overview requests four reports per brand; a brand batch is not a query limit.
export function createMetaReportRequests(concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid report concurrency');
  let active = 0;
  const waiting: (() => void)[] = [];
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, load: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const result = (async () => {
        await new Promise<void>(resolve => {
          const start = () => { active++; resolve(); };
          if (active < concurrency) start(); else waiting.push(start);
        });
        try { return await load(); }
        finally { active--; pending.delete(key); waiting.shift()?.(); }
      })();
      pending.set(key, result);
      return result;
    },
  };
}

export class MetaReportUnavailableError extends Error {
  constructor(timeout: boolean) {
    super(timeout
      ? 'Perhitungan laporan melewati batas waktu. Silakan coba lagi.'
      : 'Laporan Meta belum berhasil dimuat. Silakan coba muat ulang.');
  }
}

// Expected database failures are returned as data so Next's production error
// redaction does not replace this safe message with a Server Components error.
export async function metaReportResponse<T>(load: () => Promise<T>): Promise<T | { reportError: string }> {
  try { return await load(); }
  catch (error) {
    if (error instanceof MetaReportUnavailableError) return { reportError: error.message };
    throw error;
  }
}
