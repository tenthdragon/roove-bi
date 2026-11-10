import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export class ScalevThrottleError extends Error {
  constructor(public retryAt: number) {
    super(`Scalev sedang membatasi permintaan. Coba lagi setelah ${new Date(retryAt).toLocaleTimeString('id-ID',{ timeZone: 'Asia/Jakarta' })} WIB. Data aplikasi tetap dapat diperiksa.`);
  }
}
export function scalevRetryDelay(response: Response, attempt = 0, now = Date.now()): number {
  const raw = response.headers.get('retry-after');
  const retry = raw?.trim() ? Number(raw) : NaN;
  const after = !raw?.trim() ? NaN : Number.isFinite(retry) ? (retry >= 0 ? now + retry * 1000 : NaN) : Date.parse(raw);
  const limited = response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0';
  const reset = limited ? Number(response.headers.get('x-ratelimit-reset')) * 1000 : NaN;
  return Math.max(0,Number.isFinite(after) ? after - now : reset > now ? reset - now : 1000 * (attempt + 1));
}
type Budget = (hash: string, blockedUntil?: string, checkOnly?: boolean) => Promise<number>;
const reserve: Budget = async (hash,blockedUntil,checkOnly = false) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{ auth: { persistSession: false,autoRefreshToken: false } });
  const result = await db.rpc('reserve_scalev_api_request',{ p_key_hash: hash,p_blocked_until: blockedUntil || null,p_check_only: checkOnly });
  if (result.error || typeof result.data !== 'number' || !Number.isFinite(result.data)) throw new Error('Antrean koneksi Scalev belum tersedia. Data aplikasi tetap dapat diperiksa.');
  return result.data;
};
export function createScalevFetch(budget: Budget = reserve, fetcher: typeof fetch = (...args) => fetch(...args), wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve,ms))) {
  return async (key: string, url: string, init?: RequestInit): Promise<Response> => {
    if (!key) throw new Error('Koneksi Business Scalev belum tersedia.');
    const destination = new URL(url);
    if (!['api.scalev.id','api.scalev.com'].includes(destination.hostname) || destination.protocol !== 'https:') throw new Error('Tujuan koneksi Scalev tidak valid.');
    const hash = createHash('sha256').update(key).digest('hex');
    // Recheck a newly announced cooldown after a queued slot wakes up.
    let delay = await budget(hash);
    for (let check = 0; ; check++) {
      if (delay > 20000 || check > 3) throw new ScalevThrottleError(Date.now() + delay);
      if (delay > 0) await wait(Math.ceil(delay));
      delay = await budget(hash,undefined,true);
      if (delay <= 0) break;
      // A cooldown invalidates our old slot. Reserve a new staggered slot so
      // queued requests do not all wake and hit Scalev at the reset boundary.
      delay = await budget(hash);
    }
    const response = await fetcher(url,{ ...init,redirect: 'error' });
    if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
      delay = scalevRetryDelay(response);
      await budget(hash,new Date(Date.now() + Math.max(delay,1000)).toISOString());
    }
    return response;
  };
}
export const scalevFetch = createScalevFetch();
