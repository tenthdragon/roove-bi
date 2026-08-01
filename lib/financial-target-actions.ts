'use server';

import { revalidatePath } from 'next/cache';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { createServiceSupabase } from './service-supabase';

export type WorkspaceFinancialTarget = {
  id: number;
  workspace_id: string;
  target_month: string | null;
  effective_from: string;
  target_operating_profit: number;
  planned_cm3_margin: number;
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
  plannedCm3MarginPercent: number;
  targetRevenueOverride?: number | null;
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

function mapTarget(row: any): WorkspaceFinancialTarget {
  return {
    ...row,
    id: Number(row.id),
    target_operating_profit: Number(row.target_operating_profit || 0),
    planned_cm3_margin: Number(row.planned_cm3_margin || 0),
    target_revenue_override: row.target_revenue_override == null
      ? null
      : Number(row.target_revenue_override),
  };
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
  const svc = createServiceSupabase();

  const [targetsResult, overheadResult, auditResult] = await Promise.all([
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
  const plannedMarginPercent = Number(input.plannedCm3MarginPercent);
  const targetRevenueOverride = input.targetRevenueOverride == null
    ? null
    : Number(input.targetRevenueOverride);

  if (!Number.isFinite(targetOperatingProfit) || targetOperatingProfit < 0) {
    throw new Error('Target laba operasional harus nol atau lebih besar.');
  }
  if (
    !Number.isFinite(plannedMarginPercent)
    || plannedMarginPercent <= 0
    || plannedMarginPercent > 100
  ) {
    throw new Error('Target margin CM3 harus lebih dari 0% dan maksimal 100%.');
  }
  if (
    targetRevenueOverride !== null
    && (!Number.isFinite(targetRevenueOverride) || targetRevenueOverride < 0)
  ) {
    throw new Error('Override target revenue tidak valid.');
  }

  const svc = createServiceSupabase();
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
    planned_cm3_margin: plannedMarginPercent / 100,
    target_revenue_override: targetRevenueOverride,
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
