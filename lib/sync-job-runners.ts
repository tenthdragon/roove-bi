import { getTodayWIB } from './sync-schedule';
import { runDailyAdsSync } from './daily-ads-sync-runner';
import { runFinancialSync } from './financial-sync-runner';
import { runMetaSync } from './meta-sync-runner';
import { runMetaAdSync } from './meta-ad-sync-runner';
import { runMetaAdMappingSync } from './meta-ad-mapping-sync';
import { enqueueScheduledMetaAdMapping } from './meta-ad-mapping-queue';
import { enqueueScheduledMetaAdBatches } from './meta-funnel-sync-queue';
import { createServiceSupabase } from './service-supabase';
import { runScalevSync, type ScalevSyncMode } from './scalev-sync-runner';
import { type SyncJobRecord } from './sync-jobs';
import { runWarehouseSync } from './warehouse-sync-runner';

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

function parseOptionalPositiveInt(value: unknown): number | null {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function executeSyncJob(job: SyncJobRecord): Promise<SyncJobExecutionResult> {
  switch (job.job_name) {
    case 'daily_ads_sync': {
      const result = await runDailyAdsSync(job.workspace_id);
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: result.rows_inserted,
        resultSummary: result,
      };
    }

    case 'meta_sync': {
      const payload = job.payload || {};
      if (payload.ad_mapping_only === true) {
        if (payload.creative_ad_ids !== undefined && (!Array.isArray(payload.creative_ad_ids) || !payload.creative_ad_ids.every(id => typeof id === 'string'))) throw new Error('Payload creative mapping tidak valid.');
        const result = await runMetaAdMappingSync({ workspaceId: job.workspace_id,
          accountId: typeof payload.account_id === 'string' ? payload.account_id : undefined,
          creativeAdIds: payload.creative_ad_ids as string[] | undefined });
        if (result.status !== 'success') throw new Error(result.errors.join('; '));
        return { status: result.status, rowsProcessed: result.rows_inserted, resultSummary: result };
      }
      if (payload.ad_funnels_only === true) {
        const result = await runMetaAdSync({ workspaceId: job.workspace_id,
          accountId: typeof payload.account_id === 'string' ? payload.account_id : undefined,
          dateStart: typeof payload.date_start === 'string' ? payload.date_start : undefined,
          dateEnd: typeof payload.date_end === 'string' ? payload.date_end : undefined });
        if (result.status !== 'success') throw new Error(result.errors.join('; '));
        return { status: result.status, rowsProcessed: result.rows_inserted, resultSummary: result };
      }
      const result = await runMetaSync({
        workspaceId: job.workspace_id,
        dateStart: job.mode === 'cron' ? getTodayWIB() : typeof payload.date_start === 'string' ? payload.date_start : null,
        dateEnd: job.mode === 'cron' ? getTodayWIB() : typeof payload.date_end === 'string' ? payload.date_end : null,
      });
      if (result.status !== 'success') {
        throw new Error((result.errors || ['Meta sync incomplete']).join('; '));
      }
      // The existing timer runs every ten minutes. Queue ad reports once per WIB
      // day, in one-account/week batches compatible with the HTTP worker.
      const adFunnelsQueued = job.mode === 'cron'
        ? await enqueueScheduledMetaAdBatches(createServiceSupabase(), job.workspace_id) : 0;
      const adMappingsQueued = job.mode === 'cron'
        ? await enqueueScheduledMetaAdMapping(createServiceSupabase(), job.workspace_id) : 0;
      return {
        status: result.status,
        rowsProcessed: result.rows_inserted,
        resultSummary: { ...result, ad_funnels_queued: adFunnelsQueued, ad_mappings_queued: adMappingsQueued },
      };
    }

    case 'financial_sync': {
      const result = await runFinancialSync(job.workspace_id);
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: Array.isArray(result.results) ? result.results.length : 0,
        resultSummary: result,
      };
    }

    case 'warehouse_sync': {
      const result = await runWarehouseSync(job.workspace_id);
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
      const startAfterId = parseOptionalPositiveInt(payload.after_id);
      const maxPendingOrders = parseOptionalPositiveInt(payload.batch_limit);
      const result = await runScalevSync({
        workspaceId: job.workspace_id,
        syncMode: (typeof payload.mode === 'string' ? payload.mode : 'full') as ScalevSyncMode,
        targetDate: typeof payload.date === 'string' ? payload.date : null,
        targetOrderIds: orderIds,
        startAfterId,
        maxPendingOrders,
      });
      return {
        status: result.orders_errored > 0 ? (result.orders_updated + result.orders_still_pending > 0 ? 'partial' : 'failed') : 'success',
        rowsProcessed: result.pending_checked,
        resultSummary: result,
      };
    }
  }
}
