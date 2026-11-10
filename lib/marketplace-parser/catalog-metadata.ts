import type { ScalevBundle, ScalevOption } from './scalev-client';

export function cachedBundleMetadata(bundle: Pick<ScalevBundle,'business'>, options: ScalevOption[] | null) {
  const owner = bundle.business;
  return {
    scalev_owner_uid: owner?.unique_id || null,
    scalev_owner_name: owner?.account_holder || owner?.username || null,
    price_options: options === null ? null : options.filter(o => o.is_active !== false).map(o => {
      if (!Number.isSafeInteger(o.id) || o.id <= 0 || o.price == null || String(o.price).trim() === '' || !Number.isFinite(Number(o.price)) || Number(o.price) < 0) throw new Error('Pilihan harga bundle tidak lengkap. Sinkronisasi dihentikan.');
      return { id: o.id,name: String(o.name || o.id),price: String(o.price) };
    }),
  };
}
