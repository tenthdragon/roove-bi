export type ShopeeAdminFeeRate = {
  effective_from: string;
  rate: number | string;
};

export function resolveShopeeAdminFeeRate(
  rates: ShopeeAdminFeeRate[],
  metricDate: string,
) {
  let resolved: number | null = null;
  let resolvedDate = '';

  for (const row of rates || []) {
    const effectiveFrom = String(row?.effective_from || '').slice(0, 10);
    const rate = Number(row?.rate);
    if (!effectiveFrom || effectiveFrom > metricDate) continue;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) continue;
    if (!resolvedDate || effectiveFrom >= resolvedDate) {
      resolved = rate;
      resolvedDate = effectiveFrom;
    }
  }

  return resolved;
}

export function calculateAttributedRevenueAfterAdminFee(
  attributedRevenue: number,
  adminFeeRate: number | null,
) {
  if (adminFeeRate == null) return null;
  return Number(attributedRevenue || 0) * (1 - adminFeeRate);
}

export function calculateRoasAfterAdminFee(
  attributedRevenue: number,
  spend: number,
  adminFeeRate: number | null,
) {
  const adjustedRevenue = calculateAttributedRevenueAfterAdminFee(
    attributedRevenue,
    adminFeeRate,
  );
  if (adjustedRevenue == null || Number(spend || 0) <= 0) return null;
  return adjustedRevenue / Number(spend);
}
