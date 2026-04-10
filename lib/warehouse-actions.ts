// lib/warehouse-actions.ts
'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import { parseWarehouseSheet } from './warehouse-parser';

// ============================================================
// SHEET CONNECTION MANAGEMENT
// ============================================================

export async function getWarehouseConnections() {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_sheet_connections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addWarehouseConnection(spreadsheetId: string, label: string, warehouseName: string) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_sheet_connections')
    .insert({ spreadsheet_id: spreadsheetId, label, warehouse_name: warehouseName, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeWarehouseConnection(id: string) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_sheet_connections')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function toggleWarehouseConnection(id: string, isActive: boolean) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_sheet_connections')
    .update({ is_active: !isActive })
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// SYNC
// ============================================================

export async function triggerWarehouseSync() {
  const svc = createServiceSupabase();

  const { data: connections, error: connError } = await svc
    .from('warehouse_sheet_connections')
    .select('*')
    .eq('is_active', true);

  if (connError) throw connError;
  if (!connections || connections.length === 0) {
    return { message: 'No active warehouse sheet connections', synced: 0, failed: 0, results: [] };
  }

  const results: Array<{
    label: string;
    success: boolean;
    error?: string;
    summaryRows?: number;
    dailyRows?: number;
    soRows?: number;
  }> = [];

  for (const conn of connections) {
    try {
      console.log(`[Warehouse Sync] Parsing ${conn.label} (${conn.spreadsheet_id})`);

      const parsed = await parseWarehouseSheet(conn.spreadsheet_id);
      const warehouse = parsed.warehouse || conn.warehouse_name;

      if (parsed.errors.length > 0) {
        console.warn(`[Warehouse Sync] Warnings for ${conn.label}:`, parsed.errors);
      }

      // --- UPSERT SUMMARY ---
      if (parsed.summary.length > 0) {
        // Delete existing data for this warehouse + period
        await svc
          .from('warehouse_stock_summary')
          .delete()
          .eq('warehouse', warehouse)
          .eq('period_month', parsed.period.month)
          .eq('period_year', parsed.period.year);

        // Insert in batches of 200
        for (let i = 0; i < parsed.summary.length; i += 200) {
          const batch = parsed.summary.slice(i, i + 200).map(r => ({
            warehouse,
            period_month: parsed.period.month,
            period_year: parsed.period.year,
            product_name: r.product_name,
            category: r.category,
            first_day_stock: r.first_day_stock,
            total_in: r.total_in,
            total_out: r.total_out,
            last_day_stock: r.last_day_stock,
            expired_date: r.expired_date,
            price_list: r.price_list,
            sub_total_value: r.sub_total_value,
          }));
          const { error: insertErr } = await svc.from('warehouse_stock_summary').insert(batch);
          if (insertErr) throw insertErr;
        }
      }

      // --- UPSERT DAILY ---
      if (parsed.daily.length > 0) {
        // Delete existing daily data for this warehouse + period
        const firstDate = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
        const lastDate = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-31`;
        await svc
          .from('warehouse_daily_stock')
          .delete()
          .eq('warehouse', warehouse)
          .gte('date', firstDate)
          .lte('date', lastDate);

        for (let i = 0; i < parsed.daily.length; i += 200) {
          const batch = parsed.daily.slice(i, i + 200).map(r => ({
            warehouse,
            date: r.date,
            product_name: r.product_name,
            category: r.category,
            stock_in: r.stock_in,
            stock_out: r.stock_out,
          }));
          const { error: insertErr } = await svc.from('warehouse_daily_stock').insert(batch);
          if (insertErr) throw insertErr;
        }
      }

      // --- UPSERT STOCK OPNAME ---
      if (parsed.stockOpname.length > 0) {
        // Delete existing SO data for dates found
        const soDates = Array.from(new Set(parsed.stockOpname.map(r => r.opname_date)));
        for (const dt of soDates) {
          await svc
            .from('warehouse_stock_opname')
            .delete()
            .eq('warehouse', warehouse)
            .eq('opname_date', dt);
        }

        for (let i = 0; i < parsed.stockOpname.length; i += 200) {
          const batch = parsed.stockOpname.slice(i, i + 200).map(r => ({
            warehouse,
            opname_date: r.opname_date,
            opname_label: r.opname_label,
            product_name: r.product_name,
            category: r.category,
            sebelum_so: r.sebelum_so,
            sesudah_so: r.sesudah_so,
            selisih: r.selisih,
          }));
          const { error: insertErr } = await svc.from('warehouse_stock_opname').insert(batch);
          if (insertErr) throw insertErr;
        }
      }

      // Update connection status
      await svc
        .from('warehouse_sheet_connections')
        .update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_message: `Summary: ${parsed.summary.length}, Daily: ${parsed.daily.length}, SO: ${parsed.stockOpname.length} rows. Period: ${parsed.period.month}/${parsed.period.year}${parsed.errors.length ? `. Warnings: ${parsed.errors.join('; ')}` : ''}`,
        })
        .eq('id', conn.id);

      results.push({
        label: conn.label,
        success: true,
        summaryRows: parsed.summary.length,
        dailyRows: parsed.daily.length,
        soRows: parsed.stockOpname.length,
      });

    } catch (e: any) {
      console.error(`[Warehouse Sync] Error for ${conn.label}:`, e);

      await svc
        .from('warehouse_sheet_connections')
        .update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_message: e.message || 'Unknown error',
        })
        .eq('id', conn.id);

      results.push({
        label: conn.label,
        success: false,
        error: e.message,
      });
    }
  }

  return {
    message: 'Warehouse sync completed',
    synced: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}

// ============================================================
// DATA FETCH (for dashboard)
// ============================================================

export async function getWarehouseSummary(month: number, year: number) {
  await requireDashboardTabAccess('warehouse', 'Summary Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_summary')
    .select('*')
    .eq('period_month', month)
    .eq('period_year', year)
    .order('category')
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseDailyStock(month: number, year: number) {
  await requireDashboardTabAccess('warehouse', 'Daily Stock Gudang');
  const svc = createServiceSupabase();
  const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = `${year}-${String(month).padStart(2, '0')}-31`;
  const { data, error } = await svc
    .from('warehouse_daily_stock')
    .select('*')
    .gte('date', firstDate)
    .lte('date', lastDate)
    .order('date')
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseStockOpname() {
  await requireDashboardTabAccess('warehouse', 'Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_opname')
    .select('*')
    .order('opname_date', { ascending: false })
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseSOSummary() {
  await requireDashboardTabAccess('warehouse', 'Ringkasan Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_warehouse_so_summary')
    .select('*')
    .order('opname_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWarehouseExpiring() {
  await requireDashboardTabAccess('warehouse', 'Batch & Expiry');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_warehouse_expiring')
    .select('*')
    .order('expired_date');
  if (error) throw error;
  return data || [];
}

export async function getWarehouseAvailablePeriods() {
  await requireDashboardTabAccess('warehouse', 'Periode Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_summary')
    .select('period_month, period_year')
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
