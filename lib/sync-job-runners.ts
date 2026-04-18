import { runDailyAdsSync } from './daily-ads-sync-runner';
import { triggerFinancialSync } from './financial-actions';
import { runMetaSync } from './meta-sync-runner';
import { runScalevSync, type ScalevSyncMode } from './scalev-sync-runner';
import { type SyncJobRecord } from './sync-jobs';
import { triggerWarehouseSync } from './warehouse-actions';

export type SyncJobExecutionResult = {
  status: 'success' | 'partial' | 'failed';
  rowsProcessed: number | null;
  resultSummary: Record<string, any>;
};

function getAggregateStatus(successCount: number, failedCount: number) {
  if (failedCount === 0) return 'success';
  if (successCount > 0) return 'partial';
  return 'failed';
}

export async function executeSyncJob(job: SyncJobRecord): Promise<SyncJobExecutionResult> {
  switch (job.job_name) {
    case 'daily_ads_sync': {
      const result = await runDailyAdsSync();
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: result.rows_inserted,
        resultSummary: result,
      };
    }

    case 'meta_sync': {
      const payload = job.payload || {};
      const result = await runMetaSync({
        dateStart: typeof payload.date_start === 'string' ? payload.date_start : null,
        dateEnd: typeof payload.date_end === 'string' ? payload.date_end : null,
      });
      return {
        status: result.status,
        rowsProcessed: result.rows_inserted,
        resultSummary: result,
      };
    }

    case 'financial_sync': {
      const result = await triggerFinancialSync({ skipAuth: true });
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: Array.isArray(result.results) ? result.results.length : 0,
        resultSummary: result,
      };
    }

    case 'warehouse_sync': {
      const result = await triggerWarehouseSync({ skipAuth: true });
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: Array.isArray(result.results) ? result.results.length : 0,
        resultSummary: result,
      };
    }

    case 'scalev_sync': {
      const payload = job.payload || {};
      const orderIds = Array.isArray(payload.order_ids)
        ? payload.order_ids.filter((value): value is string => typeof value === 'string')
        : null;
      const result = await runScalevSync({
        syncMode: (typeof payload.mode === 'string' ? payload.mode : 'full') as ScalevSyncMode,
        targetDate: typeof payload.date === 'string' ? payload.date : null,
        targetOrderIds: orderIds,
      });
      return {
        status: result.orders_errored > 0 ? (result.orders_updated + result.orders_still_pending > 0 ? 'partial' : 'failed') : 'success',
        rowsProcessed: result.pending_checked,
        resultSummary: result,
      };
    }
  }
}
