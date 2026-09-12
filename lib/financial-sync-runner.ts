import { parseFinancialReport } from './financial-parser';
import { createServiceSupabase } from './service-supabase';
import { requireExplicitWorkspaceId } from './workspace-scope';

async function deleteFinancialMonthOrThrow(svc: any, table: string, workspaceId: string, month: string) {
  const { error } = await svc
    .from(table)
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('month', month);
  if (error) {
    throw new Error(`Delete ${table} ${month}: ${error.message}`);
  }
}

export async function runFinancialSync(workspaceIdInput: string) {
  const workspaceId = requireExplicitWorkspaceId(workspaceIdInput, 'Financial sync');
  const svc = createServiceSupabase();

  const { data: connections, error: connError } = await svc
    .from('financial_sheet_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  if (connError) throw connError;
  if (!connections || connections.length === 0) {
    return { message: 'No active financial sheet connections', synced: 0, failed: 0, results: [] };
  }

  const results: Array<{
    label: string;
    success: boolean;
    error?: string;
    plRows?: number;
    cfRows?: number;
    ratioRows?: number;
    bsRows?: number;
    months?: string[];
  }> = [];

  for (const conn of connections) {
    try {
      console.log(`[Financial Sync] Parsing ${conn.label} (${conn.spreadsheet_id})`);

      const parsed = await parseFinancialReport(conn.spreadsheet_id);

      if (parsed.errors.length > 0) {
        console.warn(`[Financial Sync] Warnings for ${conn.label}:`, parsed.errors);
      }

      // --- UPSERT PL ---
      if (parsed.pl.length > 0) {
        // Delete existing data for months found, then insert
        const plMonths = Array.from(new Set(parsed.pl.map(r => r.month)));
        for (const month of plMonths) {
          await deleteFinancialMonthOrThrow(svc, 'financial_pl_monthly', workspaceId, month);
        }
        // Insert in batches of 200
        for (let i = 0; i < parsed.pl.length; i += 200) {
          const batch = parsed.pl.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
            month: r.month,
            line_item: r.line_item,
            line_item_label: r.line_item_label,
            section: r.section,
            amount: r.amount,
            pct_sales: r.pct_sales,
            pct_net_sales: r.pct_net_sales,
          }));
          const { error: insertErr } = await svc.from('financial_pl_monthly').insert(batch);
          if (insertErr) {
            console.error(`[Financial Sync] PL insert error:`, insertErr);
            throw insertErr;
          }
        }
      }

      // --- UPSERT CF ---
      if (parsed.cf.length > 0) {
        const cfMonths = Array.from(new Set(parsed.cf.map(r => r.month)));
        for (const month of cfMonths) {
          await deleteFinancialMonthOrThrow(svc, 'financial_cf_monthly', workspaceId, month);
        }
        for (let i = 0; i < parsed.cf.length; i += 200) {
          const batch = parsed.cf.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
            month: r.month,
            section: r.section,
            line_item: r.line_item,
            line_item_label: r.line_item_label,
            sub_section: r.sub_section,
            amount: r.amount,
          }));
          const { error: insertErr } = await svc.from('financial_cf_monthly').insert(batch);
          if (insertErr) {
            console.error(`[Financial Sync] CF insert error:`, insertErr);
            throw insertErr;
          }
        }
      }

      // --- UPSERT RATIOS ---
      if (parsed.ratios.length > 0) {
        const ratioMonths = Array.from(new Set(parsed.ratios.map(r => r.month)));
        for (const month of ratioMonths) {
          await deleteFinancialMonthOrThrow(svc, 'financial_ratios_monthly', workspaceId, month);
        }
        const { error: insertErr } = await svc
          .from('financial_ratios_monthly')
          .insert(parsed.ratios.map(r => ({
            workspace_id: workspaceId,
            month: r.month,
            ratio_name: r.ratio_name,
            ratio_label: r.ratio_label,
            category: r.category,
            value: r.value,
            benchmark_min: r.benchmark_min,
            benchmark_max: r.benchmark_max,
            benchmark_label: r.benchmark_label,
          })));
        if (insertErr) {
          console.error(`[Financial Sync] Ratios insert error:`, insertErr);
          throw insertErr;
        }
      }

      // --- UPSERT BS ---
      if (parsed.bs.length > 0) {
        const bsMonths = Array.from(new Set(parsed.bs.map(r => r.month)));
        for (const month of bsMonths) {
          await deleteFinancialMonthOrThrow(svc, 'financial_bs_monthly', workspaceId, month);
        }
        for (let i = 0; i < parsed.bs.length; i += 200) {
          const batch = parsed.bs.slice(i, i + 200).map(r => ({
            workspace_id: workspaceId,
            month: r.month,
            line_item: r.line_item,
            line_item_label: r.line_item_label,
            section: r.section,
            amount: r.amount,
            pct_of_asset: r.pct_of_asset,
          }));
          const { error: insertErr } = await svc.from('financial_bs_monthly').insert(batch);
          if (insertErr) {
            console.error(`[Financial Sync] BS insert error:`, insertErr);
            throw insertErr;
          }
        }
      }

      // Update connection status
      await svc
        .from('financial_sheet_connections')
        .update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_message: `PL: ${parsed.pl.length} rows, CF: ${parsed.cf.length} rows, Ratios: ${parsed.ratios.length} rows, BS: ${parsed.bs.length} rows. Months: ${parsed.monthsFound.length}${parsed.errors.length ? `. Warnings: ${parsed.errors.join('; ')}` : ''}`,
        })
        .eq('id', conn.id);

      results.push({
        label: conn.label,
        success: true,
        plRows: parsed.pl.length,
        cfRows: parsed.cf.length,
        ratioRows: parsed.ratios.length,
        bsRows: parsed.bs.length,
        months: parsed.monthsFound,
      });
    } catch (e: any) {
      console.error(`[Financial Sync] Error for ${conn.label}:`, e);

      await svc
        .from('financial_sheet_connections')
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
    message: 'Financial sync completed',
    synced: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}
