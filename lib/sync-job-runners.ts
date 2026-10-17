import { runDailyAdsSync } from './daily-ads-sync-runner';
import { triggerFinancialSync } from './financial-actions';
import { runMetaSync } from './meta-sync-runner';
import { runMetaAdSync } from './meta-ad-sync-runner';
import { runMetaAdMappingSync } from './meta-ad-mapping-sync';
import { runMetaProductSetVerification } from './meta-product-set-sync';
import { metaSpendRange } from './meta-incremental-sync';
import { createServiceSupabase } from './service-supabase';
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
      if (payload.verify_shopee_product_set !== undefined || job.mode === 'meta_product_set_verify') {
        if (payload.verify_shopee_product_set !== true || payload.ad_mapping_only !== true
          || typeof payload.account_id !== 'string' || !/^act_\d+$/.test(payload.account_id)
          || typeof payload.product_set_id !== 'string' || !/^\d+$/.test(payload.product_set_id)
          || payload.creative_ad_ids !== undefined || payload.ad_funnels_only === true) throw new Error('Payload verifikasi product set tidak valid.');
        const result = await runMetaProductSetVerification({ workspaceId: job.workspace_id, accountId: payload.account_id, productSetId: payload.product_set_id });
        return { status: result.status, rowsProcessed: result.rows_inserted, resultSummary: result };
      }
      if (payload.ad_mapping_only === true) {
        if (payload.creative_ad_ids !== undefined && (!Array.isArray(payload.creative_ad_ids) || !payload.creative_ad_ids.every(id => typeof id === 'string'))) throw new Error('Payload creative mapping tidak valid.');
        const result = await runMetaAdMappingSync({ workspaceId: job.workspace_id,
          accountId: typeof payload.account_id === 'string' ? payload.account_id : undefined,
          creativeAdIds: payload.creative_ad_ids as string[] | undefined, parentJobId: job.id });
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
      const range = payload.incremental === true || job.mode === 'cron'
        ? await metaSpendRange(createServiceSupabase(), job.workspace_id) : null;
      const result = await runMetaSync({
        workspaceId: job.workspace_id,
        dateStart: range?.from || (typeof payload.date_start === 'string' ? payload.date_start : null),
        dateEnd: range?.to || (typeof payload.date_end === 'string' ? payload.date_end : null),
      });
      if (result.status !== 'success') throw new Error((result.errors || ['Meta sync incomplete']).join('; '));
      return { status: result.status, rowsProcessed: result.rows_inserted, resultSummary: result };
    }

    case 'financial_sync': {
      const result = await triggerFinancialSync({
        skipAuth: true,
        workspaceId: job.workspace_id,
      });
      return {
        status: getAggregateStatus(result.synced, result.failed),
        rowsProcessed: Array.isArray(result.results) ? result.results.length : 0,
        resultSummary: result,
      };
    }

    case 'warehouse_sync': {
      const result = await triggerWarehouseSync({
        skipAuth: true,
        workspaceId: job.workspace_id,
      });
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
