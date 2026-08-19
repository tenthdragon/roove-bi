'use server';

import { revalidatePath } from 'next/cache';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { getShippingFeeRange } from './shipping-fee-data';

export type WorkspaceFinancialTarget = {
  id: number;
  workspace_id: string;
  target_month: string | null;
  effective_from: string;
  target_operating_profit: number;
  planned_cm3_margin: number | null;
  target_revenue_override: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FinancialTargetAudit = {
  id: number;
  target_id: number | null;
  action: 'insert' | 'update' | 'delete';
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  changed_at: string;
};

export type FinancialTargetSettings = {
  month: string;
  monthlyOverhead: number;
  weightedCm3Margin: number | null;
  weightedCm3From: string;
  weightedCm3To: string;
  defaultTarget: WorkspaceFinancialTarget | null;
  monthlyTarget: WorkspaceFinancialTarget | null;
  effectiveTarget: WorkspaceFinancialTarget | null;
  effectiveSource: 'monthly' | 'default' | 'unconfigured';
  audit: FinancialTargetAudit[];
};

export type FinancialTargetInput = {
  scope: 'default' | 'month';
  targetMonth?: string | null;
  targetOperatingProfit: number;
  notes?: string | null;
};

function normalizeMonth(value?: string | null) {
  const month = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Bulan target harus menggunakan format YYYY-MM.');
  }
  return month;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

function weightedCm3Bounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(Date.UTC(year, monthNumber - 4, 1));
  const to = new Date(Date.UTC(year, monthNumber - 1, 0));
  return {
    start: from.toISOString().slice(0, 10),
    end: to.toISOString().slice(0, 10),
  };
}

function mapTarget(row: any): WorkspaceFinancialTarget {
  return {
    ...row,
    id: Number(row.id),
    target_operating_profit: Number(row.target_operating_profit || 0),
    planned_cm3_margin: row.planned_cm3_margin == null
      ? null
      : Number(row.planned_cm3_margin),
    target_revenue_override: row.target_revenue_override == null
      ? null
      : Number(row.target_revenue_override),
  };
}

async function fetchAllRows(
  svc: ReturnType<typeof createServiceSupabase>,
  table: string,
  columns: string,
  workspaceId: string,
  from: string,
  to: string,
) {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const result = await svc
      .from(table)
      .select(columns)
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .range(offset, offset + pageSize - 1);

    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function getWeightedCm3Benchmark(
  svc: ReturnType<typeof createServiceSupabase>,
  workspaceId: string,
  bounds: { start: string; end: string },
) {
  try {
    const [daily, ads, channel, shipping] = await Promise.all([
      fetchAllRows(
        svc,
        'daily_product_summary',
        'date, net_sales, gross_profit',
        workspaceId,
        bounds.start,
        bounds.end,
      ),
      fetchAllRows(
        svc,
        'daily_ads_spend',
        'date, spent',
        workspaceId,
        bounds.start,
        bounds.end,
      ),
      fetchAllRows(
        svc,
        'daily_channel_data',
        'date, mp_admin_cost',
        workspaceId,
        bounds.start,
        bounds.end,
      ),
      getShippingFeeRange(workspaceId, bounds.start, bounds.end),
    ]);

    const revenue = daily.reduce(
      (sum, row) => sum + Number(row.net_sales || 0),
      0,
    );
    const grossProfit = daily.reduce(
      (sum, row) => sum + Number(row.gross_profit || 0),
      0,
    );
    const marketplaceFees = channel.reduce(
      (sum, row) => sum + Math.abs(Number(row.mp_admin_cost || 0)),
      0,
    );
    const adsSpend = ads.reduce(
      (sum, row) => sum + Math.abs(Number(row.spent || 0)),
      0,
    );
    const shippingFees = shipping.reduce(
      (sum, row) => sum + Math.abs(Number(row.shipping_charge || 0)),
      0,
    );
    const cm3 = grossProfit - marketplaceFees - adsSpend - shippingFees;
    const margin = revenue > 0 && cm3 > 0 && cm3 <= revenue
      ? cm3 / revenue
      : null;

    return { revenue, cm3, margin };
  } catch (error) {
    console.error('[FinancialTarget] Gagal menghitung weighted margin CM3.', error);
    return { revenue: 0, cm3: 0, margin: null };
  }
}

export async function getFinancialTargetSettings(
  targetMonth: string,
): Promise<FinancialTargetSettings> {
  const { workspaceId } = await requireDashboardTabAccess(
    'financial-settings',
    'Financial Settings',
  );
  const month = normalizeMonth(targetMonth);
  const bounds = monthBounds(month);
  const benchmarkBounds = weightedCm3Bounds(month);
  const svc = createServiceSupabase();

  const [targetsResult, overheadResult, auditResult, weightedCm3Benchmark] = await Promise.all([
    svc
      .from('workspace_financial_targets')
      .select('id, workspace_id, target_month, effective_from, target_operating_profit, planned_cm3_margin, target_revenue_override, notes, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .or(`target_month.is.null,target_month.eq.${bounds.start}`),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: bounds.start,
      p_date_to: bounds.end,
    }),
    svc
      .from('workspace_financial_target_audit')
      .select('id, target_id, action, before_values, after_values, changed_at')
      .eq('workspace_id', workspaceId)
      .order('changed_at', { ascending: false })
      .limit(8),
    getWeightedCm3Benchmark(svc, workspaceId, benchmarkBounds),
  ]);

  if (targetsResult.error) throw targetsResult.error;
  if (overheadResult.error) throw overheadResult.error;
  if (auditResult.error) throw auditResult.error;

  const targets = (targetsResult.data || []).map(mapTarget);
  const defaultTarget = targets
    .filter(target => target.target_month == null && target.effective_from <= bounds.start)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
  const monthlyTarget = targets.find(target => target.target_month === bounds.start) || null;

  return {
    month,
    monthlyOverhead: (overheadResult.data || []).reduce(
      (sum: number, row: any) => sum + Number(row.amount || 0),
      0,
    ),
    weightedCm3Margin: weightedCm3Benchmark.margin,
    weightedCm3From: benchmarkBounds.start,
    weightedCm3To: benchmarkBounds.end,
    defaultTarget,
    monthlyTarget,
    effectiveTarget: monthlyTarget || defaultTarget,
    effectiveSource: monthlyTarget ? 'monthly' : defaultTarget ? 'default' : 'unconfigured',
    audit: (auditResult.data || []).map((row: any) => ({
      ...row,
      id: Number(row.id),
      target_id: row.target_id == null ? null : Number(row.target_id),
    })),
  };
}

