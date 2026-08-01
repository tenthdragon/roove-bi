export type FinancialTargetConfig = {
  target_operating_profit: number | string;
  planned_cm3_margin: number | string;
  target_revenue_override?: number | string | null;
};

export type ProfitabilityStatus = 'negative_unit_economics' | 'unconfigured' | 'on_track' | 'off_track';

export function calculateProfitabilityTarget(input: {
  currentRevenue: number;
  currentCm3: number;
  projectedRevenue: number;
  monthlyOverhead: number;
  actualDay: number;
  daysInMonth: number;
  target?: FinancialTargetConfig | null;
}) {
  const currentRevenue = Number(input.currentRevenue || 0);
  const currentCm3 = Number(input.currentCm3 || 0);
  const projectedRevenue = Number(input.projectedRevenue || 0);
  const monthlyOverhead = Number(input.monthlyOverhead || 0);
  const currentCm3Margin = currentRevenue > 0 ? currentCm3 / currentRevenue : 0;
  const projectedCm3 = projectedRevenue * currentCm3Margin;
  const projectedProfit = projectedCm3 - monthlyOverhead;
  const targetConfigured = Boolean(input.target);
  const targetOperatingProfit = targetConfigured
    ? Number(input.target!.target_operating_profit || 0)
    : null;
  const plannedCm3Margin = targetConfigured
    ? Number(input.target!.planned_cm3_margin || 0)
    : null;
  const targetRevenueOverride = targetConfigured
    && input.target!.target_revenue_override != null
    ? Number(input.target!.target_revenue_override)
    : null;
  const targetCm3 = targetConfigured
    ? monthlyOverhead + targetOperatingProfit!
    : null;
  const minimumRevenue = targetConfigured && plannedCm3Margin! > 0
    ? targetRevenueOverride ?? targetCm3! / plannedCm3Margin!
    : null;
  const targetRevenueToDate = targetConfigured
    ? minimumRevenue! * input.actualDay / Math.max(1, input.daysInMonth)
    : null;
  const targetCm3ToDate = targetConfigured
    ? targetCm3! * input.actualDay / Math.max(1, input.daysInMonth)
    : null;
  const revenueTargetProgress = targetConfigured && minimumRevenue! > 0
    ? currentRevenue / minimumRevenue!
    : null;
  const cm3TargetProgress = targetConfigured && targetCm3! > 0
    ? currentCm3 / targetCm3!
    : null;
  const requiredDaily = targetConfigured
    ? Math.max(0, minimumRevenue! - currentRevenue)
      / Math.max(1, input.daysInMonth - input.actualDay)
    : null;
  const requiredCm3MarginAtProjection = targetConfigured && projectedRevenue > 0
    ? targetCm3! / projectedRevenue
    : null;
  const unitEconomicsHealthy = currentCm3Margin > 0;
  const onTrack = unitEconomicsHealthy
    && targetConfigured
    && projectedProfit >= targetOperatingProfit!;
  const status: ProfitabilityStatus = !unitEconomicsHealthy
    ? 'negative_unit_economics'
    : !targetConfigured
      ? 'unconfigured'
      : onTrack
        ? 'on_track'
        : 'off_track';

  return {
    currentCm3Margin,
    projectedCm3,
    projectedProfit,
    targetConfigured,
    targetOperatingProfit,
    plannedCm3Margin,
    targetRevenueOverride,
    targetCm3,
    minimumRevenue,
    targetRevenueToDate,
    targetCm3ToDate,
    revenueTargetProgress,
    cm3TargetProgress,
    requiredDaily,
    requiredCm3MarginAtProjection,
    unitEconomicsHealthy,
    onTrack,
    status,
  };
}
