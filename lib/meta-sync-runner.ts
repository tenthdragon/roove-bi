import {
  fetchAllAccountsInsights,
  checkTokenHealth,
  getYesterdayWIB,
  type MetaAdAccount,
} from './meta-marketing';
import { createServiceSupabase } from './service-supabase';

export type MetaSyncResult = {
  success: boolean;
  status: 'success' | 'partial' | 'failed';
  accounts_synced: number;
  accounts_total: number;
  rows_inserted: number;
  date_range: { start: string; end: string };
  duration_ms: number;
  token_warning: string | null;
  errors?: string[];
  message?: string;
};

type RunMetaSyncOptions = {
  dateStart?: string | null;
  dateEnd?: string | null;
};

export async function runMetaSync(options: RunMetaSyncOptions = {}): Promise<MetaSyncResult> {
  const startTime = Date.now();
  const svc = createServiceSupabase();
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('META_ACCESS_TOKEN not configured');
  }

  const dateStart = options.dateStart || getYesterdayWIB();
  const dateEnd = options.dateEnd || dateStart;

  let tokenWarning: string | null = null;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (appId && appSecret) {
    const health = await checkTokenHealth(accessToken, appId, appSecret);
    if (health) {
      tokenWarning = health.warning;
      console.warn(`[meta-sync] Token warning: ${health.warning}`);
    }
  }

  const { data: accounts, error: accountsError } = await svc
    .from('meta_ad_accounts')
    .select('*')
    .eq('is_active', true);

  if (accountsError) throw accountsError;
  if (!accounts || accounts.length === 0) {
    return {
      success: true,
      status: 'success',
      accounts_synced: 0,
      accounts_total: 0,
      rows_inserted: 0,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: Date.now() - startTime,
      token_warning: tokenWarning,
      message: 'No active Meta ad accounts configured',
    };
  }

  let logId: number | null = null;
  const { data: logEntry, error: logError } = await svc
    .from('meta_sync_log')
    .insert({
      sync_date: new Date().toISOString().split('T')[0],
      date_range_start: dateStart,
      date_range_end: dateEnd,
      status: 'running',
    })
    .select('id')
    .single();

  if (logError) {
    console.error('[meta-sync] Failed to create log entry:', logError);
  }
  logId = logEntry?.id ?? null;

  try {
    console.log(`[meta-sync] Fetching insights for ${accounts.length} accounts, range: ${dateStart} to ${dateEnd}`);

    const results = await fetchAllAccountsInsights(
      accounts as MetaAdAccount[],
      dateStart,
      dateEnd,
      accessToken
    );

    const errors: string[] = [];
    let accountsSynced = 0;
    let rowsInserted = 0;

    for (const result of results) {
      if (result.error) {
        errors.push(`${result.account_name}: ${result.error}`);
        continue;
      }

      const { error: delError } = await svc
        .from('daily_ads_spend')
        .delete()
        .gte('date', dateStart)
        .lte('date', dateEnd)
        .eq('data_source', 'meta_api')
        .eq('ad_account', result.account_name);

      if (delError) {
        console.error(`[meta-sync] Delete error for ${result.account_name}:`, delError);
        errors.push(`Delete ${result.account_name}: ${delError.message}`);
        continue;
      }

      let accountInsertFailed = false;
      for (let i = 0; i < result.rows.length; i += 500) {
        const batch = result.rows.slice(i, i + 500);
        const { error } = await svc.from('daily_ads_spend').insert(batch);
        if (error) {
          console.error(`[meta-sync] Insert batch error for ${result.account_name}:`, error);
          errors.push(`Insert ${result.account_name} batch ${Math.floor(i / 500) + 1}: ${error.message}`);
          accountInsertFailed = true;
          break;
        }
        rowsInserted += batch.length;
      }

      if (!accountInsertFailed) {
        accountsSynced++;
      }
    }

    const duration = Date.now() - startTime;
    const status: MetaSyncResult['status'] = errors.length === 0
      ? 'success'
      : accountsSynced > 0
        ? 'partial'
        : 'failed';

    if (logId) {
      await svc.from('meta_sync_log').update({
        accounts_synced: accountsSynced,
        rows_inserted: rowsInserted,
        status,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        duration_ms: duration,
      }).eq('id', logId);
    }

    console.log(`[meta-sync] Done: ${accountsSynced}/${accounts.length} accounts, ${rowsInserted} rows, ${duration}ms`);

    return {
      success: status !== 'failed',
      status,
      accounts_synced: accountsSynced,
      accounts_total: accounts.length,
      rows_inserted: rowsInserted,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: duration,
      token_warning: tokenWarning,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('[meta-sync] Fatal error:', err);

    const payload = {
      sync_date: new Date().toISOString().split('T')[0],
      date_range_start: dateStart,
      date_range_end: dateEnd,
      status: 'failed',
      error_message: err.message,
      duration_ms: duration,
    };

    try {
      if (logId) {
        await svc.from('meta_sync_log').update(payload).eq('id', logId);
      } else {
        await svc.from('meta_sync_log').insert(payload);
      }
    } catch {}

    throw err;
  }
}
