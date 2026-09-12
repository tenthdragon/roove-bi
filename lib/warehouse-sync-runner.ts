import { createServiceSupabase } from './service-supabase';
import { parseWarehouseSheet } from './warehouse-parser';
import { requireExplicitWorkspaceId } from './workspace-scope';

function getMonthDateRange(year: number, month: number) {
  const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { firstDate, lastDate };
}

export async function runWarehouseSync(workspaceIdInput: string) {
  const workspaceId = requireExplicitWorkspaceId(workspaceIdInput, 'Warehouse sync');
  const svc = createServiceSupabase();

  const { data: connections, error: connError } = await svc
    .from('warehouse_sheet_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
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
        const { error: summaryDeleteError } = await svc
          .from('warehouse_stock_summary')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('warehouse', warehouse)
          .eq('period_month', parsed.period.month)
          .eq('period_year', parsed.period.year);
        if (summaryDeleteError) throw new Error(`Delete warehouse_stock_summary: ${summaryDeleteError.message}`);

        // Insert in batches of 200
        for (let i = 0; i < parsed.summary.length; i += 200) {
          const batch = parsed.summary.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
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
        const { firstDate, lastDate } = getMonthDateRange(parsed.period.year, parsed.period.month);
        const { error: dailyDeleteError } = await svc
          .from('warehouse_daily_stock')
          .delete()
          .eq('workspace_id', workspaceId)
          .eq('warehouse', warehouse)
          .gte('date', firstDate)
          .lte('date', lastDate);
        if (dailyDeleteError) throw new Error(`Delete warehouse_daily_stock: ${dailyDeleteError.message}`);

        for (let i = 0; i < parsed.daily.length; i += 200) {
          const batch = parsed.daily.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
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
          const { error: deleteSoError } = await svc
            .from('warehouse_stock_opname')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('warehouse', warehouse)
            .eq('opname_date', dt);
          if (deleteSoError) throw new Error(`Delete warehouse_stock_opname ${dt}: ${deleteSoError.message}`);
        }

        for (let i = 0; i < parsed.stockOpname.length; i += 200) {
          const batch = parsed.stockOpname.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
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
        .eq('id', conn.id)
        .eq('workspace_id', workspaceId);

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
        .eq('id', conn.id)
        .eq('workspace_id', workspaceId);

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
