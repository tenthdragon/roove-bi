import "server-only";
import { createServiceSupabase } from "./service-supabase";
import { getShippingFeeRange } from "./shipping-fee-data";
import { marketingTotals, selectMarketingScope } from "./marketing-metrics";
import { calculateProfitabilityTarget } from "./financial-targets";
import { getGrowthFinancialTargetSettings } from "./financial-target-actions";
type SourceRow = {
  date: string;
  product?: string;
  store?: string;
  brand_id?: number;
  net_sales?: number;
  gross_profit?: number;
  spent?: number;
  mp_admin_cost?: number;
};

export async function readGrowthMetrics(
  workspaceId: string,
  portfolioId: string,
  brandId: number | null,
  from: string,
  to: string,
  canTarget: boolean,
) {
  const service = createServiceSupabase();
  const computedAt = new Date().toISOString();
  const base = {
    workspace_id: workspaceId,
    portfolio_id: portfolioId,
    brand_id: brandId,
    source_period: { from, to },
    computed_at: computedAt,
    data_as_of: null as string | null,
    scope: brandId == null ? "company" : "brand",
    basis: "Shipped/completed; tanggal pengiriman WIB",
    freshness:
      "Source freshness belum terverifikasi; shipping cache maks. 5 menit",
  };
  async function fetchRows(table: string, columns: string) {
    const rows: SourceRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await service
        .from(table)
        .select(columns)
        .eq("workspace_id", workspaceId)
        .gte("date", from)
        .lte("date", to)
        .order("date")
        .order("id")
        .range(offset, offset + 999);
      if (r.error) throw new Error(`${table}: ${r.error.message}`);
      const page = r.data as unknown as SourceRow[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  try {
    const [products, ads, channels, shipping, brandsResult, mappingResult] =
      await Promise.all([
        fetchRows(
          "daily_product_summary",
          "date,product,net_sales,gross_profit",
        ),
        fetchRows("daily_ads_spend", "date,spent,store,brand_id"),
        fetchRows("daily_channel_data", "date,product,mp_admin_cost"),
        getShippingFeeRange(workspaceId, from, to),
        service
          .from("brands")
          .select("id,name")
          .eq("workspace_id", workspaceId)
          .eq("is_active", true),
        service
          .from("ads_store_brand_mapping")
          .select("store_pattern,brand,brand_id")
          .eq("workspace_id", workspaceId),
      ]);
    if (brandsResult.error) throw brandsResult.error;
    if (mappingResult.error) throw mappingResult.error;
    const selected = selectMarketingScope(
      products,
      ads,
      channels,
      shipping,
      brandsResult.data,
      mappingResult.data,
      brandId,
    );
    const missing = [
      !selected.products.length && "daily_product_summary",
      !selected.ads.length && "daily_ads_spend",
      !selected.channels.length && "daily_channel_data",
      !selected.shipping.length && "shipping",
    ].filter(Boolean);
    // Missing sources must never be interpreted as zero spend/fees.
    const actual = missing.length
      ? null
      : marketingTotals(
          selected.products,
          selected.ads,
          selected.channels,
          selected.shipping,
        );
    const month = from.slice(0, 7);
    let target = null;
    let targetReason = canTarget
      ? "Belum ada target untuk scope/periode ini."
      : "Tidak memiliki izin target finansial.";
    if (
      canTarget &&
      brandId == null &&
      from === `${month}-01` &&
      to.startsWith(month)
    ) {
      const settings = await getGrowthFinancialTargetSettings(
        portfolioId,
        month,
      );
      const computed = calculateProfitabilityTarget({
        currentRevenue: actual?.revenue || 0,
        currentCm3: actual?.cm3 || 0,
        projectedRevenue: 0,
        monthlyOverhead: settings.monthlyOverhead,
        actualDay: 1,
        daysInMonth: 31,
        target: settings.effectiveTarget
          ? {
              ...settings.effectiveTarget,
              planned_cm3_margin: settings.weightedCm3Margin,
            }
          : null,
      });
      target = settings.effectiveTarget
        ? {
            month,
            scope: "company",
            source: settings.effectiveSource,
            version: settings.effectiveTarget,
            overhead: settings.monthlyOverhead,
            required_cm3: computed.targetCm3,
            minimum_revenue: computed.minimumRevenue,
            benchmark_period: {
              from: settings.weightedCm3From,
              to: settings.weightedCm3To,
            },
            weighted_cm3_margin: settings.weightedCm3Margin,
          }
        : null;
      targetReason = target
        ? "Target satu bulan penuh; actual hanya periode yang ditampilkan."
        : "";
    }
    return {
      ...base,
      status: missing.length ? "partial" : "loaded",
      reason: missing.length
        ? `Sumber kosong: ${missing.join(", ")}. Nilai ditampilkan N/A.`
        : null,
      actual,
      target,
      target_reason: targetReason,
      coverage: {
        products: selected.products.length,
        ads: selected.ads.length,
        channels: selected.channels.length,
        shipping: selected.shipping.length,
      },
      attribution_note:
        brandId == null
          ? "Sama dengan Marketing: brand aktif; ads tanpa mapping tetap termasuk total."
          : "Sama dengan filter brand Marketing; ads tanpa mapping tidak diatribusikan ke brand ini.",
      source_tables: [
        "daily_product_summary",
        "daily_ads_spend",
        "daily_channel_data",
        "get_workspace_daily_shipping_charge_data",
      ],
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      reason: error instanceof Error ? error.message : "Gagal membaca BI.",
      actual: null,
      target: null,
      target_reason:
        "Target tidak dapat diverifikasi karena sumber data gagal dimuat.",
    };
  }
}
