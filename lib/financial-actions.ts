// lib/financial-actions.ts
'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardRoles, requireDashboardTabAccess } from './dashboard-access';
import { runFinancialSync } from './financial-sync-runner';

async function requireFinancialAdminAccess(label: string) {
  return requireDashboardPermissionAccess('admin:financial', label);
}

// ============================================================
// SHEET CONNECTION MANAGEMENT
// ============================================================

export async function getFinancialConnections() {
  const { workspaceId } = await requireFinancialAdminAccess('Admin Financial');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('financial_sheet_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addFinancialConnection(spreadsheetId: string, label: string) {
  const { workspaceId } = await requireFinancialAdminAccess('Admin Financial');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('financial_sheet_connections')
    .insert({ workspace_id: workspaceId, spreadsheet_id: spreadsheetId, label, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeFinancialConnection(id: string) {
  const { workspaceId } = await requireFinancialAdminAccess('Admin Financial');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('financial_sheet_connections')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function toggleFinancialConnection(id: string, isActive: boolean) {
  const { workspaceId } = await requireFinancialAdminAccess('Admin Financial');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('financial_sheet_connections')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

// ============================================================
// SYNC
// ============================================================

export async function triggerFinancialSync() {
  const { workspaceId } = await requireFinancialAdminAccess('Admin Financial');
  return runFinancialSync(workspaceId);
}

// ============================================================
// DATA FETCH (for dashboard & AI analysis)
// ============================================================

export async function getFinancialPLSummary(months?: number) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  let query = svc.from('v_pl_summary').select('*').eq('workspace_id', workspaceId).order('month', { ascending: false });
  if (months) query = query.limit(months);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getFinancialCFSummary(months?: number) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  let query = svc.from('v_cf_summary').select('*').eq('workspace_id', workspaceId).order('month', { ascending: false });
  if (months) query = query.limit(months);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getFinancialRatios(months?: number) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  let query = svc.from('financial_ratios_monthly').select('*').eq('workspace_id', workspaceId).order('month', { ascending: false });
  if (months) query = query.limit(months * 12); // ~12 ratios per month
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getFinancialPLDetail(month: string) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('financial_pl_monthly')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('month', month)
    .order('section');
  if (error) throw error;
  return data || [];
}

export async function getFinancialCFDetail(month: string) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('financial_cf_monthly')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('month', month)
    .order('section');
  if (error) throw error;
  return data || [];
}

async function requireFinancialAiAccess() {
  return requireDashboardRoles(['owner'], 'Hanya owner yang bisa menggunakan AI Finance Analysis.');
}

export async function getLatestFinancialAnalysis() {
  const { workspaceId } = await requireFinancialAiAccess();
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('financial_analyses')
    .select('analysis_data, created_at')
    .eq('workspace_id', workspaceId)
    .eq('analysis_type', 'executive')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// For AI analysis — get comprehensive data
export async function getFinancialDataForAI(numMonths: number = 3) {
  await requireDashboardTabAccess('finance', 'Finance Analysis');
  const [pl, cf, ratios, bs] = await Promise.all([
    getFinancialPLSummary(numMonths),
    getFinancialCFSummary(numMonths),
    getFinancialRatios(numMonths),
    getFinancialBS(numMonths),
  ]);
  return { pl, cf, ratios, bs };
}

export async function getFinancialBS(months?: number) {
  const { workspaceId } = await requireDashboardTabAccess('finance', 'Finance Analysis');
  const svc = createServiceSupabase();
  let query = svc
    .from('financial_bs_monthly')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('month', { ascending: false });
  if (months) query = query.limit(months * 18); // ~18 line items per month
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
