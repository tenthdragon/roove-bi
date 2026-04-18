import { parseGoogleSheet } from './google-sheets';
import { createServiceSupabase } from './service-supabase';

type DailyAdsPeriod = {
  month: number;
  year: number;
};

type DailyAdsConnectionResult = {
  spreadsheet_id: string;
  label: string;
  success: boolean;
  period?: DailyAdsPeriod;
  counts?: {
    ads: number;
    skipped_meta: number;
  };
  error?: string;
};

export type DailyAdsSyncResult = {
  message: string;
  synced: number;
  failed: number;
  rows_inserted: number;
  results: DailyAdsConnectionResult[];
};

export async function runDailyAdsSync(): Promise<DailyAdsSyncResult> {
  const svc = createServiceSupabase();

  const { data: connections, error: connError } = await svc
    .from('sheet_connections')
    .select('*')
    .eq('is_active', true);

  if (connError) throw connError;
  if (!connections || connections.length === 0) {
    return {
      message: 'No active sheet connections',
      synced: 0,
      failed: 0,
      rows_inserted: 0,
      results: [],
    };
  }

  const { data: brands, error: brandsError } = await svc
    .from('brands')
    .select('name, sheet_name')
    .eq('is_active', true);

  if (brandsError) throw brandsError;
  const brandList = brands || [];

  const results: DailyAdsConnectionResult[] = [];
  let rowsInserted = 0;

  for (const conn of connections) {
    let importTarget: { filename: string; periodMonth: number; periodYear: number } | null = null;

    try {
      console.log(`Syncing ads from spreadsheet: ${conn.spreadsheet_id} (${conn.label})`);

      const parsed = await parseGoogleSheet(conn.spreadsheet_id, brandList, { adsOnly: true });

      if (!parsed.period.month || !parsed.period.year) {
        results.push({
          spreadsheet_id: conn.spreadsheet_id,
          label: conn.label,
          success: false,
          error: 'Could not detect period from sheet',
        });
        continue;
      }

      const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
      const lastDay = new Date(parsed.period.year, parsed.period.month, 0).getDate();
      const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const delResult = await svc
        .from('daily_ads_spend')
        .delete()
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .eq('data_source', 'google_sheets');
      if (delResult.error) {
        throw new Error(`Delete daily_ads_spend: ${delResult.error.message}`);
      }

      const { data: metaAccounts, error: metaAccountsError } = await svc
        .from('meta_ad_accounts')
        .select('account_name')
        .eq('is_active', true);
      if (metaAccountsError) {
        throw new Error(`Load meta_ad_accounts: ${metaAccountsError.message}`);
      }

      const metaManagedNames = new Set(
        (metaAccounts || []).map((account: { account_name: string }) => account.account_name)
      );

      const filteredAds = parsed.ads.filter(
        (row: { ad_account: string }) => !metaManagedNames.has(row.ad_account)
      );

      const skippedCount = parsed.ads.length - filteredAds.length;
      if (skippedCount > 0) {
        console.log(`[sync] Skipped ${skippedCount} rows already managed by Meta API`);
      }

      importTarget = {
        filename: `gsheet:${conn.spreadsheet_id}`,
        periodMonth: parsed.period.month,
        periodYear: parsed.period.year,
      };

      const upsertResult = await svc.from('data_imports').upsert({
        filename: importTarget.filename,
        period_month: importTarget.periodMonth,
        period_year: importTarget.periodYear,
        imported_by: conn.created_by,
        row_count: filteredAds.length,
        status: 'processing',
        notes: `Ads sync from Google Sheet: ${conn.label}${skippedCount > 0 ? ` (${skippedCount} rows skipped — managed by Meta API)` : ''}`,
      }, { onConflict: 'period_month,period_year,filename' });
      if (upsertResult.error) {
        throw new Error(`Upsert data_imports: ${upsertResult.error.message}`);
      }

      if (filteredAds.length > 0) {
        for (let i = 0; i < filteredAds.length; i += 500) {
          const batch = filteredAds.slice(i, i + 500);
          const { error } = await svc.from('daily_ads_spend').insert(batch);
          if (error) throw error;
          rowsInserted += batch.length;
        }
      }

      await svc.from('data_imports').update({
        status: 'completed',
        row_count: filteredAds.length,
      }).eq('filename', importTarget.filename)
        .eq('period_month', importTarget.periodMonth)
        .eq('period_year', importTarget.periodYear);

      const syncMsg = skippedCount > 0
        ? `Synced ${filteredAds.length} ad rows (${skippedCount} skipped — Meta API managed)`
        : `Synced ${filteredAds.length} ad rows`;
      await svc.from('sheet_connections').update({
        last_synced: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: syncMsg,
      }).eq('id', conn.id);

      results.push({
        spreadsheet_id: conn.spreadsheet_id,
        label: conn.label,
        success: true,
        period: parsed.period,
        counts: { ads: filteredAds.length, skipped_meta: skippedCount },
      });
    } catch (err: any) {
      console.error(`Sync failed for ${conn.spreadsheet_id}:`, err);

      if (importTarget) {
        await svc.from('data_imports').update({
          status: 'failed',
          notes: err.message || 'Unknown error',
        }).eq('filename', importTarget.filename)
          .eq('period_month', importTarget.periodMonth)
          .eq('period_year', importTarget.periodYear);
      }

      await svc.from('sheet_connections').update({
        last_synced: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_message: err.message || 'Unknown error',
      }).eq('id', conn.id);

      results.push({
        spreadsheet_id: conn.spreadsheet_id,
        label: conn.label,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    message: 'Daily ads sync completed',
    synced: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    rows_inserted: rowsInserted,
    results,
  };
}
