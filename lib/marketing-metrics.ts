// Shared with Marketing Channel and Growth Execution. Monetary signs follow BI:
// fees and spend are absolute; shipping retains its source sign.
export function calculateCm3(
  grossProfit: number,
  mpFee: number,
  shipping: number,
  marketingFee: number,
) {
  return grossProfit - mpFee - shipping - marketingFee;
}
type ProductRow = { net_sales?: unknown; gross_profit?: unknown };
type AdsRow = { spent?: unknown };
type ChannelRow = { mp_admin_cost?: unknown };
type ShippingRow = { shipping_charge?: unknown };
const LEGACY_STORE_BRAND_FALLBACKS: Record<string, string> = {
  "purvu store": "Purvu",
  plume: "Pluve",
};
export function resolveMarketingAdBrand(
  store: string | null | undefined,
  brandId: number | null | undefined,
  brandIdMap: Record<number, string>,
  storeBrandMap: Record<string, string>,
  activeBrandMap: Record<string, string>,
) {
  if (brandId && brandIdMap[brandId]) return brandIdMap[brandId];
  if (!store) return null;
  const key = store.trim().toLowerCase();
  return (
    storeBrandMap[key] ||
    activeBrandMap[key] ||
    LEGACY_STORE_BRAND_FALLBACKS[key] ||
    null
  );
}
export function selectMarketingScope<
  T extends { product?: unknown },
  A extends { store?: unknown; brand_id?: unknown },
  C extends { product?: unknown },
  S extends { product?: unknown },
>(
  products: T[],
  ads: A[],
  channels: C[],
  shipping: S[],
  brands: { id: number; name: string }[],
  mapping: { store_pattern: string; brand: string; brand_id: number | null }[],
  brandId: number | null,
) {
  const names: Record<string, string> = {},
    byId: Record<number, string> = {},
    stores: Record<string, string> = {};
  brands.forEach((b) => {
    names[b.name.toLowerCase()] = b.name;
  });
  mapping.forEach((m) => {
    if (m.store_pattern && m.brand)
      stores[m.store_pattern.toLowerCase()] = m.brand;
    if (m.brand_id && m.brand) byId[m.brand_id] = m.brand;
  });
  const selected =
    brandId == null ? null : brands.find((b) => b.id === brandId)?.name;
  if (brandId != null && !selected)
    throw new Error("Brand tidak aktif atau tidak ditemukan.");
  const matches = (row: { product?: unknown }) =>
    Boolean(names[String(row.product || "").toLowerCase()]) &&
    (!selected || row.product === selected);
  const attributed = ads.map((row) => ({
    ...row,
    brand: resolveMarketingAdBrand(
      String(row.store || ""),
      row.brand_id ? Number(row.brand_id) : null,
      byId,
      stores,
      names,
    ),
  }));
  return {
    products: products.filter(matches),
    channels: channels.filter(matches),
    shipping: shipping.filter(matches),
    ads: attributed.filter((row) =>
      selected
        ? row.brand === selected
        : !row.brand || Boolean(names[row.brand.toLowerCase()]),
    ),
    unmapped: attributed.filter((row) => !row.brand).length,
  };
}
export function marketingTotals(
  products: ProductRow[],
  ads: AdsRow[],
  channels: ChannelRow[],
  shipping: ShippingRow[],
) {
  const sum = <T>(rows: T[], get: (row: T) => number) =>
    rows.reduce((total, row) => total + get(row), 0);
  const revenue = sum(products, (r) => Number(r.net_sales || 0));
  const grossProfit = sum(products, (r) => Number(r.gross_profit || 0));
  const mpFee = sum(channels, (r) => Math.abs(Number(r.mp_admin_cost || 0)));
  const shippingFee = sum(shipping, (r) => Number(r.shipping_charge || 0));
  const mktFee = sum(ads, (r) => Math.abs(Number(r.spent || 0)));
  const cm3 = calculateCm3(grossProfit, mpFee, shippingFee, mktFee);
  return {
    revenue,
    grossProfit,
    mpFee,
    shippingFee,
    mktFee,
    cm3,
    roas: mktFee > 0 ? revenue / mktFee : null,
    cm3Pct: revenue > 0 ? (cm3 / revenue) * 100 : null,
  };
}
