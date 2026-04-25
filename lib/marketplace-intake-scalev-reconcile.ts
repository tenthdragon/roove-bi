import { fetchOrderDetail, fetchOrdersByExternalId } from './scalev-api';
import { createServiceSupabase } from './service-supabase';

const SCALEV_API_BASE_URL = 'https://api.scalev.id/v2';
const SAMPLE_LIMIT = 20;

type ReconcileBatchRow = {
  id: number;
  filename: string;
  business_id: number;
  business_code: string;
  scalev_last_send_status: string | null;
};

type ReconcileBusinessRow = {
  id: number;
  business_code: string;
  api_key: string | null;
};

type AuthoritativeOrderRow = {
  id: number;
  order_id: string;
  external_id: string | null;
  scalev_id: string | null;
  source: string | null;
  business_code: string | null;
};

type ConflictRow = {
  id: number;
  order_id: string;
  external_id: string | null;
  scalev_id: string | null;
  source: string | null;
};

export type MarketplaceIntakeScalevReconcileStatus = 'success' | 'partial' | 'failed';

export type MarketplaceIntakeScalevReconcileResult = {
  batchId: number;
  businessCode: string;
  reconciledAt: string;
  status: MarketplaceIntakeScalevReconcileStatus;
  targetCount: number;
  matchedCount: number;
  updatedCount: number;
  alreadyLinkedCount: number;
  unmatchedCount: number;
  conflictCount: number;
  errorCount: number;
  errorMessage: string | null;
  unmatchedExternalIds: string[];
  conflictExternalIds: string[];
  errorExternalIds: string[];
};

export type MarketplaceIntakeScalevReconcileInput = {
  batchId: number;
  reconciledByEmail?: string | null;
  concurrency?: number;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function pushLimited(target: string[], value: string) {
  if (!value) return;
  if (target.length >= SAMPLE_LIMIT) return;
  if (target.includes(value)) return;
  target.push(value);
}

async function loadReconcileBatch(batchId: number): Promise<ReconcileBatchRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_batches')
    .select('id, filename, business_id, business_code, scalev_last_send_status')
    .eq('id', batchId)
    .single<ReconcileBatchRow>();

  if (error) throw error;
  return data;
}

async function loadReconcileBusiness(businessId: number): Promise<ReconcileBusinessRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, api_key')
    .eq('id', businessId)
    .single<ReconcileBusinessRow>();

  if (error) throw error;
  if (!cleanText(data?.api_key)) {
    throw new Error(`Business ${data?.business_code || businessId} belum memiliki API key Scalev aktif.`);
  }
  return data;
}

async function loadAuthoritativeOrders(batchId: number, businessCode: string): Promise<AuthoritativeOrderRow[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_orders')
    .select('id, order_id, external_id, scalev_id, source, business_code')
    .eq('marketplace_intake_batch_id', batchId)
    .eq('business_code', businessCode)
    .eq('source', 'marketplace_api_upload')
    .order('id', { ascending: true });

  if (error) throw error;
  return (data || []) as AuthoritativeOrderRow[];
}

async function persistReconcileResult(
  batchId: number,
  result: MarketplaceIntakeScalevReconcileResult,
): Promise<void> {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('marketplace_intake_batches')
    .update({
      scalev_last_reconcile_status: result.status,
      scalev_last_reconcile_at: result.reconciledAt,
      scalev_last_reconcile_target_count: result.targetCount,
      scalev_last_reconcile_matched_count: result.matchedCount,
      scalev_last_reconcile_updated_count: result.updatedCount,
      scalev_last_reconcile_already_linked_count: result.alreadyLinkedCount,
      scalev_last_reconcile_unmatched_count: result.unmatchedCount,
      scalev_last_reconcile_conflict_count: result.conflictCount,
      scalev_last_reconcile_error_count: result.errorCount,
      scalev_last_reconcile_error: result.errorMessage,
      scalev_last_reconcile_summary: {
        batchId: result.batchId,
        businessCode: result.businessCode,
        reconciledAt: result.reconciledAt,
        status: result.status,
        targetCount: result.targetCount,
        matchedCount: result.matchedCount,
        updatedCount: result.updatedCount,
        alreadyLinkedCount: result.alreadyLinkedCount,
        unmatchedCount: result.unmatchedCount,
        conflictCount: result.conflictCount,
        errorCount: result.errorCount,
        errorMessage: result.errorMessage,
        unmatchedExternalIds: result.unmatchedExternalIds,
        conflictExternalIds: result.conflictExternalIds,
        errorExternalIds: result.errorExternalIds,
      },
    })
    .eq('id', batchId);

  if (error) throw error;
}

