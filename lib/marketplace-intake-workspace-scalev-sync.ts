import { promoteMarketplaceIntakeBatchToApp } from './marketplace-intake-app-promote';
import { reconcileMarketplaceIntakeBatchScalevIdentity } from './marketplace-intake-scalev-reconcile';
import { resolveMarketplaceIntakeSourceConfig } from './marketplace-intake-source-store-scopes';
import { listMarketplaceIntakeUploadSourceConfigs } from './marketplace-intake-sources';
import {
  extractMarketplaceTrackingFromScalevOrder,
  normalizeMarketplaceTracking,
} from './marketplace-tracking';
import { createServiceSupabase } from './service-supabase';

type WorkspaceScalevBatchRow = {
  id: number;
  filename: string;
  business_code: string;
  source_key: string;
  scalev_last_send_status: string | null;
};

type WorkspaceScalevOrderRow = {
  id: number;
  batch_id: number;
  external_order_id: string;
  tracking_number: string | null;
  final_store_name: string | null;
  shipment_date: string | null;
  warehouse_status: string;
};

type AppScalevOrderRow = {
  id: number;
  order_id: string | null;
  external_id: string | null;
  marketplace_tracking_number: string | null;
  source: string | null;
  business_code: string | null;
  shipped_time: string | null;
  raw_data: any;
};

export type MarketplaceIntakeWorkspaceScalevSyncStatus = 'empty' | 'accurate' | 'drift';

export type MarketplaceIntakeWorkspaceScalevSyncSample = {
  batchId: number;
  batchFilename: string;
  businessCode: string;
  externalOrderId: string;
  trackingNumber: string | null;
  storeName: string | null;
  reason: 'missing_in_app' | 'wrong_shipment_date';
  appOrderId: string | null;
  appSource: string | null;
  appShipmentDate: string | null;
};

export type MarketplaceIntakeWorkspaceScalevSyncBatchSummary = {
  batchId: number;
  batchFilename: string;
  businessCode: string;
  orderCount: number;
  missingCount: number;
  wrongDateCount: number;
};

export type MarketplaceIntakeWorkspaceScalevSyncInspection = {
  sourceKey: string | null;
  shipmentDate: string;
  checkedAt: string;
  status: MarketplaceIntakeWorkspaceScalevSyncStatus;
  eligibleOrderCount: number;
  matchedOrderCount: number;
  missingOrderCount: number;
  wrongDateCount: number;
  affectedBatchCount: number;
  affectedBatches: MarketplaceIntakeWorkspaceScalevSyncBatchSummary[];
  samples: MarketplaceIntakeWorkspaceScalevSyncSample[];
};

export type MarketplaceIntakeWorkspaceScalevSyncRepairResult = {
  sourceKey: string | null;
  shipmentDate: string;
  repairedAt: string;
  repairedBatchCount: number;
  promoteInsertedCount: number;
  promoteUpdatedCount: number;
  promoteUpdatedWebhookCount: number;
  promoteUpdatedAuthoritativeCount: number;
  promoteMatchedExternalIdCount: number;
  promoteMatchedTrackingCount: number;
  promoteSkippedCount: number;
  reconcileMatchedCount: number;
  reconcileUpdatedCount: number;
  reconcileAlreadyLinkedCount: number;
  reconcileUnmatchedCount: number;
  batchErrors: Array<{ batchId: number; batchFilename: string; error: string }>;
  inspection: MarketplaceIntakeWorkspaceScalevSyncInspection;
};

