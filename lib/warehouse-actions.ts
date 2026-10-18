// lib/warehouse-actions.ts
'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { runWarehouseSync } from './warehouse-sync-runner';

async function requireWarehouseAdminAccess(label: string) {
  return requireDashboardPermissionAccess('admin:warehouse', label);
}

function getMonthDateRange(year: number, month: number) {
  const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { firstDate, lastDate };
}

// ============================================================
// SHEET CONNECTION MANAGEMENT
// ============================================================

export async function getWarehouseConnections() {
  const { workspaceId } = await requireWarehouseAdminAccess('Admin Warehouse');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_sheet_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addWarehouseConnection(spreadsheetId: string, label: string, warehouseName: string) {
  const { workspaceId } = await requireWarehouseAdminAccess('Admin Warehouse');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_sheet_connections')
    .insert({
      workspace_id: workspaceId,
      spreadsheet_id: spreadsheetId,
      label,
      warehouse_name: warehouseName,
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeWarehouseConnection(id: string) {
  const { workspaceId } = await requireWarehouseAdminAccess('Admin Warehouse');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_sheet_connections')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

export async function toggleWarehouseConnection(id: string, isActive: boolean) {
  const { workspaceId } = await requireWarehouseAdminAccess('Admin Warehouse');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_sheet_connections')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

// ============================================================
// SYNC
// ============================================================

export async function triggerWarehouseSync() {
  const { workspaceId } = await requireWarehouseAdminAccess('Admin Warehouse');
  return runWarehouseSync(workspaceId);
}

// ============================================================
// DATA FETCH (for dashboard)
// ============================================================

export async function getWarehouseSummary(month: number, year: number) {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Summary Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('period_month', month)
    .eq('period_year', year)
    .order('category')
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseDailyStock(month: number, year: number) {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Daily Stock Gudang');
  const svc = createServiceSupabase();
  const { firstDate, lastDate } = getMonthDateRange(year, month);
  const { data, error } = await svc
    .from('warehouse_daily_stock')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('date', firstDate)
    .lte('date', lastDate)
    .order('date')
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseStockOpname() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_opname')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('opname_date', { ascending: false })
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseSOSummary() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Ringkasan Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_warehouse_so_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('opname_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWarehouseExpiring() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Batch & Expiry');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_warehouse_expiring')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('expired_date');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseAvailablePeriods() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Periode Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_summary')
    .select('period_month, period_year')
    .eq('workspace_id', workspaceId)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });
  if (error) throw error;
  // Deduplicate
  const seen = new Set<string>();
  return (data || []).filter(r => {
    const key = `${r.period_year}-${r.period_month}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
