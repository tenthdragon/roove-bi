// Server-side Scalev v3 adapter. Neither credentials nor upstream response bodies
// are included in errors returned to the browser.
import { scalevFetch, scalevRetryDelay, ScalevThrottleError } from '../scalev-request-budget';
export class ScalevReadError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ScalevBusiness = { id: number; unique_id: string; account_holder?: string; username?: string };
export type ScalevOption = { id: number; name: string; price: string; is_active?: boolean; is_visible?: boolean; is_owned_by_store?: boolean };
export type ScalevBundle = { id: number; name: string; custom_id: string | null; business?: ScalevBusiness; bundle_price_options?: ScalevOption[]; public_name?: string | null; display?: string | null; weight_bump?: number | string | null; is_bundle_sharing?: boolean };
export type ScalevStore = { id: number; unique_id?: string; name: string; business?: ScalevBusiness; is_active?: boolean };
const positiveId = (id: number) => { if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID Scalev tidak valid.'); return id; };

export class ParserScalevClient {
  constructor(private key: string, private fetcher?: typeof fetch) {}

  private async request(path: string, body?: Record<string, unknown>): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await (this.fetcher || ((url,init) => scalevFetch(this.key,String(url),init)))(`https://api.scalev.id/v3/${path}`, {
          method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
        });
      } catch (error) { if (error instanceof ScalevThrottleError) throw new ScalevReadError(429,error.message); throw new Error(body ? 'Hasil aksi Scalev belum dapat dipastikan. Periksa ulang sebelum melanjutkan; jangan menganggap aksi gagal.' : 'Scalev belum dapat dihubungi. Coba periksa lagi.'); }
      // Never automatically replay a write after a timeout or ambiguous response.
      if (!body && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.text();
        const delay = scalevRetryDelay(response,attempt);
        if (delay > 20000) throw new ScalevReadError(response.status,new ScalevThrottleError(Date.now() + delay).message);
        await new Promise(resolve => setTimeout(resolve,delay));
        continue;
      }
      if (!response.ok) throw new ScalevReadError(response.status, response.status === 401 || response.status === 403
        ? 'Koneksi Scalev tidak memiliki izin untuk operasi ini. Periksa izin business pemilik dan business tujuan.'
        : response.status === 429 ? new ScalevThrottleError(Date.now() + scalevRetryDelay(response,attempt)).message
        : `Scalev belum menyelesaikan permintaan (HTTP ${response.status}). Periksa ulang atau coba lagi.`);
      if (body && response.status === 204) return {};
      try { return await response.json(); } catch { throw new Error('Respons Scalev tidak lengkap. Periksa ulang status sebelum melanjutkan.'); }
    }
  }

  private async list<T extends { id: number }>(path: string): Promise<T[]> {
    const rows: T[] = [], ids = new Set<number>(), cursors = new Set<string>(); let cursor = '';
    for (let page = 0; page < 1000; page++) {
      const result = await this.request(`${path}${path.includes('?') ? '&' : '?'}page_size=25${cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!Array.isArray(result.data) || typeof result.has_next !== 'boolean') throw new Error('Daftar Scalev tidak lengkap. Keberadaan bundle belum dapat dipastikan.');
      for (const row of result.data) {
        if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw new Error('Halaman Scalev berulang atau tidak valid. Coba periksa lagi.');
        ids.add(row.id); rows.push(row);
      }
      if (!result.has_next) return rows;
      if (!result.data.length || typeof result.next_cursor !== 'string' || !result.next_cursor || cursors.has(result.next_cursor)) throw new Error('Pagination Scalev tidak lengkap. Keberadaan bundle belum dapat dipastikan.');
      cursor = result.next_cursor; cursors.add(cursor);
    }
    throw new Error('Katalog Scalev melewati batas pemeriksaan. Hubungi pengelola integrasi.');
  }

  async identity(): Promise<ScalevBusiness> {
    const response = await this.request('business-users/me'), business = (response.data || response).business;
    if (!business?.unique_id || !Number.isSafeInteger(business.id) || business.id <= 0) throw new Error('Identitas business Scalev belum dapat diverifikasi.');
    return business;
  }
  bundles(storeId?: number) { return this.list<ScalevBundle>(`bundles${storeId ? `?store_id=${positiveId(storeId)}` : ''}`); }
  simplifiedBundles(storeId?: number) { return this.list<ScalevBundle>(`bundles/simplified${storeId ? `?store_id=${positiveId(storeId)}` : ''}`); }
  async catalogBundles(storeId?: number): Promise<ScalevBundle[]> {
    // The full list carries ownership; simplified carries active BPOs. Read
    // both by page rather than making one detail/options request per bundle.
    const bundles = await this.bundles(storeId);
    const simplified = new Map((await this.simplifiedBundles(storeId)).map(b => [b.id,b]));
    if (bundles.length !== simplified.size) throw new Error('Daftar bundle berubah saat sinkronisasi. Coba sinkronkan kembali.');
    return bundles.map(bundle => {
      const options = simplified.get(bundle.id);
      if (!bundle.business?.unique_id || !options || options.custom_id !== bundle.custom_id || !Array.isArray(options.bundle_price_options)) throw new Error('Metadata bundle belum lengkap atau berubah saat sinkronisasi. Data lama tidak diganti.');
      return { ...bundle,bundle_price_options: options.bundle_price_options };
    });
  }
  stores() { return this.list<ScalevStore>('stores'); }
  storeBundles(id: number) { return this.list<ScalevBundle>(`stores/${positiveId(id)}/bundles`); }
  partners(id: number) { return this.list<{ id: number; partner: ScalevBusiness }>(`bundles/${positiveId(id)}/partners`); }
  async bundle(id: number): Promise<ScalevBundle | null> {
    try {
      const response = await this.request(`bundles/${positiveId(id)}`), row = response.data || response;
      if (row.id !== id || typeof row.name !== 'string') throw new Error('Identitas bundle Scalev tidak cocok. Periksa ulang.');
      return row;
    } catch (error) { if (error instanceof ScalevReadError && error.status === 404) return null; throw error; }
  }
  async store(id: number): Promise<ScalevStore> {
    const response = await this.request(`stores/${positiveId(id)}`), row = response.data || response;
    if (row.id !== id || !row.business?.unique_id || row.is_active === false) throw new Error('Store Scalev tidak aktif atau identitasnya belum pasti.');
    return row;
  }
  options(id: number) { return this.list<ScalevOption>(`bundles/${positiveId(id)}/bundle-price-options`); }
  share(id: number, partnerUid: string) {
    if (!/^[a-zA-Z0-9_-]{3,100}$/.test(partnerUid)) throw new Error('Identitas business penerima tidak valid.');
    return this.request(`bundles/${positiveId(id)}/partners`, { partner_unique_id: partnerUid });
  }
  attach(storeId: number, optionId: number) { return this.request(`stores/${positiveId(storeId)}/bundle-price-options`, { bpo_ids: [positiveId(optionId)] }); }
}