async function logReconcileSync(input: {
  batch: ReconcileBatchRow;
  result: MarketplaceIntakeScalevReconcileResult;
  reconciledByEmail: string | null;
}): Promise<void> {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_sync_log')
    .insert({
      status: input.result.status === 'success' ? 'success' : 'failed',
      sync_type: 'marketplace_intake_scalev_reconcile',
      business_code: input.batch.business_code,
      orders_fetched: input.result.targetCount,
      orders_inserted: 0,
      orders_updated: input.result.updatedCount,
      uploaded_by: input.reconciledByEmail,
      filename: input.batch.filename,
      error_message: input.result.errorMessage,
      completed_at: input.result.reconciledAt,
    });

  if (error) throw error;
}

async function findIdentityConflict(params: {
  rowId: number;
  businessCode: string;
  orderId: string;
  scalevId: string;
}): Promise<ConflictRow | null> {
  const svc = createServiceSupabase();
  if (cleanText(params.orderId)) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, scalev_id, source')
      .eq('business_code', params.businessCode)
      .eq('order_id', params.orderId)
      .neq('id', params.rowId)
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0] as ConflictRow;
  }

  if (cleanText(params.scalevId)) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, scalev_id, source')
      .eq('business_code', params.businessCode)
      .eq('scalev_id', params.scalevId)
      .neq('id', params.rowId)
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0] as ConflictRow;
  }

  return null;
}

function resolveScalevFetchId(candidate: any): string {
  return cleanText(candidate?.id) || cleanText(candidate?.order_id);
}

function resolveExternalId(candidate: any): string {
  return cleanText(candidate?.external_id || candidate?.externalId);
}

function resolveSummaryStatus(summary: Omit<MarketplaceIntakeScalevReconcileResult, 'status'>): MarketplaceIntakeScalevReconcileStatus {
  if (summary.targetCount === 0) return 'failed';
  if (summary.unmatchedCount === 0 && summary.conflictCount === 0 && summary.errorCount === 0) {
    return 'success';
  }
  if (summary.matchedCount > 0 || summary.updatedCount > 0 || summary.alreadyLinkedCount > 0) {
    return 'partial';
  }
  return 'failed';
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(10, Math.floor(concurrency || 1)));
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