export async function saveFinancialTarget(input: FinancialTargetInput) {
  const { workspaceId, profile } = await requireDashboardPermissionAccess(
    'admin:financial',
    'Target Finansial',
  );
  const scope = input.scope === 'month' ? 'month' : 'default';
  const effectiveMonth = normalizeMonth(input.targetMonth);
  const effectiveMonthDate = `${effectiveMonth}-01`;
  const targetMonthDate = scope === 'month' ? effectiveMonthDate : null;
  const targetOperatingProfit = Number(input.targetOperatingProfit);

  if (!Number.isFinite(targetOperatingProfit) || targetOperatingProfit < 0) {
    throw new Error('Target laba operasional harus nol atau lebih besar.');
  }

  const svc = createServiceSupabase();
  const benchmarkBounds = weightedCm3Bounds(effectiveMonth);
  const weightedCm3Benchmark = await getWeightedCm3Benchmark(
    svc,
    workspaceId,
    benchmarkBounds,
  );
  let existingQuery = svc
    .from('workspace_financial_targets')
    .select('id')
    .eq('workspace_id', workspaceId);
  existingQuery = targetMonthDate
    ? existingQuery.eq('target_month', targetMonthDate)
    : existingQuery
        .is('target_month', null)
        .eq('effective_from', effectiveMonthDate);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw existingError;

  const payload = {
    workspace_id: workspaceId,
    target_month: targetMonthDate,
    effective_from: effectiveMonthDate,
    target_operating_profit: targetOperatingProfit,
    planned_cm3_margin: weightedCm3Benchmark.margin,
    target_revenue_override: null,
    notes: String(input.notes || '').trim() || null,
    updated_by: profile.id,
  };

  const result = existing
    ? await svc
        .from('workspace_financial_targets')
        .update(payload)
        .eq('id', existing.id)
        .eq('workspace_id', workspaceId)
        .select('id')
        .single()
    : await svc
        .from('workspace_financial_targets')
        .insert({ ...payload, created_by: profile.id })
        .select('id')
        .single();

  if (result.error) throw result.error;
  revalidatePath('/dashboard/financial-settings');
  revalidatePath('/dashboard/sales-channel-analysis');
  return { success: true, id: Number(result.data.id) };
}

export async function deleteMonthlyFinancialTarget(targetMonth: string) {
  const { workspaceId } = await requireDashboardPermissionAccess(
    'admin:financial',
    'Target Finansial',
  );
  const month = normalizeMonth(targetMonth);
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('workspace_financial_targets')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('target_month', `${month}-01`);
  if (error) throw error;

  revalidatePath('/dashboard/financial-settings');
  revalidatePath('/dashboard/sales-channel-analysis');
  return { success: true };
}
