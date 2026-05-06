import { parseGoogleSheet } from './google-sheets';
import { createServiceSupabase } from './service-supabase';

type DailyAdsPeriod = {
  month: number;
  year: number;
};

type DailyAdsRow = {
  date: string;
  ad_account: string;
  spent: number;
  objective?: string | null;
  source?: string | null;
  store?: string | null;
  advertiser?: string | null;
  data_source?: string | null;
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

function normalizeSyncValue(value: unknown) {
  return String(value || '').trim();
}

export function getAdsDateRange(rows: Array<Pick<DailyAdsRow, 'date'>>) {
  const dates = rows
    .map((row) => normalizeSyncValue(row.date))
    .filter(Boolean)
    .sort();

  if (dates.length === 0) return null;

  return {
    start: dates[0],
    end: dates[dates.length - 1],
  };
}

function getUniqueAdsDates(rows: Array<Pick<DailyAdsRow, 'date'>>) {
  return Array.from(new Set(
    rows
      .map((row) => normalizeSyncValue(row.date))
      .filter(Boolean),
  )).sort();
}

export function getImportPeriodFromAds(rows: Array<Pick<DailyAdsRow, 'date'>>): DailyAdsPeriod | null {
  const range = getAdsDateRange(rows);
  if (!range) return null;

  const [yearText, monthText] = range.end.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { month, year };
}

export function dedupeAdsRows<T extends DailyAdsRow>(rows: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const row of rows) {
    const key = [
      normalizeSyncValue(row.date),
      normalizeSyncValue(row.ad_account),
      Number(row.spent || 0),
      normalizeSyncValue(row.objective),
      normalizeSyncValue(row.source),
      normalizeSyncValue(row.store),
      normalizeSyncValue(row.advertiser),
      normalizeSyncValue(row.data_source),
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

async function deleteExistingGoogleSheetRows(
  rows: DailyAdsRow[],
) {
  const dates = getUniqueAdsDates(rows);
  if (dates.length === 0) return;

  const svc = createServiceSupabase();
  const adAccounts = Array.from(new Set(
    rows
      .map((row) => normalizeSyncValue(row.ad_account))
      .filter(Boolean),
  ));

  const blankAccountScopes = Array.from(new Map(
    rows
      .filter((row) => !normalizeSyncValue(row.ad_account))
      .map((row) => {
        const source = normalizeSyncValue(row.source);
        const store = normalizeSyncValue(row.store);
        return [`${source}|${store}`, { source, store }];
      }),
  ).values());

  const accountBatchSize = 200;
  const dateBatchSize = 31;

  for (let dateIndex = 0; dateIndex < dates.length; dateIndex += dateBatchSize) {
    const dateBatch = dates.slice(dateIndex, dateIndex + dateBatchSize);

    for (let accountIndex = 0; accountIndex < adAccounts.length; accountIndex += accountBatchSize) {
      const accountBatch = adAccounts.slice(accountIndex, accountIndex + accountBatchSize);
      const { error } = await svc
        .from('daily_ads_spend')
        .delete()
        .eq('data_source', 'google_sheets')
        .in('date', dateBatch)
        .in('ad_account', accountBatch);

      if (error) {
        throw new Error(`Delete daily_ads_spend existing ad accounts: ${error.message}`);
      }
    }
  }

  for (const scope of blankAccountScopes) {
    for (let dateIndex = 0; dateIndex < dates.length; dateIndex += dateBatchSize) {
      const dateBatch = dates.slice(dateIndex, dateIndex + dateBatchSize);
      const { error } = await svc
        .from('daily_ads_spend')
        .delete()
        .eq('data_source', 'google_sheets')
        .in('date', dateBatch)
        .eq('ad_account', '')
        .eq('source', scope.source)
        .eq('store', scope.store);

      if (error) {
        throw new Error(`Delete daily_ads_spend blank-account scope: ${error.message}`);
      }
    }
  }
}

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

  const orderedConnections = [...connections].sort((left: any, right: any) => {
    const leftTime = Date.parse(String(left?.created_at || ''));
    const rightTime = Date.parse(String(right?.created_at || ''));
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return String(right?.id || '').localeCompare(String(left?.id || ''));
  });

  for (const conn of orderedConnections) {
    let importTarget: { filename: string; periodMonth: number; periodYear: number } | null = null;

    try {
      console.log(`Syncing ads from spreadsheet: ${conn.spreadsheet_id} (${conn.label})`);

      const parsed = await parseGoogleSheet(conn.spreadsheet_id, brandList, { adsOnly: true });
      const deleteScopeRows = parsed.ads.map((row) => ({
        ...row,
        data_source: 'google_sheets',
      }));
      const importPeriod = getImportPeriodFromAds(deleteScopeRows);
      const importRange = getAdsDateRange(deleteScopeRows);

      if (!importPeriod || !importRange) {
        results.push({
          spreadsheet_id: conn.spreadsheet_id,
          label: conn.label,
          success: false,
          error: 'Could not detect ad date range from sheet',
        });
        continue;
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

      await deleteExistingGoogleSheetRows(deleteScopeRows);

      const filteredAds = parsed.ads
        .filter((row: { ad_account: string }) => !metaManagedNames.has(row.ad_account))
        .map((row) => ({
          ...row,
          data_source: 'google_sheets',
        }));

      const dedupedAds = dedupeAdsRows(filteredAds);

      const skippedCount = parsed.ads.length - filteredAds.length;
      const duplicateCount = filteredAds.length - dedupedAds.length;
      if (skippedCount > 0) {
        console.log(`[sync] Skipped ${skippedCount} rows already managed by Meta API`);
      }
      if (duplicateCount > 0) {
        console.log(`[sync] Dropped ${duplicateCount} duplicate rows already present in the sheet payload`);
      }

      importTarget = {
        filename: `gsheet:${conn.spreadsheet_id}`,
        periodMonth: importPeriod.month,
        periodYear: importPeriod.year,
      };

      const upsertResult = await svc.from('data_imports').upsert({
        filename: importTarget.filename,
        period_month: importTarget.periodMonth,
        period_year: importTarget.periodYear,
        imported_by: conn.created_by,
        row_count: dedupedAds.length,
        status: 'processing',
        notes: `Ads sync from Google Sheet: ${conn.label}. Range: ${importRange.start} to ${importRange.end}${skippedCount > 0 ? ` (${skippedCount} rows skipped — managed by Meta API)` : ''}${duplicateCount > 0 ? ` (${duplicateCount} duplicate rows dropped)` : ''}`,
      }, { onConflict: 'period_month,period_year,filename' });
      if (upsertResult.error) {
        throw new Error(`Upsert data_imports: ${upsertResult.error.message}`);
      }

      if (dedupedAds.length > 0) {
        for (let i = 0; i < dedupedAds.length; i += 500) {
          const batch = dedupedAds.slice(i, i + 500);
          const { error } = await svc.from('daily_ads_spend').insert(batch);
          if (error) throw error;
          rowsInserted += batch.length;
        }
      }

      await svc.from('data_imports').update({
        status: 'completed',
        row_count: dedupedAds.length,
      }).eq('filename', importTarget.filename)
        .eq('period_month', importTarget.periodMonth)
        .eq('period_year', importTarget.periodYear);

      const syncMsg = skippedCount > 0
        ? `Synced ${dedupedAds.length} ad rows (${skippedCount} skipped — Meta API managed${duplicateCount > 0 ? `, ${duplicateCount} duplicate dropped` : ''})`
        : duplicateCount > 0
          ? `Synced ${dedupedAds.length} ad rows (${duplicateCount} duplicate dropped)`
          : `Synced ${dedupedAds.length} ad rows`;
      await svc.from('sheet_connections').update({
        last_synced: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: syncMsg,
      }).eq('id', conn.id);

      results.push({
        spreadsheet_id: conn.spreadsheet_id,
        label: conn.label,
        success: true,
        period: importPeriod,
        counts: { ads: dedupedAds.length, skipped_meta: skippedCount },
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