export async function reconcileMarketplaceIntakeBatchScalevIdentity(
  input: MarketplaceIntakeScalevReconcileInput,
): Promise<MarketplaceIntakeScalevReconcileResult> {
  const batchId = Number(input.batchId || 0);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('batchId tidak valid.');
  }

  const batch = await loadReconcileBatch(batchId);
  const reconciledAt = new Date().toISOString();
  const emptyResultBase = {
    batchId,
    businessCode: batch.business_code,
    reconciledAt,
    targetCount: 0,
    matchedCount: 0,
    updatedCount: 0,
    alreadyLinkedCount: 0,
    unmatchedCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errorMessage: null as string | null,
    unmatchedExternalIds: [] as string[],
    conflictExternalIds: [] as string[],
    errorExternalIds: [] as string[],
  };

  try {
    if (batch.scalev_last_send_status !== 'success') {
      throw new Error('Batch ini belum punya push Scalev yang sukses. Push ke Scalev dulu sebelum menarik identity order.');
    }

    const business = await loadReconcileBusiness(batch.business_id);
    const authoritativeOrders = await loadAuthoritativeOrders(batchId, batch.business_code);
    if (authoritativeOrders.length === 0) {
      throw new Error('Belum ada row authoritative marketplace_api_upload untuk batch ini. Jalankan "Masuk ke App" dulu sebelum reconcile Scalev ID.');
    }

    const summary = { ...emptyResultBase, targetCount: authoritativeOrders.length };
    const svc = createServiceSupabase();

    await mapWithConcurrency(authoritativeOrders, Number(input.concurrency || 4), async (order) => {
      const externalId = cleanText(order.external_id);
      if (!externalId) {
        summary.errorCount += 1;
        pushLimited(summary.errorExternalIds, `id:${order.id}`);
        return;
      }

      try {
        const candidates = await fetchOrdersByExternalId(String(business.api_key), SCALEV_API_BASE_URL, externalId);
        const exactCandidates = candidates.filter((candidate) => resolveExternalId(candidate) === externalId);

        if (exactCandidates.length === 0) {
          summary.unmatchedCount += 1;
          pushLimited(summary.unmatchedExternalIds, externalId);
          return;
        }

        const chosen = exactCandidates[0];
        const candidateOrderIds = new Set(exactCandidates.map((candidate) => cleanText(candidate?.order_id)).filter(Boolean));
        const candidateScalevIds = new Set(exactCandidates.map((candidate) => cleanText(candidate?.id)).filter(Boolean));
        if (candidateOrderIds.size > 1 || candidateScalevIds.size > 1) {
          summary.conflictCount += 1;
          pushLimited(summary.conflictExternalIds, externalId);
          return;
        }

        const fetchId = resolveScalevFetchId(chosen);
        if (!fetchId) {
          summary.errorCount += 1;
          pushLimited(summary.errorExternalIds, externalId);
          return;
        }

        const detail = await fetchOrderDetail(String(business.api_key), SCALEV_API_BASE_URL, fetchId);
        const detailExternalId = resolveExternalId(detail);
        if (detailExternalId && detailExternalId !== externalId) {
          summary.conflictCount += 1;
          pushLimited(summary.conflictExternalIds, externalId);
          return;
        }

        const nextOrderId = cleanText(detail?.order_id) || cleanText(chosen?.order_id);
        const nextScalevId = cleanText(detail?.id) || cleanText(chosen?.id);
        if (!nextOrderId && !nextScalevId) {
          summary.errorCount += 1;
          pushLimited(summary.errorExternalIds, externalId);
          return;
        }

        const conflict = await findIdentityConflict({
          rowId: order.id,
          businessCode: batch.business_code,
          orderId: nextOrderId,
          scalevId: nextScalevId,
        });
        if (conflict) {
          summary.conflictCount += 1;
          pushLimited(summary.conflictExternalIds, externalId);
          return;
        }

        summary.matchedCount += 1;
        const isAlreadyLinked = (
          (!nextOrderId || cleanText(order.order_id) === nextOrderId)
          && (!nextScalevId || cleanText(order.scalev_id) === nextScalevId)
        );
        if (isAlreadyLinked) {
          summary.alreadyLinkedCount += 1;
          return;
        }

        const payload: Record<string, unknown> = {
          synced_at: reconciledAt,
        };
        if (nextOrderId) payload.order_id = nextOrderId;
        if (nextScalevId) payload.scalev_id = nextScalevId;

        const { error } = await svc
          .from('scalev_orders')
          .update(payload)
          .eq('id', order.id);
        if (error) throw error;

        summary.updatedCount += 1;
      } catch (error) {
        summary.errorCount += 1;
        pushLimited(summary.errorExternalIds, externalId);
      }
    });

    const result: MarketplaceIntakeScalevReconcileResult = {
      ...summary,
      status: resolveSummaryStatus(summary),
    };

    await persistReconcileResult(batchId, result);
    await logReconcileSync({
      batch,
      result,
      reconciledByEmail: input.reconciledByEmail || null,
    });

    return result;
  } catch (error: any) {
    const failed: MarketplaceIntakeScalevReconcileResult = {
      ...emptyResultBase,
      status: 'failed',
      errorMessage: error?.message || 'Reconcile Scalev ID gagal.',
    };
    await persistReconcileResult(batchId, failed);
    await logReconcileSync({
      batch,
      result: failed,
      reconciledByEmail: input.reconciledByEmail || null,
    });
    throw error;
  }
}