type EligibleWorkspaceOrder = {
  id: number;
  batchId: number;
  batchFilename: string;
  businessCode: string;
  sourceKey: string;
  externalOrderId: string;
  trackingNumber: string | null;
  storeName: string | null;
  shipmentDate: string;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeShipmentDate(value: string): string {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('Format shipmentDate tidak valid. Gunakan YYYY-MM-DD.');
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeExternalId(value: unknown): string {
  const text = cleanText(value).replace(/^#+/, '').toUpperCase();
  return text || '';
}

function buildExternalIdVariants(value: unknown): string[] {
  const raw = cleanText(value);
  const normalized = normalizeExternalId(value);
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  if (normalized) {
    variants.add(normalized);
    variants.add(`#${normalized}`);
  }
  return Array.from(variants);
}

function formatJakartaDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

function toJakartaDate(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatJakartaDateTime(parsed) || null;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sourcePriority(source: string | null | undefined): number {
  const normalized = cleanText(source);
  if (normalized === 'marketplace_api_upload') return 3;
  if (normalized === 'webhook') return 2;
  if (normalized === 'ops_upload') return 1;
  return 0;
}

function uniqueRows(rows: AppScalevOrderRow[]): AppScalevOrderRow[] {
  const seen = new Set<number>();
  const result: AppScalevOrderRow[] = [];
  for (const row of rows || []) {
    const id = Number(row?.id || 0);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}

function pickBestAppRowForOrder(
  rows: AppScalevOrderRow[],
  shipmentDate: string,
): AppScalevOrderRow | null {
  const unique = uniqueRows(rows);
  if (unique.length === 0) return null;

  const sameDateRows = unique.filter((row) => toJakartaDate(row.shipped_time) === shipmentDate);
  const pool = sameDateRows.length > 0 ? sameDateRows : unique;

  return pool.sort((left, right) => {
    const sourceDiff = sourcePriority(right.source) - sourcePriority(left.source);
    if (sourceDiff !== 0) return sourceDiff;
    return Number(right.id || 0) - Number(left.id || 0);
  })[0] || null;
}

async function resolveScopeSourceKeys(sourceKey?: string | null): Promise<string[]> {
  const normalizedSourceKey = cleanText(sourceKey).toLowerCase();
  if (!normalizedSourceKey || normalizedSourceKey === 'all') {
    return listMarketplaceIntakeUploadSourceConfigs().map((config) => config.sourceKey);
  }
  const config = await resolveMarketplaceIntakeSourceConfig(normalizedSourceKey);
  return [config.sourceKey];
}

async function loadScopeBatches(sourceKey?: string | null): Promise<Map<number, WorkspaceScalevBatchRow>> {
  const scopeSourceKeys = await resolveScopeSourceKeys(sourceKey);
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_batches')
    .select('id, filename, business_code, source_key, scalev_last_send_status')
    .in('source_key', scopeSourceKeys)
    .order('confirmed_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw error;

  const rows = new Map<number, WorkspaceScalevBatchRow>();
  for (const row of data || []) {
    const id = Number((row as any).id || 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    rows.set(id, {
      id,
      filename: cleanText((row as any).filename),
      business_code: cleanText((row as any).business_code),
      source_key: cleanText((row as any).source_key),
      scalev_last_send_status: (row as any).scalev_last_send_status || null,
    });
  }
  return rows;
}

async function loadEligibleWorkspaceOrders(input: {
  shipmentDate: string;
  sourceKey?: string | null;
}): Promise<EligibleWorkspaceOrder[]> {
  const batchMap = await loadScopeBatches(input.sourceKey);
  const eligibleBatches = Array.from(batchMap.values()).filter((batch) => cleanText(batch.scalev_last_send_status) === 'success');
  if (eligibleBatches.length === 0) return [];

  const svc = createServiceSupabase();
  const batchIds = eligibleBatches.map((batch) => batch.id);
  const { data, error } = await svc
    .from('marketplace_intake_orders')
    .select(`
      id,
      batch_id,
      external_order_id,
      tracking_number,
      final_store_name,
      shipment_date,
      warehouse_status
    `)
    .in('batch_id', batchIds)
    .eq('shipment_date', input.shipmentDate)
    .eq('warehouse_status', 'scheduled')
    .order('batch_id', { ascending: true })
    .order('external_order_id', { ascending: true });

  if (error) throw error;

  const orders: EligibleWorkspaceOrder[] = [];
  for (const row of data || []) {
    const batchId = Number((row as any).batch_id || 0);
    const batch = batchMap.get(batchId);
    if (!batch) continue;
    orders.push({
      id: Number((row as any).id || 0),
      batchId,
      batchFilename: batch.filename,
      businessCode: batch.business_code,
      sourceKey: batch.source_key,
      externalOrderId: cleanText((row as any).external_order_id),
      trackingNumber: normalizeMarketplaceTracking((row as any).tracking_number),
      storeName: cleanText((row as any).final_store_name) || null,
      shipmentDate: cleanText((row as any).shipment_date),
    });
  }

  return orders;
}

async function loadAppRowsByExternalIds(
  businessCode: string,
  externalIds: string[],
): Promise<AppScalevOrderRow[]> {
  const svc = createServiceSupabase();
  const rows: AppScalevOrderRow[] = [];
  for (const chunk of chunkValues(externalIds, 250)) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, marketplace_tracking_number, source, business_code, shipped_time, raw_data')
      .eq('business_code', businessCode)
      .in('external_id', chunk);
    if (error) throw error;
    rows.push(...((data || []) as AppScalevOrderRow[]));
  }
  return rows;
}

async function loadAppRowsByTracking(
  businessCode: string,
  trackingNumbers: string[],
): Promise<AppScalevOrderRow[]> {
  const svc = createServiceSupabase();
  const rows: AppScalevOrderRow[] = [];
  for (const chunk of chunkValues(trackingNumbers, 250)) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, marketplace_tracking_number, source, business_code, shipped_time, raw_data')
      .eq('business_code', businessCode)
      .in('marketplace_tracking_number', chunk);
    if (error) throw error;
    rows.push(...((data || []) as AppScalevOrderRow[]));
  }
  return rows;
}

async function loadCandidateAppRows(
  orders: EligibleWorkspaceOrder[],
): Promise<Map<string, AppScalevOrderRow[]>> {
  const rowsByBusiness = new Map<string, EligibleWorkspaceOrder[]>();
  for (const order of orders) {
    const businessCode = cleanText(order.businessCode);
    if (!businessCode) continue;
    if (!rowsByBusiness.has(businessCode)) rowsByBusiness.set(businessCode, []);
    rowsByBusiness.get(businessCode)!.push(order);
  }

  const candidateRowsByOrderKey = new Map<string, AppScalevOrderRow[]>();

  for (const [businessCode, businessOrders] of rowsByBusiness.entries()) {
    const externalIds = new Set<string>();
    const trackingNumbers = new Set<string>();

    for (const order of businessOrders) {
      for (const variant of buildExternalIdVariants(order.externalOrderId)) {
        externalIds.add(variant);
      }
      if (order.trackingNumber) trackingNumbers.add(order.trackingNumber);
    }

    const [rowsByExternal, rowsByTracking] = await Promise.all([
      externalIds.size > 0 ? loadAppRowsByExternalIds(businessCode, Array.from(externalIds)) : Promise.resolve([]),
      trackingNumbers.size > 0 ? loadAppRowsByTracking(businessCode, Array.from(trackingNumbers)) : Promise.resolve([]),
    ]);

    const externalIndex = new Map<string, AppScalevOrderRow[]>();
    for (const row of rowsByExternal) {
      const key = normalizeExternalId(row.external_id);
      if (!key) continue;
      if (!externalIndex.has(key)) externalIndex.set(key, []);
      externalIndex.get(key)!.push(row);
    }

    const trackingIndex = new Map<string, AppScalevOrderRow[]>();
    for (const row of rowsByTracking) {
      const key = extractMarketplaceTrackingFromScalevOrder(row);
      if (!key) continue;
      if (!trackingIndex.has(key)) trackingIndex.set(key, []);
      trackingIndex.get(key)!.push(row);
    }

    for (const order of businessOrders) {
      const orderKey = `${order.batchId}:${order.id}`;
      const candidates: AppScalevOrderRow[] = [];
      const externalKey = normalizeExternalId(order.externalOrderId);
      if (externalKey && externalIndex.has(externalKey)) {
        candidates.push(...(externalIndex.get(externalKey) || []));
      }
      if (order.trackingNumber && trackingIndex.has(order.trackingNumber)) {
        candidates.push(...(trackingIndex.get(order.trackingNumber) || []));
      }
      candidateRowsByOrderKey.set(orderKey, uniqueRows(candidates));
    }
  }

  return candidateRowsByOrderKey;
}

export async function inspectMarketplaceIntakeWorkspaceScalevSync(input: {
  shipmentDate: string;
  sourceKey?: string | null;
}): Promise<MarketplaceIntakeWorkspaceScalevSyncInspection> {
  const shipmentDate = normalizeShipmentDate(input.shipmentDate);
  const checkedAt = new Date().toISOString();
  const eligibleOrders = await loadEligibleWorkspaceOrders({
    shipmentDate,
    sourceKey: input.sourceKey,
  });

  if (eligibleOrders.length === 0) {
    return {
      sourceKey: cleanText(input.sourceKey) || null,
      shipmentDate,
      checkedAt,
      status: 'empty',
      eligibleOrderCount: 0,
      matchedOrderCount: 0,
      missingOrderCount: 0,
      wrongDateCount: 0,
      affectedBatchCount: 0,
      affectedBatches: [],
      samples: [],
    };
  }

  const candidateRowsByOrderKey = await loadCandidateAppRows(eligibleOrders);
  let matchedOrderCount = 0;
  let missingOrderCount = 0;
  let wrongDateCount = 0;
  const samples: MarketplaceIntakeWorkspaceScalevSyncSample[] = [];
  const batchSummary = new Map<number, MarketplaceIntakeWorkspaceScalevSyncBatchSummary>();

  for (const order of eligibleOrders) {
    const orderKey = `${order.batchId}:${order.id}`;
    const candidates = candidateRowsByOrderKey.get(orderKey) || [];
    const bestRow = pickBestAppRowForOrder(candidates, shipmentDate);
    const appShipmentDate = toJakartaDate(bestRow?.shipped_time);
    const hasExactDate = Boolean(bestRow && appShipmentDate === shipmentDate);

    if (!batchSummary.has(order.batchId)) {
      batchSummary.set(order.batchId, {
        batchId: order.batchId,
        batchFilename: order.batchFilename,
        businessCode: order.businessCode,
        orderCount: 0,
        missingCount: 0,
        wrongDateCount: 0,
      });
    }
    const summary = batchSummary.get(order.batchId)!;
    summary.orderCount += 1;

    if (hasExactDate) {
      matchedOrderCount += 1;
      continue;
    }

    if (bestRow) {
      wrongDateCount += 1;
      summary.wrongDateCount += 1;
      if (samples.length < 12) {
        samples.push({
          batchId: order.batchId,
          batchFilename: order.batchFilename,
          businessCode: order.businessCode,
          externalOrderId: order.externalOrderId,
          trackingNumber: order.trackingNumber,
          storeName: order.storeName,
          reason: 'wrong_shipment_date',
          appOrderId: cleanText(bestRow.order_id) || null,
          appSource: cleanText(bestRow.source) || null,
          appShipmentDate,
        });
      }
      continue;
    }

    missingOrderCount += 1;
    summary.missingCount += 1;
    if (samples.length < 12) {
      samples.push({
        batchId: order.batchId,
        batchFilename: order.batchFilename,
        businessCode: order.businessCode,
        externalOrderId: order.externalOrderId,
        trackingNumber: order.trackingNumber,
        storeName: order.storeName,
        reason: 'missing_in_app',
        appOrderId: null,
        appSource: null,
        appShipmentDate: null,
      });
    }
  }

  const affectedBatches = Array.from(batchSummary.values()).filter((batch) => (batch.missingCount + batch.wrongDateCount) > 0);
  const status: MarketplaceIntakeWorkspaceScalevSyncStatus = affectedBatches.length > 0 ? 'drift' : 'accurate';

  return {
    sourceKey: cleanText(input.sourceKey) || null,
    shipmentDate,
    checkedAt,
    status,
    eligibleOrderCount: eligibleOrders.length,
    matchedOrderCount,
    missingOrderCount,
    wrongDateCount,
    affectedBatchCount: affectedBatches.length,
    affectedBatches,
    samples,
  };
}

export async function repairMarketplaceIntakeWorkspaceScalevSync(input: {
  shipmentDate: string;
  sourceKey?: string | null;
  repairedByEmail?: string | null;
}): Promise<MarketplaceIntakeWorkspaceScalevSyncRepairResult> {
  const shipmentDate = normalizeShipmentDate(input.shipmentDate);
  const inspected = await inspectMarketplaceIntakeWorkspaceScalevSync({
    shipmentDate,
    sourceKey: input.sourceKey,
  });

  const batchErrors: Array<{ batchId: number; batchFilename: string; error: string }> = [];
  let promoteInsertedCount = 0;
  let promoteUpdatedCount = 0;
  let promoteUpdatedWebhookCount = 0;
  let promoteUpdatedAuthoritativeCount = 0;
  let promoteMatchedExternalIdCount = 0;
  let promoteMatchedTrackingCount = 0;
  let promoteSkippedCount = 0;
  let reconcileMatchedCount = 0;
  let reconcileUpdatedCount = 0;
  let reconcileAlreadyLinkedCount = 0;
  let reconcileUnmatchedCount = 0;

  for (const batch of inspected.affectedBatches) {
    try {
      const promoteResult = await promoteMarketplaceIntakeBatchToApp({
        batchId: batch.batchId,
        shipmentDate,
        includeWarehouseStatuses: ['scheduled'],
        promotedByEmail: input.repairedByEmail || null,
      });
      promoteInsertedCount += Number(promoteResult.insertedCount || 0);
      promoteUpdatedCount += Number(promoteResult.updatedCount || 0);
      promoteUpdatedWebhookCount += Number(promoteResult.updatedWebhookCount || 0);
      promoteUpdatedAuthoritativeCount += Number(promoteResult.updatedAuthoritativeCount || 0);
      promoteMatchedExternalIdCount += Number(promoteResult.matchedExternalIdCount || 0);
      promoteMatchedTrackingCount += Number(promoteResult.matchedTrackingCount || 0);
      promoteSkippedCount += Number(promoteResult.skippedCount || 0);

      const reconcileResult = await reconcileMarketplaceIntakeBatchScalevIdentity({
        batchId: batch.batchId,
        reconciledByEmail: input.repairedByEmail || null,
      });
      reconcileMatchedCount += Number(reconcileResult.matchedCount || 0);
      reconcileUpdatedCount += Number(reconcileResult.updatedCount || 0);
      reconcileAlreadyLinkedCount += Number(reconcileResult.alreadyLinkedCount || 0);
      reconcileUnmatchedCount += Number(reconcileResult.unmatchedCount || 0);
    } catch (error: any) {
      batchErrors.push({
        batchId: batch.batchId,
        batchFilename: batch.batchFilename,
        error: error?.message || 'Gagal memperbaiki batch ini.',
      });
    }
  }

  const inspection = await inspectMarketplaceIntakeWorkspaceScalevSync({
    shipmentDate,
    sourceKey: input.sourceKey,
  });

  return {
    sourceKey: cleanText(input.sourceKey) || null,
    shipmentDate,
    repairedAt: new Date().toISOString(),
    repairedBatchCount: inspected.affectedBatches.length - batchErrors.length,
    promoteInsertedCount,
    promoteUpdatedCount,
    promoteUpdatedWebhookCount,
    promoteUpdatedAuthoritativeCount,
    promoteMatchedExternalIdCount,
    promoteMatchedTrackingCount,
    promoteSkippedCount,
    reconcileMatchedCount,
    reconcileUpdatedCount,
    reconcileAlreadyLinkedCount,
    reconcileUnmatchedCount,
    batchErrors,
    inspection,
  };
}
