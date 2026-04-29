// lib/warehouse-ledger-actions.ts
'use server';

import { createServiceSupabase, createServerSupabase } from './supabase-server';
import {
  requireAnyDashboardPermissionAccess,
  requireAnyDashboardTabAccess,
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { sendTelegramToChat } from './telegram';
import { recordWarehouseActivityLog } from './warehouse-activity-log-actions';
import {
  areWarehouseActivityLogValuesEqual,
  getWarehouseActivityLogChangedFields,
  normalizeWarehouseActivityLogArray,
} from './warehouse-activity-log-utils';
import {
  buildCanonicalMappingLookupKey,
  buildViewerEntityLookupKey,
  fetchCanonicalCatalogMappingsByRequests,
  fetchVisibleDirectCatalogEntitiesByBusinessRequests,
  type CanonicalCatalogMappingRow,
  type ScalevVisibilityKind,
  type VisibleDirectCatalogEntityRow,
} from './scalev-visible-entity-helpers';
import {
  cleanWarehouseDomainText,
  extractScalevLineItemNameRaw,
  extractScalevLineItemOwnerRaw,
  extractScalevOrderBusinessNameRaw,
  extractScalevOrderOriginBusinessNameRaw,
  extractScalevOrderOriginRaw,
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
  resolveWarehouseBusinessCode,
  resolveWarehouseOrigin,
  type WarehouseBusinessDirectoryRow,
} from './warehouse-domain-helpers';

// ============================================================
// AUTH HELPER
// ============================================================

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

async function getCurrentUserName(): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'System';
    const svc = createServiceSupabase();
    const { data } = await svc.from('profiles').select('full_name, email').eq('id', user.id).single();
    return data?.full_name || data?.email || 'Unknown';
  } catch {
    return 'System';
  }
}

async function requireWarehouseAccess(label: string = 'Warehouse') {
  await requireDashboardTabAccess('warehouse', label);
}

async function requireWarehousePermission(permissionKey: string, label: string) {
  await requireWarehouseAccess(label);
  await requireDashboardPermissionAccess(permissionKey, label);
}

async function requireWarehouseSettingsPermission(permissionKey: string, label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess(permissionKey, label);
}

async function requireAnyWarehouseSettingsPermission(permissionKeys: string[], label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireAnyDashboardPermissionAccess(permissionKeys, label);
}

async function requireWarehouseReadForSharedProducts(label: string) {
  try {
    await requireAnyDashboardTabAccess(['warehouse', 'ppic'], label);
    return;
  } catch {}

  await requireAnyWarehouseSettingsPermission(['whs:products', 'whs:mapping', 'whs:warehouses'], label);
}

async function requireVendorReadAccess(label: string) {
  try {
    await requireDashboardTabAccess('ppic', label);
    return;
  } catch {}

  await requireAnyWarehouseSettingsPermission(['whs:vendors', 'whs:products'], label);
}

function getWarehouseMutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string' && (error as any).message.trim()) {
    return (error as any).message.trim();
  }
  return fallback;
}

// ============================================================
// TELEGRAM NOTIFICATION (fire-and-forget)
// ============================================================

async function notifyDirekturs(message: string) {
  try {
    const svc = createServiceSupabase();
    const { data: direkturs } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .in('role', ['direktur_ops', 'direktur_operasional'])
      .not('telegram_chat_id', 'is', null);

    if (direkturs && direkturs.length > 0) {
      await Promise.allSettled(
        direkturs.map(d => sendTelegramToChat(d.telegram_chat_id, message))
      );
    }
  } catch (e) {
    console.warn('[warehouse] telegram notify failed:', e);
  }
}

async function notifyDirektursWithMarkup(message: string, replyMarkup?: any) {
  try {
    const svc = createServiceSupabase();
    const { data: direkturs } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .in('role', ['direktur_ops', 'direktur_operasional'])
      .not('telegram_chat_id', 'is', null);

    if (direkturs && direkturs.length > 0) {
      await Promise.allSettled(
        direkturs.map(d => sendTelegramToChat(d.telegram_chat_id, message, { replyMarkup }))
      );
    }
  } catch (e) {
    console.warn('[warehouse] telegram notify failed:', e);
  }
}

function formatNotification(type: string, productName: string, qty: number, gudang: string, userName: string, extra?: string): string {
  const icon = type === 'Stock Masuk' ? '\u{1F4E6}' : type === 'Transfer' ? '\u{1F500}' : type === 'Dispose' ? '\u{1F5D1}' : '\u{1F4E4}';
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let msg = `${icon} <b>${type}</b>\nProduk: ${productName}\nQty: ${qty > 0 ? '+' : ''}${qty.toLocaleString('id-ID')}\n`;
  if (extra) msg += `${extra}\n`;
  msg += `Oleh: ${userName}\nWaktu: ${time}`;
  return msg;
}

// ============================================================
// TYPES
// ============================================================

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'DISPOSE';
export type ReferenceType = 'scalev_order' | 'manual' | 'purchase_order' | 'transfer' | 'dispose' | 'opname' | 'rts' | 'reclass';

type WarehouseMutationResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };

export interface LedgerEntry {
  warehouse_product_id: number;
  batch_id?: number | null;
  movement_type: MovementType;
  quantity: number;
  reference_type: ReferenceType;
  reference_id?: string | null;
  scalev_order_id?: number | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

interface WarehouseDeductFifoParams {
  p_product_id: number;
  p_quantity: number;
  p_reference_type?: ReferenceType | string;
  p_reference_id?: string | null;
  p_notes?: string | null;
  p_created_at?: string | null;
  p_scalev_order_id?: number | null;
}

interface ScalevOrderWarehouseSnapshot {
  id: number;
  order_id: string;
  business_code: string | null;
  business_name_raw?: string | null;
  origin_business_name_raw?: string | null;
  origin_raw?: string | null;
  seller_business_code?: string | null;
  origin_operator_business_code?: string | null;
  origin_registry_id?: number | null;
  raw_data?: any;
  status?: string | null;
  shipped_time?: string | null;
  completed_time?: string | null;
}

interface ScalevOrderLineForWarehouse {
  product_name: string;
  quantity: number;
  variant_sku?: string | null;
  item_name_raw?: string | null;
  item_owner_raw?: string | null;
  stock_owner_business_code?: string | null;
}

interface ResolvedWarehouseTarget {
  warehouse_product_id: number;
  scalev_product_name: string;
  quantity: number;
  note_context: string;
  owner_business_code?: string | null;
}

interface WarehouseLedgerRow {
  id: number;
  warehouse_product_id: number;
  batch_id: number | null;
  quantity: number;
  movement_type: string;
  reference_type?: string | null;
  notes: string | null;
  created_at: string | null;
  reference_id?: string | null;
  scalev_order_id?: number | null;
}

function formatWarehouseSystemDateLabel(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

function buildWarehouseReversalNote(
  orderId: string,
  reason: string,
  order?: Pick<ScalevOrderWarehouseSnapshot, 'shipped_time' | 'completed_time'> | null,
) {
  const effectiveDateLabel = formatWarehouseSystemDateLabel(order?.shipped_time || order?.completed_time || null);
  const orderLabel = `Koreksi sistem untuk order ID ${orderId}${effectiveDateLabel ? ` tanggal ${effectiveDateLabel}` : ''}.`;
  const normalizedReason = String(reason || '').toLowerCase();

  if (normalizedReason.startsWith('reconcile before ')) {
    return orderLabel;
  }

  if (normalizedReason.startsWith('status changed to ')) {
    return `${orderLabel} Status order berubah sehingga deduction lama dibatalkan.`;
  }

  if (normalizedReason.includes('no longer shipped/completed')) {
    return `${orderLabel} Status order tidak lagi terminal sehingga deduction lama dibatalkan.`;
  }

  return `${orderLabel} ${reason}`.trim();
}

interface OutstandingWarehouseLedgerGroup {
  warehouse_product_id: number;
  batch_id: number | null;
  quantity: number;
}

interface ScalevOrderWarehouseAssessment {
  order: ScalevOrderWarehouseSnapshot;
  productLines: ScalevOrderLineForWarehouse[];
  targets: ResolvedWarehouseTarget[];
  desiredByProduct: Map<number, number>;
  outstandingGroups: OutstandingWarehouseLedgerGroup[];
  outstandingByProduct: Map<number, number>;
  unmappedProducts: string[];
  skippedIgnored: number;
  mapping: { deduct_entity: string; deduct_warehouse: string } | null;
  allowedMappings?: Array<{ deduct_entity: string; deduct_warehouse: string }> | null;
}

type WarehouseRtsVerificationScope = 'pre_go_live' | 'post_go_live';
type WarehouseRtsVerificationStatus = 'pending' | 'completed' | 'cancelled';
type WarehouseRtsReturnMode = 'same_product' | 'decompose';

interface WarehouseRtsVerificationQueueItem {
  warehouse_product_id: number;
  scalev_product_summary: string;
  expected_qty: number;
}

interface WarehouseRtsAllocationSnapshot {
  warehouse_product_id: number;
  warehouse_product_name?: string | null;
  warehouse_product_category?: string | null;
  quantity: number;
  target_batch_id?: number | null;
  target_batch_code_snapshot?: string | null;
  notes?: string | null;
}

interface WarehouseBusinessTargetRow {
  id?: number;
  business_code: string;
  deduct_entity: string;
  deduct_warehouse: string | null;
  is_active?: boolean | null;
  is_primary?: boolean | null;
  notes?: string | null;
}

interface WarehouseScalevMappingRow {
  scalev_product_name: string;
  warehouse_product_id: number | null;
  deduct_qty_multiplier: number | null;
  is_ignored: boolean | null;
  warehouse_products?: {
    id: number;
    name: string | null;
    entity: string | null;
    warehouse: string | null;
    scalev_product_names?: string[] | null;
  } | null;
}

interface WarehouseFallbackProductRow {
  id: number;
  entity: string;
  warehouse: string;
  scalev_product_names: string[] | null;
}

interface ScalevCatalogBusinessLookupRow {
  id: number;
  business_code: string;
}

interface ScalevCatalogIdentifierLookupRow {
  business_id: number;
  identifier: string;
  identifier_normalized: string;
  entity_key: string;
  entity_type: 'product' | 'variant' | 'bundle';
  source: string;
  visibility_kind: ScalevVisibilityKind;
  owner_business_id: number;
  owner_business_code: string;
  processor_business_id: number;
  processor_business_code: string;
}

interface ScalevCatalogBundleLineLookupRow {
  business_id: number;
  scalev_bundle_id: number;
  scalev_bundle_line_key: string;
  quantity: number;
  scalev_product_id: number | null;
  scalev_variant_id: number | null;
  scalev_variant_unique_id: string | null;
  scalev_variant_uuid: string | null;
  scalev_variant_sku: string | null;
  scalev_variant_name: string | null;
  scalev_variant_product_name: string | null;
}

interface ScalevCatalogEntityOwnerLookupRow {
  business_id: number;
  business_code: string;
  scalev_product_id: number;
  scalev_variant_id: number | null;
  entity_key: string;
}

interface WarehouseScalevCatalogMappingRow {
  business_id: number;
  business_code?: string | null;
  scalev_entity_key: string;
  scalev_entity_type?: 'product' | 'variant' | null;
  warehouse_product_id: number | null;
  warehouse_products?: {
    id: number;
    name: string | null;
    entity: string | null;
    warehouse: string | null;
    scalev_product_names?: string[] | null;
  } | null;
}

interface ScalevCatalogEntityOwnerLookups {
  variantOwnersById: Map<number, ScalevCatalogEntityOwnerLookupRow[]>;
  productOwnersById: Map<number, ScalevCatalogEntityOwnerLookupRow[]>;
}

interface WarehouseCatalogResolvedTarget {
  warehouse_product_id: number;
  quantity_multiplier: number;
  scalev_label: string;
  note_suffix: string;
  owner_business_code: string | null;
  entity?: string | null;
  warehouse?: string | null;
}

interface CatalogResolutionContext {
  catalogBusinessIdByCode: Map<string, number>;
  identifiersByBusinessId: Map<number, Map<string, ScalevCatalogIdentifierLookupRow[]>>;
  bundleLinesByBusinessId: Map<number, Map<string, ScalevCatalogBundleLineLookupRow[]>>;
  directEntitiesByViewerKey: Map<string, VisibleDirectCatalogEntityRow>;
  canonicalMappingsByKey: Map<string, CanonicalCatalogMappingRow>;
  processorMappingsByCode: Map<string, WarehouseBusinessTargetRow[]>;
}

interface ResolvedScalevOrderWarehouseContext {
  seller_business_code: string | null;
  seller_source: 'directory' | 'fallback_code' | 'none';
  origin_operator_business_code: string | null;
  origin_registry_id: number | null;
  internal_warehouse_code: string | null;
  raw_business_name: string | null;
  raw_origin_business_name: string | null;
  raw_origin_name: string | null;
}

interface WarehouseStockReclassRequestInput {
  sourceProductId: number;
  sourceBatchId?: number | null;
  targetProductId?: number | null;
  targetCategory?: string | null;
  quantity: number;
  reason: string;
  notes?: string | null;
}

type WarehouseStockReclassStatus = 'requested' | 'applied' | 'rejected';

type TelegramWarehouseActor = {
  id: string;
  role: string;
  displayName: string;
};

export interface WarehouseUndeductedOrderIssue {
  order_id: string;
  business_code: string | null;
  product_lines: ScalevOrderLineForWarehouse[];
  problem: string;
  problem_detail: string;
}

export interface WarehouseUndeductedOrdersResult {
  rows: WarehouseUndeductedOrderIssue[];
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================
// HELPERS
// ============================================================

function getRpcErrorText(error: any) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function isMissingScalevOrderIdColumnError(error: any) {
  const text = getRpcErrorText(error).toLowerCase();
  return text.includes('scalev_order_id') && text.includes('column');
}

function isMissingScalevOrderIdParamError(error: any, functionName: string) {
  const text = getRpcErrorText(error).toLowerCase();
  return text.includes(functionName.toLowerCase()) && text.includes('p_scalev_order_id');
}

function isMissingRpcFunctionError(error: any, functionName: string) {
  const text = getRpcErrorText(error).toLowerCase();
  return (
    text.includes(functionName.toLowerCase()) &&
    (text.includes('function') || text.includes('schema cache')) &&
    (text.includes('not find') || text.includes('does not exist') || text.includes('find the function'))
  );
}

export async function callWarehouseDeductFifoCompat(
  svc: ReturnType<typeof createServiceSupabase>,
  params: WarehouseDeductFifoParams,
) {
  const nextParams = {
    p_product_id: params.p_product_id,
    p_quantity: params.p_quantity,
    p_reference_type: params.p_reference_type ?? 'scalev_order',
    p_reference_id: params.p_reference_id ?? null,
    p_notes: params.p_notes ?? null,
    p_created_at: params.p_created_at ?? null,
    p_scalev_order_id: params.p_scalev_order_id ?? null,
  };

  let result = await svc.rpc('warehouse_deduct_fifo', nextParams);
  if (result.error && isMissingScalevOrderIdParamError(result.error, 'warehouse_deduct_fifo')) {
    const { p_scalev_order_id: _ignored, ...legacyParams } = nextParams;
    result = await svc.rpc('warehouse_deduct_fifo', legacyParams);
  }

  return result;
}

const TERMINAL_SCALEV_ORDER_STATUSES = new Set(['shipped', 'completed']);
const RETURNED_SCALEV_ORDER_STATUSES = new Set(['returned', 'rts', 'shipped_rts']);
const WAREHOUSE_GO_LIVE_BASELINE_DATE = '2026-04-21';
const WAREHOUSE_GO_LIVE_BASELINE_LABEL = '21 Apr 2026';
const WAREHOUSE_GO_LIVE_NOT_BEFORE_LABEL = '21 Apr 2026 14:00 WIB';
const WAREHOUSE_GO_LIVE_NOT_BEFORE_AT = new Date('2026-04-21T14:00:00+07:00').toISOString();
const QUANTITY_EPSILON = 0.000001;
const ALLOWED_STOCK_RECLASS_CATEGORIES = new Set(['fg', 'bonus']);

function isTerminalScalevOrderStatus(status?: string | null) {
  return TERMINAL_SCALEV_ORDER_STATUSES.has((status || '').toLowerCase());
}

function isReturnedScalevOrderStatus(status?: string | null) {
  return RETURNED_SCALEV_ORDER_STATUSES.has((status || '').toLowerCase());
}

function getScalevOrderWarehouseEffectiveAt(order?: Pick<ScalevOrderWarehouseSnapshot, 'shipped_time' | 'completed_time'> | null) {
  return order?.shipped_time || order?.completed_time || null;
}

function formatJakartaDateValue(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!byType.year || !byType.month || !byType.day) return null;
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function loadWarehouseGoLiveAt(
  svc: ReturnType<typeof createServiceSupabase>,
) {
  const { data, error } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('completed_at')
    .eq('status', 'completed')
    .eq('opname_date', WAREHOUSE_GO_LIVE_BASELINE_DATE)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.completed_at) return null;
  const approvedAt = new Date(data.completed_at);
  const notBeforeAt = new Date(WAREHOUSE_GO_LIVE_NOT_BEFORE_AT);
  if (Number.isNaN(approvedAt.getTime()) || Number.isNaN(notBeforeAt.getTime())) {
    return data.completed_at;
  }
  return approvedAt.getTime() > notBeforeAt.getTime()
    ? approvedAt.toISOString()
    : notBeforeAt.toISOString();
}

function isScalevOrderBeforeWarehouseGoLive(
  order: Pick<ScalevOrderWarehouseSnapshot, 'shipped_time' | 'completed_time'> | null | undefined,
  goLiveAt: string | null,
) {
  if (!goLiveAt) return true;
  const effectiveAt = getScalevOrderWarehouseEffectiveAt(order);
  if (!effectiveAt) return false;
  const effectiveParsed = new Date(effectiveAt);
  const goLiveParsed = new Date(goLiveAt);
  if (Number.isNaN(effectiveParsed.getTime()) || Number.isNaN(goLiveParsed.getTime())) return false;
  return effectiveParsed.getTime() < goLiveParsed.getTime();
}

function isScalevOrderOnOrAfterWarehouseGoLive(
  order: Pick<ScalevOrderWarehouseSnapshot, 'shipped_time' | 'completed_time'> | null | undefined,
  goLiveAt: string | null,
) {
  if (!goLiveAt) return false;
  return !isScalevOrderBeforeWarehouseGoLive(order, goLiveAt);
}

export async function getWarehouseGoLiveState() {
  await requireWarehouseAccess('Warehouse');
  const svc = createServiceSupabase();
  const goLiveAt = await loadWarehouseGoLiveAt(svc);
  return {
    baselineDate: WAREHOUSE_GO_LIVE_BASELINE_DATE,
    baselineLabel: WAREHOUSE_GO_LIVE_BASELINE_LABEL,
    notBeforeLabel: WAREHOUSE_GO_LIVE_NOT_BEFORE_LABEL,
    goLiveAt,
  };
}

function isWarehouseGoLiveActive(goLiveAt: string | null, now: Date = new Date()) {
  if (!goLiveAt) return false;
  const parsed = new Date(goLiveAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return now.getTime() >= parsed.getTime();
}

function getWarehouseGoLiveDateValue(goLiveAt: string | null) {
  return formatJakartaDateValue(goLiveAt || '') || WAREHOUSE_GO_LIVE_BASELINE_DATE;
}

function isDateBeforeWarehouseGoLive(date: string, goLiveAt: string | null) {
  return date < getWarehouseGoLiveDateValue(goLiveAt);
}

function isWarehouseGoLiveDate(date: string, goLiveAt: string | null) {
  return date === getWarehouseGoLiveDateValue(goLiveAt);
}

function shouldHidePreGoLiveSystemLedgerRow(
  row: Pick<WarehouseLedgerRow, 'reference_type' | 'created_at'>,
  goLiveAt: string | null,
) {
  const referenceType = String(row.reference_type || '').toLowerCase();
  if (referenceType !== 'scalev_order' && referenceType !== 'rts') return false;
  if (!goLiveAt) return true;

  const createdAt = new Date(row.created_at || '');
  const goLiveParsed = new Date(goLiveAt);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(goLiveParsed.getTime())) return false;
  return createdAt.getTime() < goLiveParsed.getTime();
}

function quantitiesEqual(a: number, b: number) {
  return Math.abs(a - b) <= QUANTITY_EPSILON;
}

function mapsEqualWithTolerance(a: Map<number, number>, b: Map<number, number>) {
  const keys = new Set<number>([...Array.from(a.keys()), ...Array.from(b.keys())]);
  for (const key of Array.from(keys)) {
    const left = a.get(key) || 0;
    const right = b.get(key) || 0;
    if (!quantitiesEqual(left, right)) return false;
  }
  return true;
}

const normalizeAuditArray = normalizeWarehouseActivityLogArray;
const areAuditValuesEqual = areWarehouseActivityLogValuesEqual;
const getAuditChangedFields = getWarehouseActivityLogChangedFields;

function formatAuditWarehouseProductLabel(product: any) {
  if (!product?.id) return null;
  return `${product.name} [${product.warehouse || '-'}-${product.entity || '-'}]`;
}

function normalizeBusinessTargetWarehouse(value: string | null | undefined) {
  return value || 'BTN';
}

type WarehouseBusinessTargetLike = {
  deduct_entity: string;
  deduct_warehouse: string | null;
};

function formatBusinessTargetLabel(target: WarehouseBusinessTargetLike) {
  return `${target.deduct_entity} • ${normalizeBusinessTargetWarehouse(target.deduct_warehouse)}`;
}

function pickPrimaryBusinessTarget(
  mappings: WarehouseBusinessTargetRow[],
): WarehouseBusinessTargetRow | null {
  if (mappings.length === 0) return null;
  return mappings.find((mapping) => Boolean(mapping.is_primary))
    || mappings[0]
    || null;
}

function formatBusinessTargetSummary(mappings: WarehouseBusinessTargetLike[]) {
  if (mappings.length === 0) return '-';
  const uniqueLabels = Array.from(new Set(
    mappings.map((mapping) => formatBusinessTargetLabel(mapping)),
  ));
  return uniqueLabels.length === 1
    ? uniqueLabels[0]
    : uniqueLabels.join(', ');
}

function buildAllowedWarehouseTargetSet(mappings: WarehouseBusinessTargetRow[]) {
  return new Set(
    mappings.map((mapping) => (
      `${mapping.deduct_entity}|${normalizeBusinessTargetWarehouse(mapping.deduct_warehouse)}`
    )),
  );
}

function groupBusinessMappingsByCode(mappings: WarehouseBusinessTargetRow[]) {
  const byCode = new Map<string, WarehouseBusinessTargetRow[]>();
  for (const mapping of mappings) {
    if (!byCode.has(mapping.business_code)) byCode.set(mapping.business_code, []);
    byCode.get(mapping.business_code)!.push(mapping);
  }

  for (const [businessCode, rows] of Array.from(byCode.entries())) {
    byCode.set(businessCode, rows.sort((left, right) => {
      if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
      return Number(left.id || 0) - Number(right.id || 0);
    }));
  }

  return byCode;
}

function isWarehouseTargetAllowed(
  entity: string | null | undefined,
  warehouse: string | null | undefined,
  mappings: WarehouseBusinessTargetRow[],
) {
  if (mappings.length === 0) return false;
  return buildAllowedWarehouseTargetSet(mappings).has(
    `${entity || ''}|${normalizeBusinessTargetWarehouse(warehouse)}`,
  );
}

function aggregateTargetsByProduct(targets: ResolvedWarehouseTarget[]) {
  const grouped = new Map<number, number>();
  for (const target of targets) {
    grouped.set(
      target.warehouse_product_id,
      (grouped.get(target.warehouse_product_id) || 0) + Number(target.quantity || 0),
    );
  }
  return grouped;
}

function aggregateOutstandingByProduct(groups: OutstandingWarehouseLedgerGroup[]) {
  const grouped = new Map<number, number>();
  for (const group of groups) {
    grouped.set(
      group.warehouse_product_id,
      (grouped.get(group.warehouse_product_id) || 0) + Number(group.quantity || 0),
    );
  }
  return grouped;
}

async function resolveScalevOrderWarehouseContext(
  svc: ReturnType<typeof createServiceSupabase>,
  order: ScalevOrderWarehouseSnapshot,
): Promise<ResolvedScalevOrderWarehouseContext> {
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(svc),
    fetchWarehouseOriginRegistryRows(svc),
  ]);

  const rawBusinessName = cleanWarehouseDomainText(order.business_name_raw)
    || extractScalevOrderBusinessNameRaw(order.raw_data, order.business_code)
    || cleanWarehouseDomainText(order.business_code)
    || null;
  const sellerResolution = resolveWarehouseBusinessCode({
    rawValue: rawBusinessName,
    fallbackBusinessCode: cleanWarehouseDomainText(order.seller_business_code) || cleanWarehouseDomainText(order.business_code) || null,
    directoryRows: businessDirectoryRows,
  });

  const rawOriginBusinessName = cleanWarehouseDomainText(order.origin_business_name_raw)
    || extractScalevOrderOriginBusinessNameRaw(order.raw_data)
    || null;
  const originOperatorResolution = resolveWarehouseBusinessCode({
    rawValue: rawOriginBusinessName,
    fallbackBusinessCode: cleanWarehouseDomainText(order.origin_operator_business_code) || null,
    directoryRows: businessDirectoryRows,
  });

  const rawOriginName = cleanWarehouseDomainText(order.origin_raw)
    || extractScalevOrderOriginRaw(order.raw_data)
    || null;
  const originRegistryMatch = resolveWarehouseOrigin({
    rawOriginBusinessName: rawOriginBusinessName,
    rawOriginName: rawOriginName,
    registryRows: originRegistryRows,
  });

  return {
    seller_business_code: sellerResolution.business_code,
    seller_source: sellerResolution.source,
    origin_operator_business_code: originRegistryMatch.operator_business_code
      || originOperatorResolution.business_code
      || null,
    origin_registry_id: originRegistryMatch.id || order.origin_registry_id || null,
    internal_warehouse_code: cleanWarehouseDomainText(originRegistryMatch.internal_warehouse_code) || null,
    raw_business_name: rawBusinessName,
    raw_origin_business_name: rawOriginBusinessName,
    raw_origin_name: rawOriginName,
  };
}

async function resolveScalevLineOwnerBusinessCode(
  svc: ReturnType<typeof createServiceSupabase>,
  line: ScalevOrderLineForWarehouse,
  fallbackOwnerBusinessCode?: string | null,
  businessDirectoryRows?: WarehouseBusinessDirectoryRow[],
) {
  const rawOwner = cleanWarehouseDomainText(line.item_owner_raw);
  if (line.stock_owner_business_code) {
    return {
      owner_business_code: cleanWarehouseDomainText(line.stock_owner_business_code),
      source: 'order_line' as const,
      raw_owner: rawOwner,
    };
  }

  const rows = businessDirectoryRows || await fetchWarehouseBusinessDirectoryRows(svc);
  const resolution = resolveWarehouseBusinessCode({
    rawValue: rawOwner,
    fallbackBusinessCode: rawOwner ? null : cleanWarehouseDomainText(fallbackOwnerBusinessCode) || null,
    directoryRows: rows,
  });

  return {
    owner_business_code: resolution.business_code,
    source: resolution.source === 'none'
      ? ('none' as const)
      : resolution.source === 'directory'
        ? ('directory' as const)
        : ('catalog_fallback' as const),
    raw_owner: rawOwner,
  };
}

async function loadScalevOrderWarehouseSnapshot(
  svc: ReturnType<typeof createServiceSupabase>,
  orderId: string,
  scalevOrderDbId?: number | null,
): Promise<ScalevOrderWarehouseSnapshot | null> {
  if (scalevOrderDbId != null) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select(`
        id,
        order_id,
        business_code,
        business_name_raw,
        origin_business_name_raw,
        origin_raw,
        seller_business_code,
        origin_operator_business_code,
        origin_registry_id,
        raw_data,
        status,
        shipped_time,
        completed_time
      `)
      .eq('id', scalevOrderDbId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as ScalevOrderWarehouseSnapshot;
  }

  const { data, error } = await svc
    .from('scalev_orders')
    .select(`
      id,
      order_id,
      business_code,
      business_name_raw,
      origin_business_name_raw,
      origin_raw,
      seller_business_code,
      origin_operator_business_code,
      origin_registry_id,
      raw_data,
      status,
      shipped_time,
      completed_time
    `)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as ScalevOrderWarehouseSnapshot | null) || null;
}

async function getScalevOrderWarehouseLines(
  svc: ReturnType<typeof createServiceSupabase>,
  scalevOrderDbId: number,
) {
  const { data, error } = await svc
    .from('scalev_order_lines')
    .select('product_name, quantity, variant_sku, item_name_raw, item_owner_raw, stock_owner_business_code')
    .eq('scalev_order_id', scalevOrderDbId);
  if (error) throw error;

  return (data || [])
    .filter((line: any) => line.product_name && Number(line.quantity) > 0)
    .map((line: any) => ({
      product_name: line.product_name,
      quantity: Number(line.quantity),
      variant_sku: line.variant_sku || null,
      item_name_raw: line.item_name_raw || line.product_name || null,
      item_owner_raw: line.item_owner_raw || null,
      stock_owner_business_code: line.stock_owner_business_code || null,
    })) as ScalevOrderLineForWarehouse[];
}

async function resolveWarehouseTargetsForOrder(
  svc: ReturnType<typeof createServiceSupabase>,
  order: ScalevOrderWarehouseSnapshot,
) {
  const productLines = await getScalevOrderWarehouseLines(svc, order.id);
  const orderContext = await resolveScalevOrderWarehouseContext(svc, order);
  const mappingBusinessCode = cleanWarehouseDomainText(orderContext.seller_business_code)
    || cleanWarehouseDomainText(order.business_code)
    || null;
  const mappingRows = mappingBusinessCode
    ? await fetchBusinessMappingsByCodes(svc, [mappingBusinessCode])
    : [];
  const mappingGroups = groupBusinessMappingsByCode(mappingRows);
  const mappings = mappingBusinessCode
    ? (mappingGroups.get(mappingBusinessCode) || [])
    : [];
  const primaryBusinessMapping = pickPrimaryBusinessTarget(mappings);
  const catalogBusinessCode = cleanWarehouseDomainText(orderContext.seller_business_code)
    || cleanWarehouseDomainText(order.business_code)
    || null;

  if (!catalogBusinessCode && !primaryBusinessMapping) {
    return {
      productLines,
      targets: [] as ResolvedWarehouseTarget[],
      desiredByProduct: new Map<number, number>(),
      unmappedProducts: productLines.map(line => line.product_name),
      skippedIgnored: 0,
      mapping: null,
      allowedMappings: [] as Array<{ deduct_entity: string; deduct_warehouse: string }>,
    };
  }

  const businessDirectoryRows = await fetchWarehouseBusinessDirectoryRows(svc);
  const linesByBusinessCode = new Map<string, ScalevOrderLineForWarehouse[]>();
  if (catalogBusinessCode) {
    linesByBusinessCode.set(catalogBusinessCode, productLines);
  }

  const context = await buildCatalogResolutionContext(
    svc,
    catalogBusinessCode ? [catalogBusinessCode] : [],
    linesByBusinessCode,
  );
  const catalogBusinessId = catalogBusinessCode
    ? (context.catalogBusinessIdByCode.get(catalogBusinessCode) || null)
    : null;
  const scalevMappings = await fetchScalevMappingsByProductNames(
    svc,
    Array.from(new Set(productLines.map(line => line.product_name))),
  );
  const scalevMappingByName = new Map<string, WarehouseScalevMappingRow>();
  for (const scalevMapping of scalevMappings) {
    scalevMappingByName.set(scalevMapping.scalev_product_name, scalevMapping);
  }

  const targets: ResolvedWarehouseTarget[] = [];
  const unmappedProducts: string[] = [];
  let skippedIgnored = 0;
  const allowedMappings = new Map<string, { deduct_entity: string; deduct_warehouse: string }>();

  for (const line of productLines) {
    const catalogTargets = resolveCatalogWarehouseTargetsForLine({
      businessId: catalogBusinessId,
      line,
      identifiersByBusinessId: context.identifiersByBusinessId,
      bundleLinesByBusinessId: context.bundleLinesByBusinessId,
      directEntitiesByViewerKey: context.directEntitiesByViewerKey,
      canonicalMappingsByKey: context.canonicalMappingsByKey,
    });
    const scalevMapping = scalevMappingByName.get(line.product_name);

    if ((!catalogTargets || catalogTargets.length === 0) && scalevMapping?.is_ignored) {
      skippedIgnored++;
      continue;
    }

    let matchedAnyTarget = false;
    const targetNoteBase = mappingBusinessCode && mappings.length > 0
      ? `${mappingBusinessCode}\u2192${formatBusinessTargetSummary(mappings)}`
      : catalogBusinessCode
        ? `${catalogBusinessCode}\u2192${orderContext.internal_warehouse_code || '-'}`
        : `${order.business_code || '-'}\u2192-`;

    for (const catalogTarget of catalogTargets || []) {
      const ownerResolution = await resolveScalevLineOwnerBusinessCode(
        svc,
        line,
        catalogTarget.owner_business_code,
        businessDirectoryRows,
      );
      const ownerBusinessCode = cleanWarehouseDomainText(ownerResolution.owner_business_code);
      const targetEntity = cleanWarehouseDomainText(catalogTarget.entity);
      const targetWarehouse = cleanWarehouseDomainText(catalogTarget.warehouse);
      const ownerSourceLabel = ownerResolution.source === 'order_line'
        ? 'owner-line'
        : ownerResolution.source === 'directory'
          ? 'owner-directory'
          : ownerResolution.source === 'catalog_fallback'
            ? 'owner-catalog-fallback'
            : 'owner-missing';

      if (orderContext.internal_warehouse_code) {
        if (!ownerBusinessCode) continue;
        if (targetEntity && targetEntity !== ownerBusinessCode) continue;
        if (targetWarehouse && targetWarehouse !== orderContext.internal_warehouse_code) continue;

        matchedAnyTarget = true;
        allowedMappings.set(
          `${ownerBusinessCode}|${orderContext.internal_warehouse_code}`,
          {
            deduct_entity: ownerBusinessCode,
            deduct_warehouse: orderContext.internal_warehouse_code,
          },
        );

        targets.push({
          warehouse_product_id: Number(catalogTarget.warehouse_product_id),
          scalev_product_name: catalogTarget.scalev_label,
          quantity: Number(line.quantity) * Number(catalogTarget.quantity_multiplier || 1),
          note_context: `${catalogBusinessCode}\u2192${ownerBusinessCode}@${orderContext.origin_operator_business_code || '-'}:${orderContext.internal_warehouse_code} via ${catalogTarget.note_suffix} [${ownerSourceLabel}]`,
          owner_business_code: ownerBusinessCode,
        });
        continue;
      }

      if (!targetEntity || !isWarehouseTargetAllowed(targetEntity, targetWarehouse, mappings)) {
        continue;
      }

      matchedAnyTarget = true;
      allowedMappings.set(
        `${targetEntity}|${targetWarehouse || 'BTN'}`,
        {
          deduct_entity: targetEntity,
          deduct_warehouse: targetWarehouse || 'BTN',
        },
      );

      targets.push({
        warehouse_product_id: Number(catalogTarget.warehouse_product_id),
        scalev_product_name: catalogTarget.scalev_label,
        quantity: Number(line.quantity) * Number(catalogTarget.quantity_multiplier || 1),
        note_context: `${targetNoteBase} via ${catalogTarget.note_suffix} [${ownerSourceLabel}]`,
        owner_business_code: targetEntity,
      });
    }

    if (matchedAnyTarget) {
      continue;
    }

    if (catalogTargets && catalogTargets.length > 0) {
      unmappedProducts.push(line.product_name);
      continue;
    }

    let targetProductId: number | null = null;
    let deductQty = Number(line.quantity);
    let targetNote = targetNoteBase;

    if (
      scalevMapping?.warehouse_product_id
      && !isSuspiciousLegacyScalevTarget({
        scalevProductName: line.product_name,
        mapping: scalevMapping,
        allowedTargets: mappings.length > 0 ? mappings : null,
        deductEntity: primaryBusinessMapping?.deduct_entity || null,
        deductWarehouse: primaryBusinessMapping?.deduct_warehouse || orderContext.internal_warehouse_code || 'BTN',
      })
    ) {
      targetProductId = Number(scalevMapping.warehouse_product_id);
      deductQty = Number(line.quantity) * Number(scalevMapping.deduct_qty_multiplier || 1);
      targetNote = `${targetNoteBase} via legacy`;
    } else {
      for (const allowedMapping of mappings) {
        const { data: whProducts, error: whProductsErr } = await svc
          .rpc('warehouse_find_product_for_deduction', {
            p_scalev_name: line.product_name,
            p_entity: allowedMapping.deduct_entity,
            p_warehouse: allowedMapping.deduct_warehouse || 'BTN',
          });
        if (whProductsErr) throw whProductsErr;
        if (whProducts && whProducts.length > 0) {
          targetProductId = Number(whProducts[0].id);
          targetNote = `${targetNoteBase} via fallback:${allowedMapping.deduct_entity}`;
          break;
        }
      }
    }

    if (targetProductId == null) {
      unmappedProducts.push(line.product_name);
      continue;
    }

    if (primaryBusinessMapping) {
      allowedMappings.set(
        `${primaryBusinessMapping.deduct_entity}|${primaryBusinessMapping.deduct_warehouse || 'BTN'}`,
        {
          deduct_entity: primaryBusinessMapping.deduct_entity,
          deduct_warehouse: primaryBusinessMapping.deduct_warehouse || 'BTN',
        },
      );
    }
    targets.push({
      warehouse_product_id: targetProductId,
      scalev_product_name: line.product_name,
      quantity: deductQty,
      note_context: targetNote,
      owner_business_code: primaryBusinessMapping?.deduct_entity || null,
    });
  }

  const allowedMappingsList = Array.from(allowedMappings.values());
  const derivedMapping = allowedMappingsList[0]
    ? {
        deduct_entity: allowedMappingsList[0].deduct_entity,
        deduct_warehouse: allowedMappingsList[0].deduct_warehouse,
      }
    : null;

  return {
    productLines,
    targets,
    desiredByProduct: aggregateTargetsByProduct(targets),
    unmappedProducts,
    skippedIgnored,
    mapping: derivedMapping
      ? {
          deduct_entity: derivedMapping.deduct_entity,
          deduct_warehouse: derivedMapping.deduct_warehouse || orderContext.internal_warehouse_code || primaryBusinessMapping?.deduct_warehouse || 'BTN',
        }
      : primaryBusinessMapping
        ? {
            deduct_entity: primaryBusinessMapping.deduct_entity,
            deduct_warehouse: primaryBusinessMapping.deduct_warehouse || orderContext.internal_warehouse_code || 'BTN',
          }
        : null,
    allowedMappings: allowedMappingsList.length > 0
      ? allowedMappingsList
      : mappings.map((row) => ({
          deduct_entity: row.deduct_entity,
          deduct_warehouse: row.deduct_warehouse || 'BTN',
        })),
  };
}

async function getScalevOrderLedgerRowsDetailed(
  svc: ReturnType<typeof createServiceSupabase>,
  orderId: string,
  scalevOrderDbId?: number | null,
) {
  const selectFields = 'id, warehouse_product_id, batch_id, quantity, movement_type, notes, created_at, reference_id, scalev_order_id';

  if (scalevOrderDbId != null) {
    const { data, error } = await svc
      .from('warehouse_stock_ledger')
      .select(selectFields)
      .eq('reference_type', 'scalev_order')
      .eq('scalev_order_id', scalevOrderDbId)
      .order('created_at', { ascending: true });
    if (error && !isMissingScalevOrderIdColumnError(error)) {
      throw error;
    }
    if (data && data.length > 0) {
      return (data as any[]).map((row) => ({
        ...row,
        warehouse_product_id: Number(row.warehouse_product_id),
        batch_id: row.batch_id == null ? null : Number(row.batch_id),
        quantity: Number(row.quantity),
      })) as WarehouseLedgerRow[];
    }
  }

  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select('id, warehouse_product_id, batch_id, quantity, movement_type, notes, created_at, reference_id')
    .eq('reference_type', 'scalev_order')
    .eq('reference_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...row,
    warehouse_product_id: Number(row.warehouse_product_id),
    batch_id: row.batch_id == null ? null : Number(row.batch_id),
    quantity: Number(row.quantity),
  })) as WarehouseLedgerRow[];
}

async function getScalevOrderRtsRowsDetailed(
  svc: ReturnType<typeof createServiceSupabase>,
  orderId: string,
  scalevOrderDbId?: number | null,
) {
  const selectFields = 'id, warehouse_product_id, batch_id, quantity, movement_type, notes, created_at, reference_id, scalev_order_id';

  if (scalevOrderDbId != null) {
    const { data, error } = await svc
      .from('warehouse_stock_ledger')
      .select(selectFields)
      .eq('reference_type', 'rts')
      .eq('scalev_order_id', scalevOrderDbId)
      .order('created_at', { ascending: true });
    if (error && !isMissingScalevOrderIdColumnError(error)) {
      throw error;
    }
    if (data && data.length > 0) {
      return (data as any[]).map((row) => ({
        ...row,
        warehouse_product_id: Number(row.warehouse_product_id),
        batch_id: row.batch_id == null ? null : Number(row.batch_id),
        quantity: Number(row.quantity),
      })) as WarehouseLedgerRow[];
    }
  }

  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select('id, warehouse_product_id, batch_id, quantity, movement_type, notes, created_at, reference_id')
    .eq('reference_type', 'rts')
    .eq('reference_id', orderId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...row,
    warehouse_product_id: Number(row.warehouse_product_id),
    batch_id: row.batch_id == null ? null : Number(row.batch_id),
    quantity: Number(row.quantity),
  })) as WarehouseLedgerRow[];
}

function summarizeOutstandingLedgerGroups(rows: WarehouseLedgerRow[]) {
  const grouped = new Map<string, OutstandingWarehouseLedgerGroup & { netQty: number }>();

  for (const row of rows) {
    const key = `${row.warehouse_product_id}::${row.batch_id ?? 'null'}`;
    const current = grouped.get(key) || {
      warehouse_product_id: row.warehouse_product_id,
      batch_id: row.batch_id ?? null,
      quantity: 0,
      netQty: 0,
    };
    current.netQty += Number(row.quantity || 0);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .filter(group => group.netQty < -QUANTITY_EPSILON)
    .map(group => ({
      warehouse_product_id: group.warehouse_product_id,
      batch_id: group.batch_id,
      quantity: Math.abs(group.netQty),
    }));
}

function summarizePositiveLedgerByProduct(rows: WarehouseLedgerRow[]) {
  const grouped = new Map<number, number>();
  for (const row of rows) {
    const qty = Number(row.quantity || 0);
    if (qty <= QUANTITY_EPSILON) continue;
    grouped.set(
      row.warehouse_product_id,
      (grouped.get(row.warehouse_product_id) || 0) + qty,
    );
  }
  return grouped;
}

async function assessScalevOrderWarehouseState(
  svc: ReturnType<typeof createServiceSupabase>,
  order: ScalevOrderWarehouseSnapshot,
): Promise<ScalevOrderWarehouseAssessment> {
  const resolved = await resolveWarehouseTargetsForOrder(svc, order);
  const ledgerRows = await getScalevOrderLedgerRowsDetailed(svc, order.order_id, order.id);
  const outstandingGroups = summarizeOutstandingLedgerGroups(ledgerRows);

  return {
    order,
    productLines: resolved.productLines,
    targets: resolved.targets,
    desiredByProduct: resolved.desiredByProduct,
    outstandingGroups,
    outstandingByProduct: aggregateOutstandingByProduct(outstandingGroups),
    unmappedProducts: resolved.unmappedProducts,
    skippedIgnored: resolved.skippedIgnored,
    mapping: resolved.mapping,
    allowedMappings: resolved.allowedMappings,
  };
}

function buildWarehousePreGoLiveRtsNote(order: ScalevOrderWarehouseSnapshot) {
  const effectiveDateLabel = formatWarehouseSystemDateLabel(getScalevOrderWarehouseEffectiveAt(order));
  const statusLabel = String(order.status || '').toUpperCase();
  return `RTS pra-stock opname untuk order ID ${order.order_id}${effectiveDateLabel ? ` tanggal ${effectiveDateLabel}` : ''}. Barang kembali setelah warehouse go-live${statusLabel ? ` [${statusLabel}]` : ''}.`;
}

async function applyPreGoLiveScalevReturn(
  svc: ReturnType<typeof createServiceSupabase>,
  assessment: ScalevOrderWarehouseAssessment,
) {
  if (!assessment.mapping || assessment.productLines.length === 0) {
    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.unmappedProducts.length > 0) {
    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.targets.length === 0) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const existingRtsRows = await getScalevOrderRtsRowsDetailed(svc, assessment.order.order_id, assessment.order.id);
  const existingRtsByProduct = summarizePositiveLedgerByProduct(existingRtsRows);
  if (mapsEqualWithTolerance(existingRtsByProduct, assessment.desiredByProduct)) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const rtsNote = buildWarehousePreGoLiveRtsNote(assessment.order);
  let deducted = 0;
  for (const [warehouseProductId, desiredQty] of Array.from(assessment.desiredByProduct.entries())) {
    const existingQty = existingRtsByProduct.get(warehouseProductId) || 0;
    const remainingQty = Number(desiredQty) - Number(existingQty);
    if (remainingQty <= QUANTITY_EPSILON) continue;

    await insertLedgerEntry(svc, {
      warehouse_product_id: warehouseProductId,
      batch_id: null,
      movement_type: 'IN',
      quantity: remainingQty,
      reference_type: 'rts',
      reference_id: assessment.order.order_id,
      scalev_order_id: assessment.order.id,
      notes: rtsNote,
      created_at: new Date().toISOString(),
    });
    deducted++;
  }

  return {
    action: deducted > 0 ? 'pre_go_live_rts' : 'unchanged',
    reversed: 0,
    deducted,
    skipped: assessment.skippedIgnored,
    unmapped_products: [],
  };
}

function buildWarehouseIssueSummary(assessment: ScalevOrderWarehouseAssessment) {
  if (assessment.productLines.length === 0) {
    return {
      problem: 'no_order_lines',
      problem_detail: `Order ${assessment.order.order_id} tidak punya order lines`,
    };
  }

  if (assessment.unmappedProducts.length > 0) {
    const mappingSummary = formatBusinessTargetSummary(assessment.allowedMappings || []);
    return {
      problem: 'no_product_mapping',
      problem_detail: mappingSummary
        ? `Produk belum punya visible entity atau mapping processor yang valid ke gudang diizinkan (${mappingSummary}): ${assessment.unmappedProducts.join(', ')}`
        : `Produk belum punya visible entity atau mapping processor warehouse yang valid: ${assessment.unmappedProducts.join(', ')}`,
    };
  }

  if (!assessment.mapping) {
    return {
      problem: 'no_business_mapping',
      problem_detail: `Belum ada processor business dengan warehouse mapping aktif untuk order ${assessment.order.order_id}.`,
    };
  }

  return {
    problem: 'unknown',
    problem_detail: 'Deduction warehouse belum sinkron dengan shipment Scalev',
  };
}

function buildWarehouseRtsVerificationQueueItems(
  assessment: ScalevOrderWarehouseAssessment,
): WarehouseRtsVerificationQueueItem[] {
  const grouped = new Map<number, { expected_qty: number; labels: Set<string> }>();

  for (const target of assessment.targets) {
    const productId = Number(target.warehouse_product_id || 0);
    if (!productId) continue;
    if (!grouped.has(productId)) {
      grouped.set(productId, {
        expected_qty: 0,
        labels: new Set<string>(),
      });
    }

    const bucket = grouped.get(productId)!;
    bucket.expected_qty += Number(target.quantity || 0);
    if (target.scalev_product_name) {
      bucket.labels.add(String(target.scalev_product_name).trim());
    }
  }

  return Array.from(grouped.entries())
    .map(([warehouse_product_id, value]) => ({
      warehouse_product_id,
      scalev_product_summary: Array.from(value.labels).filter(Boolean).join(', '),
      expected_qty: Number(value.expected_qty || 0),
    }))
    .filter((item) => item.expected_qty > QUANTITY_EPSILON);
}

async function syncWarehouseRtsVerificationItems(
  svc: ReturnType<typeof createServiceSupabase>,
  verificationId: number,
  items: WarehouseRtsVerificationQueueItem[],
) {
  const { data: existingRows, error: existingErr } = await svc
    .from('warehouse_rts_verification_items')
    .select('id, warehouse_product_id')
    .eq('verification_id', verificationId);
  if (existingErr) throw existingErr;

  const existingByProductId = new Map<number, any>();
  for (const row of existingRows || []) {
    existingByProductId.set(Number(row.warehouse_product_id), row);
  }

  const seenProductIds = new Set<number>();
  const now = new Date().toISOString();

  for (const item of items) {
    seenProductIds.add(Number(item.warehouse_product_id));
    const existing = existingByProductId.get(Number(item.warehouse_product_id));

    const payload: Record<string, any> = {
      verification_id: verificationId,
      warehouse_product_id: Number(item.warehouse_product_id),
      scalev_product_summary: item.scalev_product_summary || null,
      expected_qty: Number(item.expected_qty || 0),
      updated_at: now,
    };

    if (existing) {
      const { error: updateErr } = await svc
        .from('warehouse_rts_verification_items')
        .update(payload)
        .eq('id', Number(existing.id));
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await svc
        .from('warehouse_rts_verification_items')
        .insert({
          ...payload,
          created_at: now,
        });
      if (insertErr) throw insertErr;
    }
  }

  const staleIds = (existingRows || [])
    .filter((row: any) => !seenProductIds.has(Number(row.warehouse_product_id)))
    .map((row: any) => Number(row.id))
    .filter(Boolean);
  if (staleIds.length > 0) {
    const { error: deleteErr } = await svc
      .from('warehouse_rts_verification_items')
      .delete()
      .in('id', staleIds);
    if (deleteErr) throw deleteErr;
  }
}

async function cancelPendingWarehouseRtsVerification(
  svc: ReturnType<typeof createServiceSupabase>,
  scalevOrderId: number,
  orderStatus?: string | null,
) {
  const { data, error } = await svc
    .from('warehouse_rts_verifications')
    .update({
      status: 'cancelled',
      order_status: orderStatus || null,
      updated_at: new Date().toISOString(),
    })
    .eq('scalev_order_id', scalevOrderId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.id) : null;
}

async function upsertPendingWarehouseRtsVerification(
  svc: ReturnType<typeof createServiceSupabase>,
  input: {
    assessment: ScalevOrderWarehouseAssessment;
    scope: WarehouseRtsVerificationScope;
    expectedTotalQty: number;
    notes?: string | null;
  },
) {
  const now = new Date().toISOString();
  const { assessment, scope } = input;
  const { data: existing, error: existingErr } = await svc
    .from('warehouse_rts_verifications')
    .select('id, status')
    .eq('scalev_order_id', assessment.order.id)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing?.status === 'completed') {
    return {
      verificationId: Number(existing.id),
      existingCompleted: true,
    };
  }

  const payload = {
    scalev_order_id: assessment.order.id,
    order_id: assessment.order.order_id,
    business_code: assessment.order.business_code || null,
    order_status: assessment.order.status || null,
    scope,
    status: 'pending' as WarehouseRtsVerificationStatus,
    expected_total_qty: Number(input.expectedTotalQty || 0),
    notes: input.notes?.trim() || null,
    triggered_at: now,
    updated_at: now,
  };

  if (existing?.id) {
    const { data: refreshed, error: updateErr } = await svc
      .from('warehouse_rts_verifications')
      .update({
        ...payload,
        completed_at: null,
        reviewed_by: null,
      })
      .eq('id', Number(existing.id))
      .select('id')
      .single();
    if (updateErr) throw updateErr;
    return {
      verificationId: Number(refreshed.id),
      existingCompleted: false,
      existingId: Number(existing.id),
    };
  }

  const { data: created, error: insertErr } = await svc
    .from('warehouse_rts_verifications')
    .insert({
      ...payload,
      created_at: now,
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;
  return {
    verificationId: Number(created.id),
    existingCompleted: false,
    existingId: null,
  };
}

async function queueWarehouseRtsVerification(
  svc: ReturnType<typeof createServiceSupabase>,
  assessment: ScalevOrderWarehouseAssessment,
  scope: WarehouseRtsVerificationScope,
) {
  const issueSummary = buildWarehouseIssueSummary(assessment);
  if (!assessment.mapping || assessment.productLines.length === 0) {
    const header = await upsertPendingWarehouseRtsVerification(svc, {
      assessment,
      scope,
      expectedTotalQty: assessment.productLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      notes: issueSummary.problem_detail,
    });
    await syncWarehouseRtsVerificationItems(svc, header.verificationId, []);

    if (header.existingCompleted) {
      return {
        action: 'rts_already_verified',
        reversed: 0,
        deducted: 0,
        skipped: assessment.skippedIgnored,
        unmapped_products: assessment.unmappedProducts,
        verification_id: header.verificationId,
      };
    }

    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      verification_id: header.verificationId,
      ...issueSummary,
    };
  }

  const items = buildWarehouseRtsVerificationQueueItems(assessment);
  if (items.length === 0) {
    const header = await upsertPendingWarehouseRtsVerification(svc, {
      assessment,
      scope,
      expectedTotalQty: assessment.productLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      notes: issueSummary.problem_detail,
    });
    await syncWarehouseRtsVerificationItems(svc, header.verificationId, []);

    if (header.existingCompleted) {
      return {
        action: 'rts_already_verified',
        reversed: 0,
        deducted: 0,
        skipped: assessment.skippedIgnored,
        unmapped_products: assessment.unmappedProducts,
        verification_id: header.verificationId,
      };
    }

    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      verification_id: header.verificationId,
      ...issueSummary,
    };
  }

  const expectedTotalQty = items.reduce((sum, item) => sum + Number(item.expected_qty || 0), 0);
  const header = await upsertPendingWarehouseRtsVerification(svc, {
    assessment,
    scope,
    expectedTotalQty,
    notes: assessment.unmappedProducts.length > 0 ? issueSummary.problem_detail : null,
  });
  if (header.existingCompleted) {
    return {
      action: 'rts_already_verified',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      verification_id: header.verificationId,
    };
  }
  const verificationId = header.verificationId;
  await syncWarehouseRtsVerificationItems(svc, verificationId, items);

  const action = assessment.unmappedProducts.length > 0
    ? 'rts_verification_partial'
    : header.existingId
      ? 'rts_verification_pending'
      : 'rts_verification_needed';

  return {
    action,
    reversed: 0,
    deducted: 0,
    skipped: assessment.skippedIgnored,
    unmapped_products: assessment.unmappedProducts,
    verification_id: verificationId,
    ...(assessment.unmappedProducts.length > 0 ? buildWarehouseIssueSummary(assessment) : {}),
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildWarehouseFallbackLookupKey(scalevName: string, entity?: string | null, warehouse?: string | null) {
  return `${scalevName}::${entity || ''}::${warehouse || ''}`;
}

function normalizeScalevRuntimeIdentifier(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeScalevLegacyIdentifier(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function extractRooveLegacyVariantToken(value: string | null | undefined) {
  const tokens = normalizeScalevRuntimeIdentifier(value)
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const rooveIndex = tokens.indexOf('roove');
  if (rooveIndex === -1) return null;
  if (!tokens.includes('sc') && !tokens.includes('sachet')) return null;

  for (const token of tokens.slice(rooveIndex + 1)) {
    if (!token) continue;
    if (/^\d+$/.test(token)) continue;
    if (token === 'sc' || token === 'sachet' || token === 'box') continue;
    return token;
  }

  return null;
}

function isSuspiciousLegacyScalevTarget(args: {
  scalevProductName: string;
  mapping: WarehouseScalevMappingRow | null | undefined;
  deductEntity?: string | null;
  deductWarehouse?: string | null;
  allowedTargets?: WarehouseBusinessTargetRow[] | null;
}) {
  const target = args.mapping?.warehouse_products;
  if (!target) return false;

  if (args.allowedTargets && args.allowedTargets.length > 0) {
    if (!isWarehouseTargetAllowed(target.entity, target.warehouse, args.allowedTargets)) {
      return true;
    }
  } else if (args.deductEntity && target.entity && target.entity !== args.deductEntity) {
    return true;
  }

  if (!args.allowedTargets?.length && args.deductWarehouse && target.warehouse && target.warehouse !== args.deductWarehouse) {
    return true;
  }

  const sourceVariant = extractRooveLegacyVariantToken(args.scalevProductName);
  if (!sourceVariant) return false;

  const targetVariants = new Set(
    [target.name, ...(target.scalev_product_names || [])]
      .map(extractRooveLegacyVariantToken)
      .filter((value): value is string => Boolean(value)),
  );

  if (targetVariants.size === 0) return true;
  return !targetVariants.has(sourceVariant);
}

function getScalevIdentifierQueryCandidates(value: string | null | undefined) {
  return Array.from(new Set([
    normalizeScalevLegacyIdentifier(value),
    normalizeScalevRuntimeIdentifier(value),
  ].filter(Boolean)));
}

function isMissingWarehouseTableError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

const WAREHOUSE_RTS_META_MARKER = '[RTS_META]';
const WAREHOUSE_RETURN_TARGET_TOKEN_STOPWORDS = new Set([
  'fg',
  'sachet',
  'packaging',
  'wip',
  'material',
  'bonus',
  'other',
  'non',
  'stiker',
  'sticker',
  'pcs',
  'box',
]);

function sanitizeWarehouseRtsReturnMode(value: any): WarehouseRtsReturnMode {
  return value === 'decompose' ? 'decompose' : 'same_product';
}

function normalizeWarehouseRtsAllocationSnapshot(value: any): WarehouseRtsAllocationSnapshot | null {
  const warehouseProductId = Number(value?.warehouse_product_id || 0);
  const quantity = Number(value?.quantity || 0);
  if (warehouseProductId <= 0 || quantity <= QUANTITY_EPSILON) return null;

  return {
    warehouse_product_id: warehouseProductId,
    warehouse_product_name: value?.warehouse_product_name ? String(value.warehouse_product_name) : null,
    warehouse_product_category: value?.warehouse_product_category ? String(value.warehouse_product_category) : null,
    quantity,
    target_batch_id: value?.target_batch_id == null ? null : Number(value.target_batch_id),
    target_batch_code_snapshot: value?.target_batch_code_snapshot ? String(value.target_batch_code_snapshot) : null,
    notes: value?.notes ? String(value.notes) : null,
  };
}

function buildWarehouseRtsItemStoredNotes(args: {
  userNotes?: string | null;
  mode: WarehouseRtsReturnMode;
  allocations: WarehouseRtsAllocationSnapshot[];
}) {
  const userNotes = args.userNotes?.trim() || '';
  const payload = JSON.stringify({
    mode: sanitizeWarehouseRtsReturnMode(args.mode),
    allocations: (args.allocations || [])
      .map(normalizeWarehouseRtsAllocationSnapshot)
      .filter((row): row is WarehouseRtsAllocationSnapshot => Boolean(row)),
  });
  return `${userNotes}${userNotes ? '\n' : ''}${WAREHOUSE_RTS_META_MARKER}${payload}`;
}

function parseWarehouseRtsItemStoredNotes(value: any): {
  userNotes: string | null;
  mode: WarehouseRtsReturnMode;
  allocations: WarehouseRtsAllocationSnapshot[];
} {
  const raw = String(value || '');
  const markerIndex = raw.lastIndexOf(WAREHOUSE_RTS_META_MARKER);
  if (markerIndex === -1) {
    return {
      userNotes: raw.trim() || null,
      mode: 'same_product',
      allocations: [],
    };
  }

  const userNotes = raw.slice(0, markerIndex).trim() || null;
  const payloadText = raw.slice(markerIndex + WAREHOUSE_RTS_META_MARKER.length).trim();

  try {
    const payload = JSON.parse(payloadText);
    const allocations = Array.isArray(payload?.allocations)
      ? payload.allocations
        .map(normalizeWarehouseRtsAllocationSnapshot)
        .filter((row: WarehouseRtsAllocationSnapshot | null): row is WarehouseRtsAllocationSnapshot => Boolean(row))
      : [];

    return {
      userNotes,
      mode: sanitizeWarehouseRtsReturnMode(payload?.mode),
      allocations,
    };
  } catch {
    return {
      userNotes: raw.trim() || null,
      mode: 'same_product',
      allocations: [],
    };
  }
}

function tokenizeWarehouseReturnTargetName(value: string | null | undefined) {
  return normalizeScalevRuntimeIdentifier(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && !WAREHOUSE_RETURN_TARGET_TOKEN_STOPWORDS.has(token));
}

function scoreWarehouseRtsReturnTarget(source: any, candidate: any) {
  if (!source || !candidate) return 0;
  if (Number(source.id) === Number(candidate.id)) return 10000;

  const sourceTokens = tokenizeWarehouseReturnTargetName(source.name);
  const candidateTokens = tokenizeWarehouseReturnTargetName(candidate.name);
  const candidateSet = new Set(candidateTokens);
  let score = 0;

  for (const token of sourceTokens) {
    if (candidateSet.has(token)) score += /^\d+$/.test(token) ? 40 : 90;
  }

  if (candidate.category === source.category) score += 15;
  if (candidate.category === 'wip') score += 18;
  if (candidate.category === 'wip_material') score += 16;
  if (candidate.category === 'packaging') score += 10;
  if (candidate.category === 'sachet') score += 12;

  return score;
}

function getCatalogIdentifierSourcePriority(source: string, mode: 'variant_sku' | 'product_name') {
  if (mode === 'variant_sku') {
    if (source === 'variant.unique_id') return 100;
    if (source === 'variant.sku') return 90;
    if (source === 'variant.uuid') return 80;
    if (source === 'bundle.price_option_unique_id') return 96;
    if (source === 'bundle.price_option_slug') return 94;
    if (source === 'bundle.custom_id') return 92;
    return 10;
  }

  if (source === 'bundle.custom_id') return 99;
  if (source === 'bundle.price_option_unique_id') return 97;
  if (source === 'bundle.price_option_slug') return 95;
  if (source === 'bundle.display') return 93;
  if (source === 'bundle.public_name') return 91;
  if (source === 'bundle.name') return 89;
  if (source === 'variant.name') return 90;
  if (source === 'product.display') return 80;
  if (source === 'product.public_name') return 75;
  if (source === 'product.name') return 70;
  if (source === 'variant.product_name') return 55;
  if (source === 'product.slug') return 35;
  return 20;
}

function buildCatalogIdentifierLookupMap(rows: ScalevCatalogIdentifierLookupRow[]) {
  const byBusinessId = new Map<number, Map<string, ScalevCatalogIdentifierLookupRow[]>>();

  for (const row of rows) {
    if (!byBusinessId.has(row.business_id)) {
      byBusinessId.set(row.business_id, new Map<string, ScalevCatalogIdentifierLookupRow[]>());
    }
    const identifierMap = byBusinessId.get(row.business_id)!;
    const lookupKeys = Array.from(new Set([
      row.identifier_normalized,
      ...getScalevIdentifierQueryCandidates(row.identifier),
      ...getScalevIdentifierQueryCandidates(row.identifier_normalized),
    ].filter(Boolean)));

    for (const lookupKey of lookupKeys) {
      if (!identifierMap.has(lookupKey)) {
        identifierMap.set(lookupKey, []);
      }
      identifierMap.get(lookupKey)!.push(row);
    }
  }

  return byBusinessId;
}

function buildCatalogMappingLookupMap(rows: WarehouseScalevCatalogMappingRow[]) {
  const byBusinessId = new Map<number, Map<string, WarehouseScalevCatalogMappingRow>>();

  for (const row of rows) {
    if (!byBusinessId.has(row.business_id)) {
      byBusinessId.set(row.business_id, new Map<string, WarehouseScalevCatalogMappingRow>());
    }
    byBusinessId.get(row.business_id)!.set(row.scalev_entity_key, row);
  }

  return byBusinessId;
}

function buildCatalogBundleLineLookupMap(rows: ScalevCatalogBundleLineLookupRow[]) {
  const byBusinessId = new Map<number, Map<string, ScalevCatalogBundleLineLookupRow[]>>();

  for (const row of rows) {
    if (!byBusinessId.has(row.business_id)) {
      byBusinessId.set(row.business_id, new Map<string, ScalevCatalogBundleLineLookupRow[]>());
    }
    const bundleKey = `bundle:${row.scalev_bundle_id}`;
    const bundleMap = byBusinessId.get(row.business_id)!;
    if (!bundleMap.has(bundleKey)) {
      bundleMap.set(bundleKey, []);
    }
    bundleMap.get(bundleKey)!.push(row);
  }

  for (const bundleMap of Array.from(byBusinessId.values())) {
    for (const rowsForBundle of Array.from(bundleMap.values())) {
      rowsForBundle.sort((left, right) => {
        const leftVariant = left.scalev_variant_name || left.scalev_variant_product_name || '';
        const rightVariant = right.scalev_variant_name || right.scalev_variant_product_name || '';
        return leftVariant.localeCompare(rightVariant);
      });
    }
  }

  return byBusinessId;
}

function buildCanonicalCatalogMappingLookupMap(rows: CanonicalCatalogMappingRow[]) {
  const lookup = new Map<string, CanonicalCatalogMappingRow>();

  for (const row of rows) {
    lookup.set(buildCanonicalMappingLookupKey(row.business_id, row.scalev_entity_key), row);
  }

  return lookup;
}

function buildVisibleDirectEntityRequests(
  identifierRows: ScalevCatalogIdentifierLookupRow[],
  bundleLineRows: ScalevCatalogBundleLineLookupRow[],
) {
  const requests = new Map<number, { variantIds: Set<number>; productIds: Set<number> }>();

  const ensureRequest = (businessId: number) => {
    if (!requests.has(businessId)) {
      requests.set(businessId, {
        variantIds: new Set<number>(),
        productIds: new Set<number>(),
      });
    }
    return requests.get(businessId)!;
  };

  for (const row of identifierRows) {
    const [entityType, rawId] = String(row.entity_key || '').split(':');
    const entityId = Number(rawId || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) continue;

    if (entityType === 'variant') {
      ensureRequest(row.business_id).variantIds.add(entityId);
    } else if (entityType === 'product') {
      ensureRequest(row.business_id).productIds.add(entityId);
    }
  }

  for (const row of bundleLineRows) {
    const request = ensureRequest(row.business_id);
    if (row.scalev_variant_id != null && Number(row.scalev_variant_id) > 0) {
      request.variantIds.add(Number(row.scalev_variant_id));
    }
    if (row.scalev_product_id != null && Number(row.scalev_product_id) > 0) {
      request.productIds.add(Number(row.scalev_product_id));
    }
  }

  for (const [businessId, request] of Array.from(requests.entries())) {
    if (request.variantIds.size === 0 && request.productIds.size === 0) {
      requests.delete(businessId);
    }
  }

  return requests;
}

async function buildCatalogResolutionContext(
  svc: ReturnType<typeof createServiceSupabase>,
  businessCodes: string[],
  linesByBusinessCode: Map<string, ScalevOrderLineForWarehouse[]>,
): Promise<CatalogResolutionContext> {
  const catalogBusinesses = await fetchScalevCatalogBusinessesByCodes(svc, businessCodes);
  const catalogBusinessIdByCode = new Map<string, number>();
  for (const business of catalogBusinesses) {
    catalogBusinessIdByCode.set(business.business_code, Number(business.id));
  }

  const identifierRows = await fetchScalevCatalogIdentifiersForBusinesses(
    svc,
    catalogBusinesses,
    linesByBusinessCode,
  );
  const bundleLineRows = await fetchScalevCatalogBundleLinesByBusinesses(svc, identifierRows);
  const visibleEntityRequests = buildVisibleDirectEntityRequests(identifierRows, bundleLineRows);
  const directEntities = visibleEntityRequests.size > 0
    ? await fetchVisibleDirectCatalogEntitiesByBusinessRequests(svc, visibleEntityRequests, {
        includeProductsWithVariants: true,
      })
    : [];

  const mappingRequestsByBusinessId = new Map<number, Set<string>>();
  for (const entity of directEntities) {
    if (!mappingRequestsByBusinessId.has(entity.owner_business_id)) {
      mappingRequestsByBusinessId.set(entity.owner_business_id, new Set<string>());
    }
    mappingRequestsByBusinessId.get(entity.owner_business_id)!.add(entity.entity_key);
  }

  const canonicalMappings = mappingRequestsByBusinessId.size > 0
    ? await fetchCanonicalCatalogMappingsByRequests(svc, mappingRequestsByBusinessId)
    : [];

  return {
    catalogBusinessIdByCode,
    identifiersByBusinessId: buildCatalogIdentifierLookupMap(identifierRows),
    bundleLinesByBusinessId: buildCatalogBundleLineLookupMap(bundleLineRows),
    directEntitiesByViewerKey: new Map(
      directEntities.map((entity) => [
        buildViewerEntityLookupKey(entity.viewer_business_id, entity.entity_key),
        entity,
      ]),
    ),
    canonicalMappingsByKey: buildCanonicalCatalogMappingLookupMap(canonicalMappings),
    processorMappingsByCode: new Map(),
  };
}

function buildCatalogEntityOwnerLookupMap(
  rows: ScalevCatalogEntityOwnerLookupRow[],
  key: 'scalev_variant_id' | 'scalev_product_id',
) {
  const map = new Map<number, ScalevCatalogEntityOwnerLookupRow[]>();

  for (const row of rows) {
    const entityId = Number(row[key] || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) continue;
    if (!map.has(entityId)) map.set(entityId, []);

    const bucket = map.get(entityId)!;
    if (bucket.some((existing) => existing.business_id === row.business_id && existing.entity_key === row.entity_key)) {
      continue;
    }

    bucket.push(row);
  }

  return map;
}

function resolveCatalogWarehouseTargetsForLine(args: {
  businessId: number | null;
  line: ScalevOrderLineForWarehouse;
  identifiersByBusinessId: Map<number, Map<string, ScalevCatalogIdentifierLookupRow[]>>;
  bundleLinesByBusinessId: Map<number, Map<string, ScalevCatalogBundleLineLookupRow[]>>;
  directEntitiesByViewerKey: Map<string, VisibleDirectCatalogEntityRow>;
  canonicalMappingsByKey: Map<string, CanonicalCatalogMappingRow>;
}): WarehouseCatalogResolvedTarget[] | null {
  if (!args.businessId) return null;

  const identifierMap = args.identifiersByBusinessId.get(args.businessId);
  const bundleLineMap = args.bundleLinesByBusinessId.get(args.businessId);
  if (!identifierMap) return null;

  const candidateMap = new Map<string, { row: ScalevCatalogIdentifierLookupRow; priority: number }>();

  const collectCandidates = (rawValue: string | null | undefined, mode: 'variant_sku' | 'product_name') => {
    const lookupKeys = getScalevIdentifierQueryCandidates(rawValue);
    if (lookupKeys.length === 0) return;

    for (const lookupKey of lookupKeys) {
      for (const identifierRow of identifierMap.get(lookupKey) || []) {
        if (mode === 'variant_sku' && identifierRow.entity_type === 'product') continue;

        const priority = getCatalogIdentifierSourcePriority(identifierRow.source, mode);
        const existing = candidateMap.get(identifierRow.entity_key);
        if (existing && existing.priority >= priority) continue;

        candidateMap.set(identifierRow.entity_key, {
          row: identifierRow,
          priority,
        });
      }
    }
  };

  const resolveDirectTarget = (identifierRow: ScalevCatalogIdentifierLookupRow) => {
    const visibleEntity = args.directEntitiesByViewerKey.get(
      buildViewerEntityLookupKey(args.businessId!, identifierRow.entity_key),
    ) || null;
    const canonicalBusinessId = visibleEntity?.owner_business_id || identifierRow.owner_business_id || 0;
    const mappingRow = args.canonicalMappingsByKey.get(
      buildCanonicalMappingLookupKey(canonicalBusinessId, identifierRow.entity_key),
    ) || null;
    if (!mappingRow?.warehouse_product_id) return null;

    return [{
      warehouse_product_id: Number(mappingRow.warehouse_product_id),
      quantity_multiplier: 1,
      scalev_label: args.line.product_name,
      note_suffix: mappingRow.business_code
        ? `catalog:${identifierRow.source}:${mappingRow.business_code}`
        : `catalog:${identifierRow.source}`,
      owner_business_code: visibleEntity?.owner_business_code || identifierRow.owner_business_code || mappingRow.business_code || null,
      entity: mappingRow.warehouse_products?.entity || null,
      warehouse: mappingRow.warehouse_products?.warehouse || null,
    }] as WarehouseCatalogResolvedTarget[];
  };

  const resolveBundleTargets = (identifierRow: ScalevCatalogIdentifierLookupRow) => {
    if (!bundleLineMap) return null;
    const bundleLines = bundleLineMap.get(identifierRow.entity_key) || [];
    if (bundleLines.length === 0) return null;

    const resolvedTargets: WarehouseCatalogResolvedTarget[] = [];
    for (const bundleLine of bundleLines) {
      const variantKey = bundleLine.scalev_variant_id ? `variant:${bundleLine.scalev_variant_id}` : null;
      const productKey = bundleLine.scalev_product_id ? `product:${bundleLine.scalev_product_id}` : null;
      const visibleEntity = (variantKey
        ? args.directEntitiesByViewerKey.get(buildViewerEntityLookupKey(args.businessId!, variantKey))
        : null) || (productKey
          ? args.directEntitiesByViewerKey.get(buildViewerEntityLookupKey(args.businessId!, productKey))
          : null) || null;
      const resolvedEntityKey = visibleEntity?.entity_key || variantKey || productKey || '';
      const mappingRow = visibleEntity
        ? args.canonicalMappingsByKey.get(
            buildCanonicalMappingLookupKey(visibleEntity.owner_business_id, resolvedEntityKey),
          ) || null
        : null;

      if (!mappingRow?.warehouse_product_id) {
        return null;
      }

      const componentLabel = bundleLine.scalev_variant_name
        || bundleLine.scalev_variant_product_name
        || args.line.product_name;

      resolvedTargets.push({
        warehouse_product_id: Number(mappingRow.warehouse_product_id),
        quantity_multiplier: Number(bundleLine.quantity || 0) || 1,
        scalev_label: `${args.line.product_name} -> ${componentLabel}`,
        note_suffix: mappingRow.business_code && mappingRow.business_id !== args.businessId
          ? `catalog:${identifierRow.source}:${mappingRow.business_code}`
          : `catalog:${identifierRow.source}`,
        owner_business_code: visibleEntity?.owner_business_code || mappingRow.business_code || null,
        entity: mappingRow.warehouse_products?.entity || null,
        warehouse: mappingRow.warehouse_products?.warehouse || null,
      });
    }

    return resolvedTargets;
  };

  collectCandidates(args.line.variant_sku, 'variant_sku');
  collectCandidates(args.line.product_name, 'product_name');

  const ranked = Array.from(candidateMap.values()).sort((left, right) => right.priority - left.priority);
  for (const candidate of ranked) {
    if (candidate.row.entity_type === 'bundle') {
      const bundleTargets = resolveBundleTargets(candidate.row);
      if (bundleTargets && bundleTargets.length > 0) {
        return bundleTargets;
      }
      continue;
    }

    const directTargets = resolveDirectTarget(candidate.row);
    if (directTargets && directTargets.length > 0) {
      return directTargets;
    }
  }

  return null;
}

function buildWarehouseIssueSummaryFromState(args: {
  orderId: string;
  businessCode?: string | null;
  productLines: ScalevOrderLineForWarehouse[];
  unmappedProducts: string[];
  mapping: { deduct_entity: string; deduct_warehouse: string } | null;
  allowedMappings?: Array<{ deduct_entity: string; deduct_warehouse: string }> | null;
}) {
  if (args.productLines.length === 0) {
    return {
      problem: 'no_order_lines',
      problem_detail: `Order ${args.orderId} tidak punya order lines`,
    };
  }

  if (args.unmappedProducts.length > 0) {
    const allowedSummary = (args.allowedMappings || []).length > 0
      ? ` Target diizinkan: ${(args.allowedMappings || []).map(formatBusinessTargetLabel).join(', ')}.`
      : '';
    return {
      problem: 'no_product_mapping',
      problem_detail: `Produk belum punya owner item mapping atau origin registry yang valid: ${args.unmappedProducts.join(', ')}.${allowedSummary}`.replace(/\.\s+Target/, '. Target'),
    };
  }

  if (!args.mapping) {
    return {
      problem: 'no_business_mapping',
      problem_detail: `Order ${args.orderId} belum punya seller/origin registry yang lengkap untuk deduction owner-aware.`,
    };
  }

  return {
    problem: 'unknown',
    problem_detail: 'Deduction warehouse belum sinkron dengan shipment Scalev',
  };
}

async function fetchScalevOrdersForDate(
  svc: ReturnType<typeof createServiceSupabase>,
  date: string,
) {
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;
  const orders: ScalevOrderWarehouseSnapshot[] = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await svc
      .from('scalev_orders')
      .select(`
        id,
        order_id,
        business_code,
        business_name_raw,
        origin_business_name_raw,
        origin_raw,
        seller_business_code,
        origin_operator_business_code,
        origin_registry_id,
        status,
        shipped_time,
        completed_time
      `)
      .in('status', ['shipped', 'completed'])
      .gte('shipped_time', dayStart)
      .lt('shipped_time', dayEnd)
      .range(offset, offset + 999);
    if (error) throw error;
    if (!page || page.length === 0) break;
    orders.push(...(page as ScalevOrderWarehouseSnapshot[]));
    if (page.length < 1000) break;
    offset += 1000;
  }

  return orders;
}

async function fetchScalevOrderLinesByOrderIds(
  svc: ReturnType<typeof createServiceSupabase>,
  orderDbIds: number[],
) {
  const rows: {
    scalev_order_id: number;
    product_name: string;
    quantity: number;
    variant_sku: string | null;
    item_name_raw: string | null;
    item_owner_raw: string | null;
    stock_owner_business_code: string | null;
  }[] = [];

  for (const chunk of chunkArray(orderDbIds, 1000)) {
    let offset = 0;
      while (true) {
        const { data, error } = await svc
          .from('scalev_order_lines')
          .select('scalev_order_id, product_name, quantity, variant_sku, item_name_raw, item_owner_raw, stock_owner_business_code')
          .in('scalev_order_id', chunk)
          .range(offset, offset + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data as any[]) {
        if (!row.product_name || Number(row.quantity) <= 0) continue;
        rows.push({
          scalev_order_id: Number(row.scalev_order_id),
          product_name: row.product_name,
          quantity: Number(row.quantity),
          variant_sku: row.variant_sku || null,
          item_name_raw: row.item_name_raw || row.product_name || null,
          item_owner_raw: row.item_owner_raw || null,
          stock_owner_business_code: row.stock_owner_business_code || null,
        });
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  return rows;
}

async function fetchBusinessMappingsByCodes(
  svc: ReturnType<typeof createServiceSupabase>,
  businessCodes: string[],
) {
  const rows: WarehouseBusinessTargetRow[] = [];

  for (const chunk of chunkArray(businessCodes, 200)) {
    const { data, error } = await svc
      .from('warehouse_business_mapping')
      .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
      .eq('is_active', true)
      .in('business_code', chunk);
    if (error) throw error;
    rows.push(...((data || []) as WarehouseBusinessTargetRow[]));
  }

  return rows.sort((left, right) => {
    const businessCompare = String(left.business_code || '').localeCompare(String(right.business_code || ''));
    if (businessCompare !== 0) return businessCompare;
    if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
    return Number(left.id || 0) - Number(right.id || 0);
  });
}

async function fetchScalevCatalogBusinessesByCodes(
  svc: ReturnType<typeof createServiceSupabase>,
  businessCodes: string[],
) {
  const rows: ScalevCatalogBusinessLookupRow[] = [];
  const uniqueCodes = Array.from(new Set(businessCodes.filter(Boolean)));
  if (uniqueCodes.length === 0) return rows;

  for (const chunk of chunkArray(uniqueCodes, 200)) {
    const { data, error } = await svc
      .from('scalev_webhook_businesses')
      .select('id, business_code')
      .in('business_code', chunk);
    if (error) {
      if (isMissingWarehouseTableError(error)) return [];
      throw error;
    }
    rows.push(...((data || []) as ScalevCatalogBusinessLookupRow[]));
  }

  return rows;
}

async function fetchScalevMappingsByProductNames(
  svc: ReturnType<typeof createServiceSupabase>,
  productNames: string[],
) {
  const rows: WarehouseScalevMappingRow[] = [];

  for (const chunk of chunkArray(productNames, 500)) {
    const { data, error } = await svc
      .from('warehouse_scalev_mapping')
      .select(`
        scalev_product_name,
        warehouse_product_id,
        deduct_qty_multiplier,
        is_ignored,
        warehouse_products(id, name, entity, warehouse, scalev_product_names)
      `)
      .in('scalev_product_name', chunk);
    if (error) throw error;
    rows.push(...((data || []).map((row: any) => {
      const rawWarehouseProduct = Array.isArray(row.warehouse_products)
        ? row.warehouse_products[0] || null
        : row.warehouse_products || null;

      return {
        scalev_product_name: row.scalev_product_name,
        warehouse_product_id: row.warehouse_product_id != null ? Number(row.warehouse_product_id) : null,
        deduct_qty_multiplier: row.deduct_qty_multiplier != null ? Number(row.deduct_qty_multiplier) : null,
        is_ignored: row.is_ignored ?? null,
        warehouse_products: rawWarehouseProduct
          ? {
              id: Number(rawWarehouseProduct.id),
              name: rawWarehouseProduct.name || null,
              entity: rawWarehouseProduct.entity || null,
              warehouse: rawWarehouseProduct.warehouse || null,
              scalev_product_names: Array.isArray(rawWarehouseProduct.scalev_product_names)
                ? rawWarehouseProduct.scalev_product_names
                : [],
            }
          : null,
      } as WarehouseScalevMappingRow;
    })));
  }

  return rows;
}

async function fetchScalevCatalogIdentifiersForBusinesses(
  svc: ReturnType<typeof createServiceSupabase>,
  businessRows: ScalevCatalogBusinessLookupRow[],
  linesByBusinessCode: Map<string, ScalevOrderLineForWarehouse[]>,
) {
  const rows: ScalevCatalogIdentifierLookupRow[] = [];

  for (const business of businessRows) {
    const identifiers = new Set<string>();
    for (const line of linesByBusinessCode.get(business.business_code) || []) {
      for (const candidate of getScalevIdentifierQueryCandidates(line.product_name)) {
        identifiers.add(candidate);
      }
      for (const candidate of getScalevIdentifierQueryCandidates(line.variant_sku)) {
        identifiers.add(candidate);
      }
    }

    const identifierList = Array.from(identifiers);
    if (identifierList.length === 0) continue;

    for (const chunk of chunkArray(identifierList, 500)) {
      const { data, error } = await svc
        .from('scalev_catalog_identifiers')
        .select(`
          business_id,
          identifier,
          identifier_normalized,
          entity_key,
          entity_type,
          source,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', business.id)
        .in('identifier_normalized', chunk);
      if (error) {
        if (isMissingWarehouseTableError(error)) return [];
        throw error;
      }
      rows.push(...((data || []).map((row: any) => ({
        business_id: Number(row.business_id),
        identifier: String(row.identifier || ''),
        identifier_normalized: String(row.identifier_normalized || ''),
        entity_key: String(row.entity_key || ''),
        entity_type: row.entity_type,
        source: String(row.source || ''),
        visibility_kind: row.visibility_kind === 'shared' ? 'shared' : 'owned',
        owner_business_id: Number(row.owner_business_id || row.business_id || 0),
        owner_business_code: String(row.owner_business_code || business.business_code || ''),
        processor_business_id: Number(row.processor_business_id || row.owner_business_id || row.business_id || 0),
        processor_business_code: String(row.processor_business_code || row.owner_business_code || business.business_code || ''),
      })) as ScalevCatalogIdentifierLookupRow[]));
    }
  }

  return rows;
}

async function fetchScalevCatalogBundleLinesByBusinesses(
  svc: ReturnType<typeof createServiceSupabase>,
  identifierRows: ScalevCatalogIdentifierLookupRow[],
) {
  const rows: ScalevCatalogBundleLineLookupRow[] = [];
  const bundleIdsByBusinessId = new Map<number, Set<number>>();

  for (const row of identifierRows) {
    if (row.entity_type !== 'bundle') continue;
    const rawBundleId = Number(String(row.entity_key || '').split(':')[1] || 0);
    if (!Number.isFinite(rawBundleId) || rawBundleId <= 0) continue;
    if (!bundleIdsByBusinessId.has(row.business_id)) {
      bundleIdsByBusinessId.set(row.business_id, new Set<number>());
    }
    bundleIdsByBusinessId.get(row.business_id)!.add(rawBundleId);
  }

  for (const [businessId, bundleIds] of Array.from(bundleIdsByBusinessId.entries())) {
    const bundleIdList = Array.from(bundleIds);
    for (const chunk of chunkArray(bundleIdList, 500)) {
      const { data, error } = await svc
        .from('scalev_catalog_bundle_lines')
        .select(`
          business_id,
          scalev_bundle_id,
          scalev_bundle_line_key,
          quantity,
          scalev_product_id,
          scalev_variant_id,
          scalev_variant_unique_id,
          scalev_variant_uuid,
          scalev_variant_sku,
          scalev_variant_name,
          scalev_variant_product_name
        `)
        .eq('business_id', businessId)
        .in('scalev_bundle_id', chunk);
      if (error) {
        if (isMissingWarehouseTableError(error)) return [];
        throw error;
      }
      rows.push(...((data || []) as ScalevCatalogBundleLineLookupRow[]));
    }
  }

  return rows;
}

async function fetchScalevCatalogEntityOwnersByBundleLines(
  svc: ReturnType<typeof createServiceSupabase>,
  bundleLineRows: ScalevCatalogBundleLineLookupRow[],
): Promise<ScalevCatalogEntityOwnerLookups> {
  const variantRows: ScalevCatalogEntityOwnerLookupRow[] = [];
  const productRows: ScalevCatalogEntityOwnerLookupRow[] = [];

  const variantIds = Array.from(new Set(
    bundleLineRows
      .map((row) => Number(row.scalev_variant_id || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  ));
  const productIds = Array.from(new Set(
    bundleLineRows
      .map((row) => Number(row.scalev_product_id || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  ));

  for (const chunk of chunkArray(variantIds, 500)) {
    if (chunk.length === 0) continue;
    const { data, error } = await svc
      .from('scalev_catalog_variants')
      .select('business_id, business_code, scalev_product_id, scalev_variant_id')
      .in('scalev_variant_id', chunk);
    if (error) {
      if (isMissingWarehouseTableError(error)) {
        return {
          variantOwnersById: new Map(),
          productOwnersById: new Map(),
        };
      }
      throw error;
    }

    for (const row of (data || []) as any[]) {
      variantRows.push({
        business_id: Number(row.business_id),
        business_code: row.business_code,
        scalev_product_id: Number(row.scalev_product_id),
        scalev_variant_id: Number(row.scalev_variant_id),
        entity_key: `variant:${row.scalev_variant_id}`,
      });
    }
  }

  for (const chunk of chunkArray(productIds, 500)) {
    if (chunk.length === 0) continue;
    const { data, error } = await svc
      .from('scalev_catalog_products')
      .select('business_id, business_code, scalev_product_id')
      .in('scalev_product_id', chunk);
    if (error) {
      if (isMissingWarehouseTableError(error)) {
        return {
          variantOwnersById: new Map(),
          productOwnersById: new Map(),
        };
      }
      throw error;
    }

    for (const row of (data || []) as any[]) {
      productRows.push({
        business_id: Number(row.business_id),
        business_code: row.business_code,
        scalev_product_id: Number(row.scalev_product_id),
        scalev_variant_id: null,
        entity_key: `product:${row.scalev_product_id}`,
      });
    }
  }

  return {
    variantOwnersById: buildCatalogEntityOwnerLookupMap(variantRows, 'scalev_variant_id'),
    productOwnersById: buildCatalogEntityOwnerLookupMap(productRows, 'scalev_product_id'),
  };
}

async function fetchScalevCatalogMappingsByBusinesses(
  svc: ReturnType<typeof createServiceSupabase>,
  identifierRows: ScalevCatalogIdentifierLookupRow[],
  bundleLineRows: ScalevCatalogBundleLineLookupRow[] = [],
  entityOwners?: ScalevCatalogEntityOwnerLookups | null,
) {
  const rows: WarehouseScalevCatalogMappingRow[] = [];
  const entityKeysByBusinessId = new Map<number, Set<string>>();

  for (const row of identifierRows) {
    if (row.entity_type === 'bundle') continue;
    if (!entityKeysByBusinessId.has(row.business_id)) {
      entityKeysByBusinessId.set(row.business_id, new Set<string>());
    }
    entityKeysByBusinessId.get(row.business_id)!.add(row.entity_key);
  }

  for (const row of bundleLineRows) {
    if (!entityKeysByBusinessId.has(row.business_id)) {
      entityKeysByBusinessId.set(row.business_id, new Set<string>());
    }
    if (row.scalev_variant_id) {
      entityKeysByBusinessId.get(row.business_id)!.add(`variant:${row.scalev_variant_id}`);
      for (const ownerRow of entityOwners?.variantOwnersById.get(Number(row.scalev_variant_id)) || []) {
        if (!entityKeysByBusinessId.has(ownerRow.business_id)) {
          entityKeysByBusinessId.set(ownerRow.business_id, new Set<string>());
        }
        entityKeysByBusinessId.get(ownerRow.business_id)!.add(ownerRow.entity_key);
      }
    }
    if (row.scalev_product_id) {
      entityKeysByBusinessId.get(row.business_id)!.add(`product:${row.scalev_product_id}`);
      for (const ownerRow of entityOwners?.productOwnersById.get(Number(row.scalev_product_id)) || []) {
        if (!entityKeysByBusinessId.has(ownerRow.business_id)) {
          entityKeysByBusinessId.set(ownerRow.business_id, new Set<string>());
        }
        entityKeysByBusinessId.get(ownerRow.business_id)!.add(ownerRow.entity_key);
      }
    }
  }

  for (const [businessId, entityKeys] of Array.from(entityKeysByBusinessId.entries())) {
    const entityKeyList = Array.from(entityKeys);
    for (const chunk of chunkArray(entityKeyList, 500)) {
      const { data, error } = await svc
        .from('warehouse_scalev_catalog_mapping')
        .select(`
          business_id,
          business_code,
          scalev_entity_key,
          scalev_entity_type,
          warehouse_product_id,
          warehouse_products(id, name, entity, warehouse, scalev_product_names)
        `)
        .eq('business_id', businessId)
        .in('scalev_entity_key', chunk)
        .not('warehouse_product_id', 'is', null);
      if (error) {
        if (isMissingWarehouseTableError(error)) return [];
        throw error;
      }
      rows.push(...((data || []).map((row: any) => {
        const rawWarehouseProduct = Array.isArray(row.warehouse_products)
          ? row.warehouse_products[0] || null
          : row.warehouse_products || null;

        return {
          business_id: Number(row.business_id),
          business_code: row.business_code || null,
          scalev_entity_key: row.scalev_entity_key,
          scalev_entity_type: row.scalev_entity_type || null,
          warehouse_product_id: row.warehouse_product_id != null ? Number(row.warehouse_product_id) : null,
          warehouse_products: rawWarehouseProduct
            ? {
                id: Number(rawWarehouseProduct.id),
                name: rawWarehouseProduct.name || null,
                entity: rawWarehouseProduct.entity || null,
                warehouse: rawWarehouseProduct.warehouse || null,
                scalev_product_names: Array.isArray(rawWarehouseProduct.scalev_product_names)
                  ? rawWarehouseProduct.scalev_product_names
                  : [],
              }
            : null,
        } as WarehouseScalevCatalogMappingRow;
      })));
    }
  }

  return rows;
}

async function fetchFallbackWarehouseProducts(
  svc: ReturnType<typeof createServiceSupabase>,
  mappings: WarehouseBusinessTargetRow[],
) {
  const entities = Array.from(new Set(mappings.map(row => row.deduct_entity).filter(Boolean)));
  const warehouses = Array.from(new Set(mappings.map(row => row.deduct_warehouse || 'BTN')));
  if (entities.length === 0 || warehouses.length === 0) return [] as WarehouseFallbackProductRow[];

  const { data, error } = await svc
    .from('warehouse_products')
    .select('id, entity, warehouse, scalev_product_names')
    .eq('is_active', true)
    .in('entity', entities)
    .in('warehouse', warehouses);
  if (error) throw error;

  return ((data || []) as any[]).map((row) => ({
    id: Number(row.id),
    entity: row.entity,
    warehouse: row.warehouse,
    scalev_product_names: Array.isArray(row.scalev_product_names) ? row.scalev_product_names : [],
  })) as WarehouseFallbackProductRow[];
}

async function fetchOutstandingLedgerByOrderProduct(
  svc: ReturnType<typeof createServiceSupabase>,
  orders: ScalevOrderWarehouseSnapshot[],
) {
  if (orders.length === 0) return new Map<string, Map<number, number>>();
  const loadRows = async (useScalevOrderId: boolean) => {
    const byOrder = new Map<string, Map<number, number>>();
    const orderIdByDbId = new Map<number, string>();
    const orderIdSet = new Set<string>();

    for (const order of orders) {
      orderIdByDbId.set(order.id, order.order_id);
      orderIdSet.add(order.order_id);
    }

    for (const chunk of chunkArray(orders, 500)) {
      const scalevOrderIds = chunk.map(order => order.id);
      const rawOrderChunk = chunk.map(order => order.order_id);

      const selectFields = useScalevOrderId
        ? 'scalev_order_id, reference_id, warehouse_product_id, quantity'
        : 'reference_id, warehouse_product_id, quantity';

      let offset = 0;
      while (true) {
        let query = svc
          .from('warehouse_stock_ledger')
          .select(selectFields)
          .eq('reference_type', 'scalev_order');

        query = useScalevOrderId
          ? query.in('scalev_order_id', scalevOrderIds)
          : query.in('reference_id', rawOrderChunk);

        const { data, error } = await query.range(offset, offset + 999);
        if (error) {
          if (useScalevOrderId && isMissingScalevOrderIdColumnError(error)) {
            return null;
          }
          throw error;
        }
        if (!data || data.length === 0) break;

        for (const row of data as any[]) {
          const resolvedOrderId = useScalevOrderId
            ? orderIdByDbId.get(Number(row.scalev_order_id)) || row.reference_id
            : row.reference_id;
          if (!resolvedOrderId || !orderIdSet.has(resolvedOrderId)) continue;
          const productId = Number(row.warehouse_product_id);
          if (!byOrder.has(resolvedOrderId)) byOrder.set(resolvedOrderId, new Map<number, number>());
          const productMap = byOrder.get(resolvedOrderId)!;
          productMap.set(productId, (productMap.get(productId) || 0) + Number(row.quantity || 0));
        }

        if (data.length < 1000) break;
        offset += 1000;
      }
    }

    return byOrder;
  };

  const netByOrder = await loadRows(true) ?? await loadRows(false) ?? new Map<string, Map<number, number>>();
  const outstandingByOrder = new Map<string, Map<number, number>>();
  for (const [orderId, productMap] of Array.from(netByOrder.entries())) {
    const outstanding = new Map<number, number>();
    for (const [productId, netQty] of Array.from(productMap.entries())) {
      if (netQty < -QUANTITY_EPSILON) {
        outstanding.set(productId, Math.abs(netQty));
      }
    }
    outstandingByOrder.set(orderId, outstanding);
  }
  return outstandingByOrder;
}

async function fetchDailyMovementRows(
  svc: ReturnType<typeof createServiceSupabase>,
  date: string,
  options?: {
    fromInclusive?: string | null;
    toExclusive?: string | null;
  },
) {
  const dayStart = options?.fromInclusive || `${date}T00:00:00+07:00`;
  const dayEnd = options?.toExclusive || `${date}T23:59:59.999+07:00`;
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await svc
      .from('warehouse_stock_ledger')
      .select(`
        warehouse_product_id,
        movement_type,
        quantity,
        warehouse_products!inner(name, category, entity)
      `)
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd)
      .range(offset, offset + 999);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  return rows;
}

function normalizeWarehouseOrderLines(input: any): ScalevOrderLineForWarehouse[] {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((line) => ({
      product_name: String(line?.product_name || ''),
      quantity: Number(line?.quantity || 0),
    }))
    .filter((line) => line.product_name && Number.isFinite(line.quantity) && line.quantity > 0);
}

async function getCurrentBalance(svc: ReturnType<typeof createServiceSupabase>, productId: number): Promise<number> {
  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select('quantity')
    .eq('warehouse_product_id', productId);
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + Number(r.quantity), 0);
}

async function insertLedgerEntry(svc: ReturnType<typeof createServiceSupabase>, entry: LedgerEntry) {
  const runningBalance = await getCurrentBalance(svc, entry.warehouse_product_id) + entry.quantity;

  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .insert({
      ...entry,
      running_balance: runningBalance,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getBatchOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  batchId: number,
  productId?: number
) {
  const { data: batch, error } = await svc
    .from('warehouse_batches')
    .select('id, warehouse_product_id, batch_code, expired_date, cost_per_unit, current_qty')
    .eq('id', batchId)
    .single();
  if (error || !batch) throw new Error('Batch tidak ditemukan');
  if (productId && Number(batch.warehouse_product_id) !== Number(productId)) {
    throw new Error('Batch tidak cocok dengan produk yang dipilih');
  }
  return batch;
}

async function deductBatchQuantityOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  batchId: number,
  productId: number,
  quantity: number
) {
  const batch = await getBatchOrThrow(svc, batchId, productId);
  const currentQty = Number(batch.current_qty || 0);
  if (quantity > currentQty) {
    throw new Error(`Qty melebihi stok batch ${batch.batch_code} (${currentQty})`);
  }

  const { error } = await svc
    .from('warehouse_batches')
    .update({ current_qty: currentQty - quantity })
    .eq('id', batchId);
  if (error) throw error;

  return batch;
}

async function incrementBatchQuantityOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  batchId: number,
  productId: number,
  quantity: number,
) {
  const batch = await getBatchOrThrow(svc, batchId, productId);
  const nextQty = Number(batch.current_qty || 0) + Number(quantity || 0);
  if (nextQty < 0) {
    throw new Error(`Update menyebabkan stok batch ${batch.batch_code} menjadi negatif`);
  }

  const update: Record<string, any> = { current_qty: nextQty };
  if (nextQty > 0) update.is_active = true;

  const { error } = await svc
    .from('warehouse_batches')
    .update(update)
    .eq('id', batchId);
  if (error) throw error;

  return batch;
}

async function findOrCreateTargetBatch(
  svc: ReturnType<typeof createServiceSupabase>,
  productId: number,
  batchCode: string,
  expiredDate: string | null | undefined,
  costPerUnit?: number | null
) {
  const { data: existing, error: existingErr } = await svc
    .from('warehouse_batches')
    .select('id, current_qty, cost_per_unit, initial_qty')
    .eq('warehouse_product_id', productId)
    .eq('batch_code', batchCode)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const update: Record<string, any> = {};
    if (expiredDate !== undefined) update.expired_date = expiredDate;
    if (costPerUnit != null && Number(existing.cost_per_unit || 0) <= 0) {
      update.cost_per_unit = costPerUnit;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await svc.from('warehouse_batches').update(update).eq('id', existing.id);
      if (error) throw error;
    }
    return { ...existing, created: false };
  }

  const insertRow: Record<string, any> = {
    warehouse_product_id: productId,
    batch_code: batchCode,
    expired_date: expiredDate,
    initial_qty: 0,
    current_qty: 0,
  };
  if (costPerUnit != null) {
    insertRow.cost_per_unit = costPerUnit;
  }

  const { data: created, error: createdErr } = await svc
    .from('warehouse_batches')
    .insert(insertRow)
    .select('id, current_qty, initial_qty')
    .single();
  if (createdErr) throw createdErr;

  return { ...created, created: true };
}

// ============================================================
// STOCK IN — vendor delivery, RTS, production received
// ============================================================

export async function recordStockInInternal(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  if (quantity <= 0) throw new Error('Stock IN quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // Update batch qty if batch specified
  if (batchId) {
    await incrementBatchQuantityOrThrow(svc, batchId, productId, quantity);
  }

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: referenceType,
    reference_id: referenceId,
    notes,
    created_by: userId,
  });

  // Notify direktur (fire-and-forget)
  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Masuk', prod.name, quantity, `${prod.warehouse} - ${prod.entity}`, userName));
  }

  return result;
}

export async function recordStockIn(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Stock Masuk');
  return recordStockInInternal(productId, batchId, quantity, referenceType, referenceId, notes);
}

// ============================================================
// STOCK OUT — manual outbound (non-ScaleV)
// ============================================================

export async function recordStockOut(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_keluar', 'Stock Keluar');
  if (quantity <= 0) throw new Error('Stock OUT quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // If no batch specified, use FIFO deduction
  if (!batchId) {
    const { data, error } = await svc
      .rpc('warehouse_deduct_fifo', {
        p_product_id: productId,
        p_quantity: quantity,
        p_reference_type: referenceType || 'manual',
        p_reference_id: referenceId || null,
        p_notes: notes || 'Manual stock out (FIFO)',
      });
    if (error) throw error;

    const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
    if (prod) {
      const userName = await getCurrentUserName();
      notifyDirekturs(formatNotification('Stock Keluar', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName));
    }
    return data;
  }

  // Specific batch deduction
  await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'OUT',
    quantity: -quantity,
    reference_type: referenceType,
    reference_id: referenceId,
    notes,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Keluar', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName));
  }

  return result;
}

// ============================================================
// STOCK IN RTS — returned items back to inventory
// ============================================================

export async function recordStockRTS(
  productId: number,
  batchId: number,
  quantity: number,
  resiNumber: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Stock RTS');
  if (quantity <= 0) throw new Error('RTS quantity must be positive');
  if (!resiNumber?.trim()) throw new Error('Nomor resi wajib diisi untuk RTS');
  if (!batchId) throw new Error('Batch wajib dipilih untuk RTS');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  await incrementBatchQuantityOrThrow(svc, batchId, productId, quantity);

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: 'rts',
    reference_id: resiNumber.trim(),
    notes: notes ? `RTS: ${notes}` : `RTS resi: ${resiNumber.trim()}`,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Masuk (RTS)', prod.name, quantity, `${prod.warehouse} - ${prod.entity}`, userName, `Resi: ${resiNumber.trim()}`));
  }

  return result;
}

// ============================================================
// STOCK ADJUST — stock opname correction
// ============================================================

async function recordStockAdjustInternal(
  productId: number,
  batchId: number | null,
  adjustmentQty: number, // positive = surplus, negative = deficit
  notes?: string,
) {
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    const batch = await getBatchOrThrow(svc, batchId, productId);
    const nextQty = Number(batch.current_qty || 0) + adjustmentQty;
    if (nextQty < 0) {
      throw new Error(`Adjust menyebabkan stok batch ${batch.batch_code} menjadi negatif`);
    }

    const { error } = await svc
      .from('warehouse_batches')
      .update({ current_qty: nextQty })
      .eq('id', batchId);
    if (error) throw error;
  }

  return insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'ADJUST',
    quantity: adjustmentQty,
    created_by: userId,
    reference_type: 'opname',
    notes,
  });
}

async function recordStockOpnameAdjustInternal(
  svc: ReturnType<typeof createServiceSupabase>,
  item: {
    warehouse_product_id?: number | null;
    selisih?: number | null;
    opname_label?: string | null;
    product_name?: string | null;
    sebelum_so?: number | null;
    sesudah_so?: number | null;
  },
  sessionId: number,
) {
  const productId = Number(item.warehouse_product_id || 0);
  const adjustmentQty = Number(item.selisih || 0);
  if (!productId || adjustmentQty === 0) return;

  const baseNote = `[SO#${sessionId}] Stock Opname: ${item.opname_label} — ${item.product_name} (${item.sebelum_so} → ${item.sesudah_so})`;
  const { data: batchRows, error: batchErr } = await svc
    .from('warehouse_batches')
    .select('id, batch_code, current_qty, created_at')
    .eq('warehouse_product_id', productId)
    .eq('is_active', true)
    .order('expired_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (batchErr) throw batchErr;

  const activeBatches = batchRows || [];
  const positiveBatches = activeBatches.filter((batch: any) => Number(batch.current_qty || 0) > 0);

  if (adjustmentQty < 0 && positiveBatches.length > 0) {
    let remaining = Math.abs(adjustmentQty);
    const availableQty = positiveBatches.reduce((sum: number, batch: any) => sum + Number(batch.current_qty || 0), 0);
    if (availableQty < remaining) {
      throw new Error(
        `Stok batch ${item.product_name} tidak cukup untuk sync hasil SO. Batch tersedia ${availableQty}, sedangkan koreksi SO ${remaining}.`
      );
    }

    for (const batch of positiveBatches) {
      if (remaining <= 0) break;
      const batchQty = Number(batch.current_qty || 0);
      if (batchQty <= 0) continue;

      const deductedQty = Math.min(batchQty, remaining);
      await recordStockAdjustInternal(
        productId,
        Number(batch.id),
        -deductedQty,
        `${baseNote} • Batch ${batch.batch_code}`,
      );
      remaining -= deductedQty;
    }
    return;
  }

  if (adjustmentQty > 0 && activeBatches.length > 0) {
    const adjustmentBatchCode = `SO-ADJ-${sessionId}`;
    const adjustmentBatch = await findOrCreateTargetBatch(svc, productId, adjustmentBatchCode, null);
    await recordStockAdjustInternal(
      productId,
      Number(adjustmentBatch.id),
      adjustmentQty,
      `${baseNote} • Batch ${adjustmentBatchCode}`,
    );
    return;
  }

  await recordStockAdjustInternal(productId, null, adjustmentQty, baseNote);
}

export async function recordStockAdjust(
  productId: number,
  batchId: number | null,
  adjustmentQty: number,
  notes?: string,
) {
  await requireWarehouseAccess('Adjust Stock');
  return recordStockAdjustInternal(productId, batchId, adjustmentQty, notes);
}

// ============================================================
// TRANSFER — inter-company/warehouse
// ============================================================

export async function recordTransfer(
  productId: number,
  batchId: number | null,
  quantity: number,
  fromEntity: string,
  toEntity: string,
  fromWarehouse: string = 'BTN',
  toWarehouse: string = 'BTN',
  notes?: string,
) {
  await requireWarehousePermission('wh:transfer', 'Transfer Stock');
  if (quantity <= 0) throw new Error('Transfer quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  const { data: sourceProduct, error: sourceErr } = await svc
    .from('warehouse_products')
    .select('id, name, warehouse, entity')
    .eq('id', productId)
    .single();
  if (sourceErr || !sourceProduct) throw new Error('Produk sumber tidak ditemukan');

  const { data: targetProduct, error: targetErr } = await svc
    .from('warehouse_products')
    .select('id, name')
    .eq('name', sourceProduct.name)
    .eq('entity', toEntity)
    .eq('warehouse', toWarehouse)
    .maybeSingle();
  if (targetErr) throw targetErr;
  if (!targetProduct) {
    throw new Error(`Produk ${sourceProduct.name} belum tersedia di ${toWarehouse} - ${toEntity}`);
  }

  // Create transfer record
  const { data: transfer, error: tErr } = await svc
    .from('warehouse_transfers')
    .insert({
      from_entity: fromEntity,
      to_entity: toEntity,
      from_warehouse: fromWarehouse,
      to_warehouse: toWarehouse,
      warehouse_product_id: productId,
      batch_id: batchId,
      quantity,
      notes,
    })
    .select()
    .single();
  if (tErr) throw tErr;

  let targetBatchId: number | null = null;
  let sourceBatchLabel = '';

  // Update batch qty (deduct from source) and mirror batch to target when available
  if (batchId) {
    const sourceBatch = await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);
    sourceBatchLabel = sourceBatch.batch_code || '';

    const targetBatch = await findOrCreateTargetBatch(
      svc,
      targetProduct.id,
      sourceBatch.batch_code,
      sourceBatch.expired_date || null,
      sourceBatch.cost_per_unit ?? null,
    );
    targetBatchId = targetBatch.id;

    const { error: targetBatchErr } = await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(targetBatch.current_qty || 0) + quantity })
      .eq('id', targetBatch.id);
    if (targetBatchErr) throw targetBatchErr;
  }

  // Ledger: OUT from source
  await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'TRANSFER_OUT',
    quantity: -quantity,
    reference_type: 'transfer',
    reference_id: String(transfer.id),
    notes: `Transfer to ${toEntity} (${toWarehouse})`,
    created_by: userId,
  });

  // Ledger: IN to target
  await insertLedgerEntry(svc, {
    warehouse_product_id: targetProduct.id,
    batch_id: targetBatchId,
    movement_type: 'TRANSFER_IN',
    quantity,
    reference_type: 'transfer',
    reference_id: String(transfer.id),
    notes: `Transfer from ${fromEntity} (${fromWarehouse})${sourceBatchLabel ? ` — batch ${sourceBatchLabel}` : ''}`,
    created_by: userId,
  });

  if (sourceProduct) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Transfer', sourceProduct.name, quantity, `${fromEntity} → ${toEntity}`, userName, `Dari: ${fromWarehouse} - ${fromEntity}\nKe: ${toWarehouse} - ${toEntity}`));
  }

  return transfer;
}

// ============================================================
// CONVERT — sachet → FG (or any product → product conversion)
// ============================================================

export interface ConversionSource {
  productId: number;
  batchId?: number | null;
  quantity: number;
}

export async function recordConversion(
  sources: ConversionSource[],
  targetProductId: number,
  targetQty: number,
  targetBatchCode?: string,
  targetExpiredDate?: string | null,
  notes?: string,
) {
  await requireWarehousePermission('wh:konversi', 'Konversi Produk');
  if (sources.length === 0) throw new Error('At least one source required');
  if (targetQty <= 0) throw new Error('Target quantity must be positive');
  for (const s of sources) {
    if (!s.batchId) throw new Error('Batch sumber wajib dipilih untuk setiap bahan konversi.');
    if (s.quantity <= 0) throw new Error('Source quantities must be positive');
  }

  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();
  const refId = `conv-${Date.now()}`;

  // Deduct each source
  for (const src of sources) {
    const batchId = src.batchId;
    if (batchId == null) throw new Error('Batch sumber wajib dipilih untuk setiap bahan konversi.');
    await deductBatchQuantityOrThrow(svc, batchId, src.productId, src.quantity);

    await insertLedgerEntry(svc, {
      warehouse_product_id: src.productId,
      batch_id: batchId,
      movement_type: 'OUT',
      quantity: -src.quantity,
      reference_type: 'manual',
      reference_id: refId,
      notes: `Konversi keluar: ${src.quantity} unit`,
      created_by: userId,
    });
  }

  // Create or find target batch
  let targetBatchId: number | null = null;
  if (targetBatchCode) {
    const targetBatch = await findOrCreateTargetBatch(
      svc,
      targetProductId,
      targetBatchCode,
      targetExpiredDate || null,
    );
    targetBatchId = targetBatch.id;

    const { error: targetBatchErr } = await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(targetBatch.current_qty || 0) + targetQty })
      .eq('id', targetBatch.id);
    if (targetBatchErr) throw targetBatchErr;
  }

  // Ledger IN for target
  await insertLedgerEntry(svc, {
    warehouse_product_id: targetProductId,
    batch_id: targetBatchId,
    movement_type: 'IN',
    quantity: targetQty,
    reference_type: 'manual',
    reference_id: refId,
    notes: notes || `Konversi masuk: ${targetQty} unit dari produk lain`,
    created_by: userId,
  });

  return { reference_id: refId };
}

// ============================================================
// STOCK RECLASSIFICATION — FG <-> BONUS with approval
// ============================================================

async function loadWarehouseProductsByIds(
  svc: ReturnType<typeof createServiceSupabase>,
  productIds: number[],
) {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<number, any>();

  const { data, error } = await svc
    .from('warehouse_products')
    .select('id, name, sku, category, unit, price_list, reorder_threshold, entity, warehouse, scalev_product_names, is_active, hpp, vendor, vendor_id, brand_id')
    .in('id', uniqueIds);
  if (error) throw error;

  return new Map((data || []).map((row: any) => [Number(row.id), row]));
}

async function resolveOrCreateStockReclassTargetProduct(
  svc: ReturnType<typeof createServiceSupabase>,
  sourceProduct: any,
  targetCategory: string,
) {
  if (!ALLOWED_STOCK_RECLASS_CATEGORIES.has(targetCategory)) {
    throw new Error('Kategori tujuan reklasifikasi tidak didukung.');
  }
  if (targetCategory === sourceProduct.category) {
    throw new Error('Kategori tujuan harus berbeda dari kategori sumber.');
  }

  const { data: existing, error: existingErr } = await svc
    .from('warehouse_products')
    .select('id, name, sku, category, unit, price_list, reorder_threshold, entity, warehouse, scalev_product_names, is_active, hpp, vendor, vendor_id, brand_id')
    .eq('name', sourceProduct.name)
    .eq('entity', sourceProduct.entity)
    .eq('warehouse', sourceProduct.warehouse)
    .eq('category', targetCategory)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) {
    return { product: existing, autoCreated: false };
  }

  const insertRow: Record<string, any> = {
    name: sourceProduct.name,
    sku: sourceProduct.sku || null,
    category: targetCategory,
    unit: sourceProduct.unit || 'pcs',
    price_list: Number(sourceProduct.price_list || 0),
    reorder_threshold: Number(sourceProduct.reorder_threshold || 0),
    entity: sourceProduct.entity,
    warehouse: sourceProduct.warehouse,
    scalev_product_names: [],
    is_active: true,
    hpp: Number(sourceProduct.hpp || 0),
    vendor: sourceProduct.vendor || null,
    vendor_id: sourceProduct.vendor_id || null,
    brand_id: sourceProduct.brand_id || null,
  };

  const { data: created, error: createErr } = await svc
    .from('warehouse_products')
    .insert(insertRow)
    .select('id, name, sku, category, unit, price_list, reorder_threshold, entity, warehouse, scalev_product_names, is_active, hpp, vendor, vendor_id, brand_id')
    .single();
  if (createErr) {
    if (!isUniqueViolation(createErr)) throw createErr;

    const { data: existingAfterRace, error: existingAfterRaceErr } = await svc
      .from('warehouse_products')
      .select('id, name, sku, category, unit, price_list, reorder_threshold, entity, warehouse, scalev_product_names, is_active, hpp, vendor, vendor_id, brand_id')
      .eq('name', sourceProduct.name)
      .eq('entity', sourceProduct.entity)
      .eq('warehouse', sourceProduct.warehouse)
      .eq('category', targetCategory)
      .maybeSingle();
    if (existingAfterRaceErr) throw existingAfterRaceErr;
    if (!existingAfterRace) throw createErr;
    return { product: existingAfterRace, autoCreated: false };
  }

  return { product: created, autoCreated: true };
}

function validateStockReclassProducts(source: any, target: any) {
  if (!source) throw new Error('Produk sumber tidak ditemukan.');
  if (!target) throw new Error('Produk target tidak ditemukan.');
  if (!source.is_active) throw new Error('Produk sumber sudah nonaktif.');
  if (!target.is_active) throw new Error('Produk target sudah nonaktif.');
  if (Number(source.id) === Number(target.id)) {
    throw new Error('Produk sumber dan target harus berbeda.');
  }
  if (!ALLOWED_STOCK_RECLASS_CATEGORIES.has(source.category) || !ALLOWED_STOCK_RECLASS_CATEGORIES.has(target.category)) {
    throw new Error('Reklasifikasi v1 hanya mendukung kategori FG dan BONUS.');
  }
  if (source.category === target.category) {
    throw new Error('Reklasifikasi harus mengubah kategori FG <-> BONUS.');
  }
  if (source.entity !== target.entity || source.warehouse !== target.warehouse) {
    throw new Error('Produk sumber dan target harus berada di gudang/entity yang sama.');
  }
}

function isUniqueViolation(error: any) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key');
}

async function resolveTelegramWarehouseActorOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  telegramChatId: string,
  permissionKey: string,
): Promise<TelegramWarehouseActor> {
  const { data: profiles, error: profileErr } = await svc
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('telegram_chat_id', telegramChatId)
    .neq('role', 'pending')
    .limit(2);
  if (profileErr) throw profileErr;

  if (!profiles || profiles.length === 0) {
    throw new Error('Chat Telegram ini belum terhubung ke akun dashboard yang berhak approve.');
  }
  if (profiles.length > 1) {
    throw new Error('Telegram chat ini terhubung ke lebih dari satu akun. Hubungi admin untuk merapikan mapping.');
  }

  const profile = profiles[0];
  if (profile.role !== 'owner') {
    const { data: permissions, error: permissionErr } = await svc
      .from('role_permissions')
      .select('permission_key')
      .eq('role', profile.role)
      .eq('permission_key', permissionKey)
      .limit(1);
    if (permissionErr) throw permissionErr;
    if (!permissions || permissions.length === 0) {
      throw new Error('Akun Telegram ini tidak memiliki izin approve reklasifikasi.');
    }
  }

  return {
    id: profile.id,
    role: profile.role,
    displayName: profile.full_name || profile.email || 'Unknown',
  };
}

async function loadStockReclassRequestWithProductsOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  requestId: number,
) {
  const { data: request, error: requestErr } = await svc
    .from('warehouse_stock_reclass_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (requestErr) throw requestErr;
  if (!request) throw new Error(`Request reklasifikasi #${requestId} tidak ditemukan.`);

  const products = await loadWarehouseProductsByIds(svc, [
    Number(request.source_warehouse_product_id),
    Number(request.target_warehouse_product_id),
  ]);
  const sourceProduct = products.get(Number(request.source_warehouse_product_id));
  const targetProduct = products.get(Number(request.target_warehouse_product_id));

  return { request, sourceProduct, targetProduct };
}

async function applyStockReclassRequestInternal(
  svc: ReturnType<typeof createServiceSupabase>,
  request: any,
  sourceProduct: any,
  targetProduct: any,
  actedByUserId: string,
) {
  const refId = request.ledger_reference_id || `reclass-${request.id}`;
  const notesBase = `[RECLASS#${request.id}] ${sourceProduct.name} (${sourceProduct.category}) -> ${targetProduct.name} (${targetProduct.category})`;
  const quantity = Number(request.quantity || 0);

  if (quantity <= 0) throw new Error('Quantity reklasifikasi tidak valid.');

  if (request.source_batch_id) {
    const sourceBatch = await deductBatchQuantityOrThrow(
      svc,
      Number(request.source_batch_id),
      Number(sourceProduct.id),
      quantity,
    );

    let targetBatchId: number | null = null;
    if (sourceBatch.batch_code) {
      const targetBatch = await findOrCreateTargetBatch(
        svc,
        Number(targetProduct.id),
        sourceBatch.batch_code,
        sourceBatch.expired_date || null,
        sourceBatch.cost_per_unit ?? null,
      );
      targetBatchId = Number(targetBatch.id);

      const { error: targetBatchErr } = await svc
        .from('warehouse_batches')
        .update({ current_qty: Number(targetBatch.current_qty || 0) + quantity })
        .eq('id', targetBatchId);
      if (targetBatchErr) throw targetBatchErr;
    }

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(sourceProduct.id),
      batch_id: Number(request.source_batch_id),
      movement_type: 'OUT',
      quantity: -quantity,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(targetProduct.id),
      batch_id: targetBatchId,
      movement_type: 'IN',
      quantity,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    return { referenceId: refId };
  }

  const { data: availableBatches, error: batchErr } = await svc
    .from('warehouse_batches')
    .select('id')
    .eq('warehouse_product_id', Number(sourceProduct.id))
    .eq('is_active', true)
    .gt('current_qty', 0)
    .limit(1);
  if (batchErr) throw batchErr;

  if ((availableBatches || []).length === 0) {
    const currentBalance = await getCurrentBalance(svc, Number(sourceProduct.id));
    if (quantity > currentBalance) {
      throw new Error(`Qty melebihi saldo produk sumber (${currentBalance}).`);
    }

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(sourceProduct.id),
      batch_id: null,
      movement_type: 'OUT',
      quantity: -quantity,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(targetProduct.id),
      batch_id: null,
      movement_type: 'IN',
      quantity,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    return { referenceId: refId };
  }

  const { data: fifoBatches, error: fifoBatchErr } = await svc
    .from('warehouse_batches')
    .select('id, batch_code, expired_date, cost_per_unit, current_qty')
    .eq('warehouse_product_id', Number(sourceProduct.id))
    .eq('is_active', true)
    .gt('current_qty', 0)
    .order('expired_date', { ascending: true, nullsFirst: false });
  if (fifoBatchErr) throw fifoBatchErr;

  const sourceBatches = fifoBatches || [];
  const batchTotal = sourceBatches.reduce((sum: number, row: any) => sum + Number(row.current_qty || 0), 0);
  if (batchTotal < quantity) {
    throw new Error(`Qty melebihi total stok batch produk sumber (${batchTotal}).`);
  }

  let remaining = quantity;
  for (const sourceBatch of sourceBatches) {
    if (remaining <= 0) break;
    const deductedQty = Math.min(Number(sourceBatch.current_qty || 0), remaining);
    if (deductedQty <= 0) continue;

    await deductBatchQuantityOrThrow(
      svc,
      Number(sourceBatch.id),
      Number(sourceProduct.id),
      deductedQty,
    );

    const targetBatch = await findOrCreateTargetBatch(
      svc,
      Number(targetProduct.id),
      sourceBatch.batch_code,
      sourceBatch.expired_date || null,
      sourceBatch.cost_per_unit ?? null,
    );
    const targetBatchId = Number(targetBatch.id);

    const { error: targetBatchErr } = await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(targetBatch.current_qty || 0) + deductedQty })
      .eq('id', targetBatchId);
    if (targetBatchErr) throw targetBatchErr;

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(sourceProduct.id),
      batch_id: Number(sourceBatch.id),
      movement_type: 'OUT',
      quantity: -deductedQty,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    await insertLedgerEntry(svc, {
      warehouse_product_id: Number(targetProduct.id),
      batch_id: targetBatchId,
      movement_type: 'IN',
      quantity: deductedQty,
      reference_type: 'reclass',
      reference_id: refId,
      notes: `${notesBase} | ${request.reason}`,
      created_by: actedByUserId,
    });

    remaining -= deductedQty;
  }

  if (remaining > 0) {
    throw new Error(`Reklasifikasi batch tidak selesai. Sisa ${remaining} unit belum terpindah.`);
  }

  return { referenceId: refId };
}

export async function getStockReclassRequests(status?: WarehouseStockReclassStatus) {
  await requireWarehouseAccess('Reklasifikasi Stock');
  const svc = createServiceSupabase();

  let query = svc
    .from('warehouse_stock_reclass_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];
  const productIds = rows.flatMap((row: any) => [
    Number(row.source_warehouse_product_id),
    Number(row.target_warehouse_product_id),
  ]);
  const userIds = rows.flatMap((row: any) => [
    row.requested_by,
    row.approved_by,
    row.rejected_by,
    row.applied_by,
  ]).filter(Boolean);
  const batchIds = rows.map((row: any) => row.source_batch_id).filter(Boolean);

  const [productsRes, profilesRes, batchesRes, operationalProfilesRes] = await Promise.all([
    productIds.length > 0
      ? svc.from('warehouse_products').select('id, name, category, entity, warehouse').in('id', Array.from(new Set(productIds)))
      : Promise.resolve({ data: [], error: null } as any),
    userIds.length > 0
      ? svc.from('profiles').select('id, full_name, email').in('id', Array.from(new Set(userIds)))
      : Promise.resolve({ data: [], error: null } as any),
    batchIds.length > 0
      ? svc.from('warehouse_batches').select('id, batch_code, expired_date').in('id', Array.from(new Set(batchIds)))
      : Promise.resolve({ data: [], error: null } as any),
    productIds.length > 0
      ? svc.from('v_warehouse_product_operational_profiles').select('*').in('product_id', Array.from(new Set(productIds)))
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  if (batchesRes.error) throw batchesRes.error;
  if (operationalProfilesRes.error) throw operationalProfilesRes.error;

  const productMap = new Map((productsRes.data || []).map((row: any) => [Number(row.id), row]));
  const profileMap = new Map((profilesRes.data || []).map((row: any) => [row.id, row]));
  const batchMap = new Map((batchesRes.data || []).map((row: any) => [Number(row.id), row]));
  const operationalProfileMap = new Map((operationalProfilesRes.data || []).map((row: any) => [Number(row.product_id), row]));

  return rows.map((row: any) => ({
    ...row,
    source_product: productMap.get(Number(row.source_warehouse_product_id)) || null,
    target_product: productMap.get(Number(row.target_warehouse_product_id)) || null,
    source_operational_profile: operationalProfileMap.get(Number(row.source_warehouse_product_id)) || null,
    target_operational_profile: operationalProfileMap.get(Number(row.target_warehouse_product_id)) || null,
    source_batch: row.source_batch_id ? (batchMap.get(Number(row.source_batch_id)) || null) : null,
    requested_by_profile: row.requested_by ? (profileMap.get(row.requested_by) || null) : null,
    approved_by_profile: row.approved_by ? (profileMap.get(row.approved_by) || null) : null,
    rejected_by_profile: row.rejected_by ? (profileMap.get(row.rejected_by) || null) : null,
    applied_by_profile: row.applied_by ? (profileMap.get(row.applied_by) || null) : null,
  }));
}

export async function getWarehouseProductOperationalProfiles(productIds?: number[]) {
  await requireWarehouseAccess('Produk Gudang');
  const svc = createServiceSupabase();
  let query = svc
    .from('v_warehouse_product_operational_profiles')
    .select('*')
    .order('category')
    .order('product_name');

  if (productIds && productIds.length > 0) {
    query = query.in('product_id', Array.from(new Set(productIds.filter(Boolean))));
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getScalevAttributionProfiles(scalevProductNames?: string[]) {
  await requireWarehouseAccess('Mapping Scalev Attribution');
  const svc = createServiceSupabase();
  let query = svc
    .from('v_warehouse_scalev_attribution_profiles')
    .select('*')
    .order('scalev_product_name');

  if (scalevProductNames && scalevProductNames.length > 0) {
    query = query.in('scalev_product_name', Array.from(new Set(scalevProductNames.filter(Boolean))));
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createStockReclassRequest(input: WarehouseStockReclassRequestInput) {
  await requireWarehousePermission('wh:reclass_request', 'Reklasifikasi Stock');

  const quantity = Number(input.quantity || 0);
  if (quantity <= 0) throw new Error('Quantity harus lebih besar dari 0.');
  if (!input.reason?.trim()) throw new Error('Alasan reklasifikasi wajib diisi.');

  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Pengguna tidak ditemukan.');

  const products = await loadWarehouseProductsByIds(svc, [input.sourceProductId, input.targetProductId || 0]);
  const sourceProduct = products.get(Number(input.sourceProductId));
  if (!sourceProduct) throw new Error('Produk sumber tidak ditemukan.');

  let targetCategory = input.targetCategory?.trim().toLowerCase() || '';
  let targetProduct = input.targetProductId ? products.get(Number(input.targetProductId)) : null;
  let targetProductAutoCreated = false;

  if (targetProduct) {
    if (targetCategory && targetCategory !== targetProduct.category) {
      throw new Error('Kategori tujuan tidak cocok dengan produk target yang dipilih.');
    }
    targetCategory = targetCategory || targetProduct.category;
    validateStockReclassProducts(sourceProduct, targetProduct);
  } else {
    if (!targetCategory) {
      throw new Error('Kategori tujuan reklasifikasi wajib dipilih.');
    }
    const resolved = await resolveOrCreateStockReclassTargetProduct(svc, sourceProduct, targetCategory);
    targetProduct = resolved.product;
    targetProductAutoCreated = resolved.autoCreated;
    validateStockReclassProducts(sourceProduct, targetProduct);
  }

  let sourceBatch: any = null;
  if (input.sourceBatchId) {
    sourceBatch = await getBatchOrThrow(svc, Number(input.sourceBatchId), Number(sourceProduct.id));
    if (quantity > Number(sourceBatch.current_qty || 0)) {
      throw new Error(`Qty melebihi stok batch ${sourceBatch.batch_code} (${sourceBatch.current_qty}).`);
    }
  } else {
    const currentBalance = await getCurrentBalance(svc, Number(sourceProduct.id));
    if (quantity > currentBalance) {
      throw new Error(`Qty melebihi saldo produk sumber (${currentBalance}).`);
    }
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await svc
    .from('warehouse_stock_reclass_requests')
    .insert({
      source_warehouse_product_id: Number(sourceProduct.id),
      source_batch_id: input.sourceBatchId ? Number(input.sourceBatchId) : null,
      target_warehouse_product_id: Number(targetProduct.id),
      requested_target_category: targetProduct.category,
      target_product_auto_created: targetProductAutoCreated,
      quantity,
      reason: input.reason.trim(),
      notes: input.notes?.trim() || null,
      requested_by: userId,
      requested_at: nowIso,
      source_product_name_snapshot: sourceProduct.name,
      source_category_snapshot: sourceProduct.category,
      source_entity_snapshot: sourceProduct.entity,
      source_warehouse_snapshot: sourceProduct.warehouse,
      target_product_name_snapshot: targetProduct.name,
      target_category_snapshot: targetProduct.category,
      target_entity_snapshot: targetProduct.entity,
      target_warehouse_snapshot: targetProduct.warehouse,
      source_batch_code_snapshot: sourceBatch?.batch_code || null,
      source_expired_date_snapshot: sourceBatch?.expired_date || null,
      updated_at: nowIso,
    })
    .select()
    .single();
  if (error) throw error;

  const userName = await getCurrentUserName();
  const time = new Date(nowIso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  await notifyDirektursWithMarkup(
    `📌 <b>Request Reklasifikasi Stock</b>\n` +
    `Request ID: ${data.id}\n` +
    `Dari: ${sourceProduct.name} (${sourceProduct.category})\n` +
    `Ke: ${targetProduct.name} (${targetProduct.category})\n` +
    `Gudang: ${sourceProduct.warehouse} - ${sourceProduct.entity}\n` +
    `Qty: ${quantity.toLocaleString('id-ID')}\n` +
    `Batch: ${sourceBatch?.batch_code || '-'}\n` +
    `Auto-create target: ${targetProductAutoCreated ? 'ya' : 'tidak'}\n` +
    `Alasan: ${input.reason.trim()}\n` +
    `Oleh: ${userName}\n` +
    `Waktu: ${time}`,
    {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `reclass:approve:${data.id}` },
        { text: '❌ Reject', callback_data: `reclass:reject:${data.id}` },
      ]],
    }
  );

  return data;
}

async function approveStockReclassRequestAsActor(
  requestId: number,
  actor: { id: string; displayName: string },
) {
  const svc = createServiceSupabase();
  const { request, sourceProduct, targetProduct } = await loadStockReclassRequestWithProductsOrThrow(svc, requestId);
  if (request.status !== 'requested') {
    throw new Error('Request reklasifikasi ini tidak siap di-approve.');
  }

  validateStockReclassProducts(sourceProduct, targetProduct);

  const applied = await applyStockReclassRequestInternal(
    svc,
    request,
    sourceProduct,
    targetProduct,
    actor.id,
  );

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await svc
    .from('warehouse_stock_reclass_requests')
    .update({
      status: 'applied',
      approved_by: actor.id,
      approved_at: nowIso,
      applied_by: actor.id,
      applied_at: nowIso,
      ledger_reference_id: applied.referenceId,
      updated_at: nowIso,
    })
    .eq('id', requestId)
    .eq('status', 'requested');
  if (updateErr) throw updateErr;

  const time = new Date(nowIso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  await notifyDirekturs(
    `✅ <b>Reklasifikasi Stock Applied</b>\n` +
    `Request ID: ${requestId}\n` +
    `Dari: ${sourceProduct.name} (${sourceProduct.category})\n` +
    `Ke: ${targetProduct.name} (${targetProduct.category})\n` +
    `Qty: ${Number(request.quantity || 0).toLocaleString('id-ID')}\n` +
    `Ref Ledger: ${applied.referenceId}\n` +
    `Oleh: ${actor.displayName}\n` +
    `Waktu: ${time}`
  );

  return { requestId, referenceId: applied.referenceId };
}

async function rejectStockReclassRequestAsActor(
  requestId: number,
  actor: { id: string; displayName: string },
  rejectionReason?: string | null,
) {
  const svc = createServiceSupabase();
  const { request } = await loadStockReclassRequestWithProductsOrThrow(svc, requestId);
  if (request.status !== 'requested') {
    throw new Error('Request reklasifikasi ini tidak bisa ditolak.');
  }

  const nowIso = new Date().toISOString();
  const normalizedReason = rejectionReason?.trim() || null;
  const { error } = await svc
    .from('warehouse_stock_reclass_requests')
    .update({
      status: 'rejected',
      rejected_by: actor.id,
      rejected_at: nowIso,
      rejection_reason: normalizedReason,
      updated_at: nowIso,
    })
    .eq('id', requestId)
    .eq('status', 'requested');
  if (error) throw error;

  const time = new Date(nowIso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  await notifyDirekturs(
    `❌ <b>Reklasifikasi Stock Rejected</b>\n` +
    `Request ID: ${requestId}\n` +
    `Alasan reject: ${normalizedReason || '-'}\n` +
    `Oleh: ${actor.displayName}\n` +
    `Waktu: ${time}`
  );

  return { requestId };
}

export async function approveStockReclassRequest(requestId: number) {
  await requireWarehousePermission('wh:reclass_approve', 'Approve Reklasifikasi Stock');
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Pengguna tidak ditemukan.');
  const approverName = await getCurrentUserName();
  return approveStockReclassRequestAsActor(requestId, {
    id: userId,
    displayName: approverName,
  });
}

export async function rejectStockReclassRequest(requestId: number, rejectionReason?: string | null) {
  await requireWarehousePermission('wh:reclass_approve', 'Reject Reklasifikasi Stock');
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Pengguna tidak ditemukan.');
  const rejectorName = await getCurrentUserName();
  return rejectStockReclassRequestAsActor(requestId, {
    id: userId,
    displayName: rejectorName,
  }, rejectionReason);
}

export async function approveStockReclassRequestViaTelegram(requestId: number, telegramChatId: string) {
  const svc = createServiceSupabase();
  const actor = await resolveTelegramWarehouseActorOrThrow(svc, telegramChatId, 'wh:reclass_approve');
  const result = await approveStockReclassRequestAsActor(requestId, actor);
  return {
    ...result,
    actorName: actor.displayName,
  };
}

export async function rejectStockReclassRequestViaTelegram(requestId: number, telegramChatId: string) {
  const svc = createServiceSupabase();
  const actor = await resolveTelegramWarehouseActorOrThrow(svc, telegramChatId, 'wh:reclass_approve');
  const reason = `Rejected via Telegram oleh ${actor.displayName}`;
  const result = await rejectStockReclassRequestAsActor(requestId, actor, reason);
  return {
    ...result,
    actorName: actor.displayName,
    rejectionReason: reason,
  };
}

// ============================================================
// DISPOSE — expired/damaged items
// ============================================================

export async function recordDispose(
  productId: number,
  batchId: number | null,
  quantity: number,
  reason?: string,
) {
  await requireWarehousePermission('wh:dispose', 'Dispose Stock');
  if (quantity <= 0) throw new Error('Dispose quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);
  }

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'DISPOSE',
    quantity: -quantity,
    reference_type: 'dispose',
    notes: reason,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Dispose', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName, reason ? `Alasan: ${reason}` : undefined));
  }

  return result;
}

// ============================================================
// BATCH MANAGEMENT
// ============================================================

export async function createBatchInternal(
  productId: number,
  batchCode: string,
  expiredDate: string | null,
  initialQty: number = 0,
  notes?: string,
) {
  const svc = createServiceSupabase();
  const normalizedBatchCode = batchCode.trim();
  const normalizedNotes = notes?.trim();
  if (!normalizedBatchCode) throw new Error('Kode batch wajib diisi');

  const batch = await findOrCreateTargetBatch(
    svc,
    productId,
    normalizedBatchCode,
    expiredDate || undefined,
  );

  // If initial qty > 0, create ledger entry
  if (initialQty > 0) {
    if (batch.created) {
      const { error } = await svc
        .from('warehouse_batches')
        .update({ initial_qty: initialQty })
        .eq('id', batch.id);
      if (error) throw error;
    }

    await recordStockInInternal(
      productId,
      batch.id,
      initialQty,
      'manual',
      undefined,
      normalizedNotes || (
        batch.created
          ? `Initial stock for batch ${normalizedBatchCode}`
          : `Stock masuk tambahan untuk batch ${normalizedBatchCode}`
      ),
    );
  }

  return batch;
}

export async function createBatch(
  productId: number,
  batchCode: string,
  expiredDate: string | null,
  initialQty: number = 0,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Batch Stock');
  return createBatchInternal(productId, batchCode, expiredDate, initialQty, notes);
}

// ============================================================
// QUERIES
// ============================================================

export async function getProductsFull(filters?: {
  category?: string;
  entity?: string;
  warehouse?: string;
  brand_id?: number;
  includeInactive?: boolean;
}) {
  await requireAnyWarehouseSettingsPermission(['whs:products', 'whs:warehouses'], 'Master Produk Gudang');
  const svc = createServiceSupabase();
  let query = svc.from('warehouse_products').select('*, brands(id, name), warehouse_vendors(id, name)');

  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.entity) query = query.eq('entity', filters.entity);
  if (filters?.warehouse) query = query.eq('warehouse', filters.warehouse);
  if (filters?.brand_id) query = query.eq('brand_id', filters.brand_id);
  if (!filters?.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('entity').order('category').order('name');
  if (error) throw error;
  return data || [];
}

export async function createProduct(product: {
  name: string; sku?: string | null; category: string; unit: string; entity: string; warehouse: string;
  price_list?: number; hpp?: number; vendor_id?: number | null; brand_id?: number;
  reorder_threshold?: number; scalev_product_names?: string[];
}) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_products')
    .insert({ ...product, is_active: true })
    .select()
    .single();
  if (error) throw error;

  await recordWarehouseActivityLog({
    scope: 'warehouse_product_config',
    action: 'create',
    screen: 'Master Produk Gudang',
    summary: `Membuat produk ${data.name}`,
    targetType: 'warehouse_product',
    targetId: String(data.id),
    targetLabel: `${data.name} [${data.warehouse || '-'}-${data.entity || '-'}]`,
    changedFields: [
      'name',
      'sku',
      'category',
      'unit',
      'entity',
      'warehouse',
      'price_list',
      'hpp',
      'vendor_id',
      'brand_id',
      'reorder_threshold',
      'scalev_product_names',
      'is_active',
    ],
    beforeState: {},
    afterState: {
      id: Number(data.id),
      name: data.name,
      sku: data.sku || null,
      category: data.category || null,
      unit: data.unit || null,
      entity: data.entity || null,
      warehouse: data.warehouse || null,
      price_list: data.price_list ?? null,
      hpp: data.hpp ?? null,
      vendor_id: data.vendor_id ?? null,
      brand_id: data.brand_id ?? null,
      reorder_threshold: data.reorder_threshold ?? null,
      scalev_product_names: normalizeAuditArray(data.scalev_product_names),
      is_active: Boolean(data.is_active),
    },
    context: {},
  });

  return data;
}

export async function updateProduct(id: number, updates: Record<string, any>) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { data: beforeRow, error: beforeError } = await svc
    .from('warehouse_products')
    .select('id, name, sku, category, unit, entity, warehouse, price_list, hpp, vendor_id, brand_id, reorder_threshold, scalev_product_names, is_active')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!beforeRow) throw new Error('Produk gudang tidak ditemukan.');

  const { error } = await svc
    .from('warehouse_products')
    .update(updates)
    .eq('id', id);
  if (error) throw error;

  const { data: afterRow, error: afterError } = await svc
    .from('warehouse_products')
    .select('id, name, sku, category, unit, entity, warehouse, price_list, hpp, vendor_id, brand_id, reorder_threshold, scalev_product_names, is_active')
    .eq('id', id)
    .maybeSingle();
  if (afterError) throw afterError;
  if (!afterRow) return;

  const beforeState = {
    name: beforeRow.name,
    sku: beforeRow.sku || null,
    category: beforeRow.category || null,
    unit: beforeRow.unit || null,
    entity: beforeRow.entity || null,
    warehouse: beforeRow.warehouse || null,
    price_list: beforeRow.price_list ?? null,
    hpp: beforeRow.hpp ?? null,
    vendor_id: beforeRow.vendor_id ?? null,
    brand_id: beforeRow.brand_id ?? null,
    reorder_threshold: beforeRow.reorder_threshold ?? null,
    scalev_product_names: normalizeAuditArray(beforeRow.scalev_product_names),
    is_active: Boolean(beforeRow.is_active),
  };
  const afterState = {
    name: afterRow.name,
    sku: afterRow.sku || null,
    category: afterRow.category || null,
    unit: afterRow.unit || null,
    entity: afterRow.entity || null,
    warehouse: afterRow.warehouse || null,
    price_list: afterRow.price_list ?? null,
    hpp: afterRow.hpp ?? null,
    vendor_id: afterRow.vendor_id ?? null,
    brand_id: afterRow.brand_id ?? null,
    reorder_threshold: afterRow.reorder_threshold ?? null,
    scalev_product_names: normalizeAuditArray(afterRow.scalev_product_names),
    is_active: Boolean(afterRow.is_active),
  };
  const changedFields = getAuditChangedFields(beforeState, afterState, [
    'name',
    'sku',
    'category',
    'unit',
    'entity',
    'warehouse',
    'price_list',
    'hpp',
    'vendor_id',
    'brand_id',
    'reorder_threshold',
    'scalev_product_names',
    'is_active',
  ]);
  if (changedFields.length === 0) return;

  await recordWarehouseActivityLog({
    scope: 'warehouse_product_config',
    action: 'update',
    screen: 'Master Produk Gudang',
    summary: `Memperbarui produk ${afterRow.name}`,
    targetType: 'warehouse_product',
    targetId: String(afterRow.id),
    targetLabel: `${afterRow.name} [${afterRow.warehouse || '-'}-${afterRow.entity || '-'}]`,
    changedFields,
    beforeState,
    afterState,
    context: {},
  });
}

export async function deactivateProduct(id: number) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { data: beforeRow, error: beforeError } = await svc
    .from('warehouse_products')
    .select('id, name, category, unit, entity, warehouse, is_active')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!beforeRow) throw new Error('Produk gudang tidak ditemukan.');

  const { error } = await svc
    .from('warehouse_products')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;

  await recordWarehouseActivityLog({
    scope: 'warehouse_product_config',
    action: beforeRow.is_active ? 'deactivate' : 'update',
    screen: 'Master Produk Gudang',
    summary: `Menonaktifkan produk ${beforeRow.name}`,
    targetType: 'warehouse_product',
    targetId: String(beforeRow.id),
    targetLabel: `${beforeRow.name} [${beforeRow.warehouse || '-'}-${beforeRow.entity || '-'}]`,
    changedFields: ['is_active'],
    beforeState: {
      is_active: Boolean(beforeRow.is_active),
      name: beforeRow.name,
      category: beforeRow.category || null,
      unit: beforeRow.unit || null,
      entity: beforeRow.entity || null,
      warehouse: beforeRow.warehouse || null,
    },
    afterState: {
      is_active: false,
      name: beforeRow.name,
      category: beforeRow.category || null,
      unit: beforeRow.unit || null,
      entity: beforeRow.entity || null,
      warehouse: beforeRow.warehouse || null,
    },
    context: {},
  });
}

export async function getProducts(filters?: {
  category?: string;
  entity?: string;
  warehouse?: string;
  activeOnly?: boolean;
}) {
  await requireWarehouseReadForSharedProducts('Produk Gudang');
  const svc = createServiceSupabase();
  let query = svc.from('warehouse_products').select('*');

  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.entity) query = query.eq('entity', filters.entity);
  if (filters?.warehouse) query = query.eq('warehouse', filters.warehouse);
  if (filters?.activeOnly !== false) query = query.eq('is_active', true);

  const { data, error } = await query.order('category').order('name');
  if (error) throw error;
  return data || [];
}

export async function getStockBalance(productId?: number) {
  await requireWarehouseAccess('Saldo Stock');
  const svc = createServiceSupabase();
  let query = svc.from('v_warehouse_stock_balance').select('*');
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('category').order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getWipEventHistory(limit: number = 100) {
  await requireWarehouseAccess('Work in Process');
  const svc = createServiceSupabase();

  const { data: products, error: productError } = await svc
    .from('warehouse_products')
    .select('id, name, category, entity, warehouse, unit')
    .in('category', ['wip', 'wip_material'])
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (productError) throw productError;

  const productRows = products || [];
  const productIds = productRows.map((row: any) => Number(row.id)).filter(Boolean);
  if (productIds.length === 0) return [];

  const ledgerSelect = `
    id,
    warehouse_product_id,
    movement_type,
    quantity,
    reference_type,
    reference_id,
    notes,
    created_by,
    created_at,
    warehouse_products!inner(id, name, category, entity, warehouse, unit),
    warehouse_batches(batch_code),
    profiles:created_by(full_name, email)
  `;

  const [wipRowsResult, conversionRowsResult] = await Promise.all([
    svc
      .from('warehouse_stock_ledger')
      .select(ledgerSelect)
      .in('warehouse_product_id', productIds)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.max(limit * 20, 500)),
    svc
      .from('warehouse_stock_ledger')
      .select(ledgerSelect)
      .like('reference_id', 'conv-%')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.max(limit * 20, 500)),
  ]);

  if (wipRowsResult.error) throw wipRowsResult.error;
  if (conversionRowsResult.error) throw conversionRowsResult.error;

  const dedupedRows = new Map<number, any>();
  [...(wipRowsResult.data || []), ...(conversionRowsResult.data || [])].forEach((row: any) => {
    dedupedRows.set(Number(row.id), row);
  });

  const rows = Array.from(dedupedRows.values()).sort((a: any, b: any) => {
    const timeDiff = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    if (timeDiff !== 0) return timeDiff;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  const events = new Map<string, any>();
  for (const row of rows) {
    const referenceId = String(row.reference_id || '');
    const isConversionEvent = referenceId.startsWith('conv-');
    const key = isConversionEvent ? `conversion:${referenceId}` : `ledger:${row.id}`;

    if (!events.has(key)) {
      events.set(key, {
        event_key: key,
        reference_id: row.reference_id || null,
        reference_type: row.reference_type || null,
        event_kind: isConversionEvent ? 'conversion' : 'single',
        rows: [],
      });
    }

    events.get(key).rows.push(row);
  }

  const movementLabelMap: Record<string, string> = {
    IN: 'Masuk',
    OUT: 'Keluar',
    ADJUST: 'Adjust',
    TRANSFER_IN: 'Transfer In',
    TRANSFER_OUT: 'Transfer Out',
    DISPOSE: 'Dispose',
  };

  return Array.from(events.values())
    .map((event) => {
      const eventRows = [...event.rows].sort((a: any, b: any) => {
        const timeDiff = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        if (timeDiff !== 0) return timeDiff;
        return Number(b.id || 0) - Number(a.id || 0);
      });

      const latestRow = eventRows[0];
      const actorName = latestRow?.profiles?.full_name || latestRow?.profiles?.email || (latestRow?.created_by ? '...' : null);
      const locations = Array.from(new Set(
        eventRows.map((row: any) => row.warehouse_products ? `${row.warehouse_products.warehouse} - ${row.warehouse_products.entity}` : '')
          .filter(Boolean),
      ));

      if (event.event_kind === 'conversion') {
        const targetRows = eventRows.filter((row: any) => Number(row.quantity || 0) > 0);
        const sourceRows = eventRows.filter((row: any) => Number(row.quantity || 0) < 0);
        const anchorRows = (targetRows.length > 0 ? targetRows : eventRows).slice().sort((a: any, b: any) => {
          const timeDiff = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
          if (timeDiff !== 0) return timeDiff;
          return Number(a.id || 0) - Number(b.id || 0);
        });
        const anchorRow = anchorRows[0] || latestRow;
        const targetNames = Array.from(new Set(targetRows.map((row: any) => row.warehouse_products?.name).filter(Boolean)));
        const sourceSummary = sourceRows
          .map((row: any) => `${row.warehouse_products?.name || '-'} (${Math.abs(Number(row.quantity || 0)).toLocaleString('id-ID')})`)
          .join(', ');
        const targetQty = targetRows.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
        const note = targetRows.find((row: any) => row.notes)?.notes || latestRow?.notes || null;
        const sourceLines = sourceRows.map((row: any) => ({
          id: Number(row.id),
          product_name: row.warehouse_products?.name || '-',
          quantity: Math.abs(Number(row.quantity || 0)),
          batch_code: row.warehouse_batches?.batch_code || null,
          note: row.notes || null,
        }));
        const targetLines = targetRows.map((row: any) => ({
          id: Number(row.id),
          product_name: row.warehouse_products?.name || '-',
          quantity: Number(row.quantity || 0),
          batch_code: row.warehouse_batches?.batch_code || null,
          note: row.notes || null,
        }));

        return {
          event_key: event.event_key,
          event_at: anchorRow?.created_at || latestRow?.created_at || null,
          event_label: 'Konversi',
          event_kind: 'conversion',
          item_label: targetNames.join(', ') || 'Konversi',
          component_summary: sourceSummary || '-',
          warehouse_label: locations.join(', ') || '-',
          quantity: targetQty || null,
          actor_name: actorName,
          note,
          reference_id: event.reference_id,
          reference_type: event.reference_type,
          row_count: eventRows.length,
          source_lines: sourceLines,
          target_lines: targetLines,
        };
      }

      const movementType = String(latestRow?.movement_type || '');
      return {
        event_key: event.event_key,
        event_at: latestRow?.created_at || null,
        event_label: movementLabelMap[movementType] || movementType || 'Aktivitas',
        event_kind: movementType.toLowerCase() || 'single',
        item_label: latestRow?.warehouse_products?.name || '-',
        component_summary: latestRow?.warehouse_batches?.batch_code ? `Batch ${latestRow.warehouse_batches.batch_code}` : '-',
        warehouse_label: locations.join(', ') || '-',
        quantity: latestRow?.quantity == null ? null : Number(latestRow.quantity),
        actor_name: actorName,
        note: latestRow?.notes || null,
        reference_id: event.reference_id,
        reference_type: event.reference_type,
        row_count: 1,
        source_lines: [],
        target_lines: [],
      };
    })
    .sort((a, b) => new Date(b.event_at || 0).getTime() - new Date(a.event_at || 0).getTime())
    .slice(0, Math.max(Number(limit || 100), 1));
}

export async function getStockByBatch(productId?: number) {
  await requireWarehouseAccess('Batch & Expiry');
  const svc = createServiceSupabase();
  let query = svc.from('v_warehouse_batch_stock').select('*');
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('expired_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function getLedgerHistory(filters?: {
  productId?: number;
  movementType?: MovementType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  shipmentGoLiveAt?: string | null;
}) {
  await requireWarehouseAccess('Movement Log');
  const svc = createServiceSupabase();
  const selectClause = `
    id,
    warehouse_product_id,
    batch_id,
    movement_type,
    quantity,
    running_balance,
    reference_type,
    reference_id,
    notes,
    created_by,
    created_at,
    warehouse_products!inner(name, category, entity),
    warehouse_batches(batch_code, expired_date),
    profiles:created_by(full_name, email)
  `;
  const rows: any[] = [];
  const requestedLimit = Math.max(1, Number(filters?.limit || 100));
  const pageSize = Math.min(requestedLimit, 1000);
  let offset = 0;

  while (rows.length < requestedLimit) {
    let query = svc
      .from('warehouse_stock_ledger')
      .select(selectClause);

    if (filters?.productId) query = query.eq('warehouse_product_id', filters.productId);
    if (filters?.movementType) query = query.eq('movement_type', filters.movementType);
    if (filters?.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('created_at', filters.dateTo);

    const upper = offset + Math.min(pageSize, requestedLimit - rows.length) - 1;
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, upper);
    if (error) throw error;

    const page = data || [];
    rows.push(
      ...page.filter((row: any) => !shouldHidePreGoLiveSystemLedgerRow(row, filters?.shipmentGoLiveAt ?? null)),
    );
    if (page.length < (upper - offset + 1)) break;
    offset += page.length;
  }

  const scalevOrderIds = Array.from(new Set(
    rows
      .filter((row: any) => row.reference_type === 'scalev_order' && row.reference_id)
      .map((row: any) => String(row.reference_id)),
  ));
  const orderDateByOrderId = new Map<string, string | null>();

  for (let i = 0; i < scalevOrderIds.length; i += 200) {
    const chunk = scalevOrderIds.slice(i, i + 200);
    const { data: orders, error: ordersError } = await svc
      .from('scalev_orders')
      .select('order_id, shipped_time, completed_time')
      .in('order_id', chunk);
    if (ordersError) throw ordersError;

    for (const order of orders || []) {
      orderDateByOrderId.set(order.order_id, order.shipped_time || order.completed_time || null);
    }
  }

  return rows.map((row: any) => ({
    ...row,
    scalev_order_effective_date: row.reference_type === 'scalev_order'
      ? orderDateByOrderId.get(String(row.reference_id || '')) || null
      : null,
  }));
}

export async function getLedgerQuantitySum(filters: {
  productId: number;
  beforeDateExclusive?: string;
  dateFrom?: string;
  dateTo?: string;
  shipmentGoLiveAt?: string | null;
}) {
  await requireWarehouseAccess('Movement Log');
  const svc = createServiceSupabase();
  const pageSize = 1000;
  let offset = 0;
  let total = 0;

  while (true) {
    let query = svc
      .from('warehouse_stock_ledger')
      .select('quantity, reference_type, created_at')
      .eq('warehouse_product_id', filters.productId);

    if (filters.beforeDateExclusive) query = query.lt('created_at', filters.beforeDateExclusive);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo);

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const rawPage = data || [];
    const page = rawPage.filter((row: any) => !shouldHidePreGoLiveSystemLedgerRow(row, filters.shipmentGoLiveAt ?? null));
    total += page.reduce((sum, row: any) => sum + Number(row.quantity || 0), 0);
    if (rawPage.length < pageSize) break;
    offset += rawPage.length;
  }

  return total;
}

export async function getDailyMovementSummary(date: string) {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const goLiveAt = await loadWarehouseGoLiveAt(svc);
  const isGoLiveDay = isWarehouseGoLiveActive(goLiveAt) && isWarehouseGoLiveDate(date, goLiveAt);

  if (!isGoLiveDay) {
    const rpcResult = await svc.rpc('warehouse_daily_movement_summary', { p_date: date });
    if (rpcResult.error && !isMissingRpcFunctionError(rpcResult.error, 'warehouse_daily_movement_summary')) {
      throw rpcResult.error;
    }
    if (!rpcResult.error && Array.isArray(rpcResult.data)) {
      return (rpcResult.data || []).sort((a: any, b: any) =>
        a.entity.localeCompare(b.entity) || a.product_name.localeCompare(b.product_name),
      );
    }
  }

  const data = await fetchDailyMovementRows(
    svc,
    date,
    isGoLiveDay ? { fromInclusive: goLiveAt } : undefined,
  );
  if (!data || data.length === 0) return [];

  // Aggregate by product
  const byProduct = new Map<number, {
    product_name: string; category: string; entity: string;
    total_in: number; total_out: number; total_adjust: number;
  }>();

  for (const r of data) {
    const pid = r.warehouse_product_id;
    if (!byProduct.has(pid)) {
      const wp = r.warehouse_products as any;
      byProduct.set(pid, {
        product_name: wp?.name || '-',
        category: wp?.category || '-',
        entity: wp?.entity || '-',
        total_in: 0, total_out: 0, total_adjust: 0,
      });
    }
    const row = byProduct.get(pid)!;
    const qty = Number(r.quantity);
    if (r.movement_type === 'IN' || r.movement_type === 'TRANSFER_IN') {
      row.total_in += qty;
    } else if (r.movement_type === 'OUT' || r.movement_type === 'TRANSFER_OUT' || r.movement_type === 'DISPOSE') {
      row.total_out += qty;
    } else if (r.movement_type === 'ADJUST') {
      row.total_adjust += qty;
    }
  }

  return Array.from(byProduct.entries()).map(([id, v]) => ({
    product_id: id,
    ...v,
    net_change: v.total_in + v.total_out + v.total_adjust,
  })).sort((a, b) => a.entity.localeCompare(b.entity) || a.product_name.localeCompare(b.product_name));
}

export async function getBatches(productId: number, options?: { includeInactive?: boolean }) {
  await requireWarehouseAccess('Batch Stock');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_batches')
    .select('*')
    .eq('warehouse_product_id', productId);

  if (!options?.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query
    .order('is_active', { ascending: false })
    .order('expired_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getWarehouseRTSReturnTargets(sourceProductId: number) {
  await requireWarehouseAccess('Verifikasi RTS');
  const svc = createServiceSupabase();
  const { data: sourceProduct, error: sourceErr } = await svc
    .from('warehouse_products')
    .select('id, name, category, entity, warehouse, unit, is_active')
    .eq('id', sourceProductId)
    .maybeSingle();
  if (sourceErr) throw sourceErr;
  if (!sourceProduct) throw new Error('Produk sumber RTS tidak ditemukan.');

  const { data: candidateRows, error: candidateErr } = await svc
    .from('warehouse_products')
    .select('id, name, category, entity, warehouse, unit, is_active')
    .eq('entity', sourceProduct.entity)
    .eq('warehouse', sourceProduct.warehouse)
    .eq('is_active', true)
    .in('category', ['wip', 'wip_material'])
    .order('category')
    .order('name');
  if (candidateErr) throw candidateErr;

  return (candidateRows || [])
    .map((row: any) => ({
      ...row,
      id: Number(row.id),
      related_score: scoreWarehouseRtsReturnTarget(sourceProduct, row),
      is_source_product: Number(row.id) === Number(sourceProduct.id),
    }))
    .sort((left: any, right: any) =>
      Number(right.related_score || 0) - Number(left.related_score || 0)
      || Number(right.is_source_product ? 1 : 0) - Number(left.is_source_product ? 1 : 0)
      || String(left.category || '').localeCompare(String(right.category || ''))
      || String(left.name || '').localeCompare(String(right.name || '')),
    );
}

export async function getWarehouseRTSVerifications(status: 'pending' | 'completed' | 'cancelled' | 'all' = 'pending') {
  await requireWarehouseAccess('Verifikasi RTS');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_rts_verifications')
    .select(`
      id,
      scalev_order_id,
      order_id,
      business_code,
      order_status,
      scope,
      status,
      expected_total_qty,
      notes,
      triggered_at,
      completed_at,
      items:warehouse_rts_verification_items(
        id,
        warehouse_product_id,
        scalev_product_summary,
        expected_qty,
        restock_qty,
        damaged_qty,
        target_batch_id,
        target_batch_code_snapshot,
        notes,
        warehouse_products(id, name, category, entity, warehouse, unit),
        warehouse_batches(id, batch_code, expired_date, current_qty, is_active)
      )
    `);

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query
    .order('triggered_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...row,
    items: (row.items || []).map((item: any) => ({
      ...(() => {
        const parsedNotes = parseWarehouseRtsItemStoredNotes(item.notes);
        const fallbackAllocations = parsedNotes.allocations.length > 0
          ? parsedNotes.allocations
          : (
            Number(item.restock_qty || 0) > QUANTITY_EPSILON && item.target_batch_id
              ? [{
                  warehouse_product_id: Number(item.warehouse_product_id),
                  warehouse_product_name: item.warehouse_products?.name || null,
                  warehouse_product_category: item.warehouse_products?.category || null,
                  quantity: Number(item.restock_qty || 0),
                  target_batch_id: Number(item.target_batch_id),
                  target_batch_code_snapshot: item.target_batch_code_snapshot || item.warehouse_batches?.batch_code || null,
                  notes: parsedNotes.userNotes,
                }]
              : []
          );

        return {
          ...item,
          warehouse_product_id: Number(item.warehouse_product_id),
          expected_qty: Number(item.expected_qty || 0),
          restock_qty: item.restock_qty == null ? null : Number(item.restock_qty),
          damaged_qty: item.damaged_qty == null ? null : Number(item.damaged_qty),
          target_batch_id: item.target_batch_id == null ? null : Number(item.target_batch_id),
          notes: parsedNotes.userNotes,
          return_mode: parsedNotes.mode,
          allocations: fallbackAllocations,
        };
      })(),
    })),
  }));
}

export async function completeWarehouseRTSVerification(
  verificationId: number,
  payload: {
    items: Array<{
      itemId: number;
      mode?: WarehouseRtsReturnMode | null;
      restockQty?: number;
      targetBatchId?: number | null;
      allocations?: Array<{
        targetProductId: number;
        quantity: number;
        targetBatchId?: number | null;
        notes?: string | null;
      }>;
      notes?: string | null;
    }>;
    notes?: string | null;
  },
) : Promise<WarehouseMutationResult<{ verificationId: number }>> {
  try {
    await requireWarehousePermission('wh:stock_masuk', 'Verifikasi RTS');
    const svc = createServiceSupabase();
    const userId = await getCurrentUserId();
    const now = new Date().toISOString();

    const { data: verification, error: verificationErr } = await svc
      .from('warehouse_rts_verifications')
      .select('id, order_id, business_code, order_status, scope, status')
      .eq('id', verificationId)
      .single();
    if (verificationErr || !verification) throw new Error('Verifikasi RTS tidak ditemukan.');
    if (verification.status !== 'pending') {
      throw new Error('Verifikasi RTS ini tidak lagi berstatus pending.');
    }

    const { data: itemRows, error: itemsErr } = await svc
      .from('warehouse_rts_verification_items')
      .select(`
        id,
        warehouse_product_id,
        expected_qty,
        warehouse_products(id, name, category, entity, warehouse, unit)
      `)
      .eq('verification_id', verificationId)
      .order('id', { ascending: true });
    if (itemsErr) throw itemsErr;
    if (!itemRows || itemRows.length === 0) {
      throw new Error('Verifikasi RTS ini belum punya item yang bisa diproses. Benahi mapping produk/business lalu refresh queue RTS.');
    }

    const submittedById = new Map<number, {
      mode: WarehouseRtsReturnMode;
      restockQty: number;
      targetBatchId?: number | null;
      notes?: string | null;
      allocations: Array<{
        targetProductId: number;
        quantity: number;
        targetBatchId?: number | null;
        notes?: string | null;
      }>;
    }>();
    for (const item of payload.items || []) {
      submittedById.set(Number(item.itemId), {
        mode: sanitizeWarehouseRtsReturnMode(item.mode),
        restockQty: Number(item.restockQty || 0),
        targetBatchId: item.targetBatchId == null ? null : Number(item.targetBatchId),
        notes: item.notes?.trim() || null,
        allocations: Array.isArray(item.allocations)
          ? item.allocations.map((allocation) => ({
              targetProductId: Number(allocation.targetProductId || 0),
              quantity: Number(allocation.quantity || 0),
              targetBatchId: allocation.targetBatchId == null ? null : Number(allocation.targetBatchId),
              notes: allocation.notes?.trim() || null,
            }))
          : [],
      });
    }

    const verificationItems = itemRows || [];
    const requestedTargetProductIds = new Set<number>();
    for (const submitted of Array.from(submittedById.values())) {
      if (submitted.mode === 'same_product') continue;
      for (const allocation of submitted.allocations) {
        if (allocation.targetProductId > 0 && allocation.quantity > QUANTITY_EPSILON) {
          requestedTargetProductIds.add(Number(allocation.targetProductId));
        }
      }
    }

    const targetProducts = await loadWarehouseProductsByIds(svc, Array.from(requestedTargetProductIds));
    for (const item of verificationItems) {
      const sourceProduct = item.warehouse_products as any;
      if (!sourceProduct) throw new Error('Produk sumber RTS tidak ditemukan.');

      const submitted = submittedById.get(Number(item.id)) || {
        mode: 'same_product' as WarehouseRtsReturnMode,
        restockQty: 0,
        targetBatchId: null,
        notes: null,
        allocations: [],
      };
      const expectedQty = Number(item.expected_qty || 0);
      const mode = sanitizeWarehouseRtsReturnMode(submitted.mode);
      const persistedAllocations: WarehouseRtsAllocationSnapshot[] = [];
      let restockQty = 0;
      let targetBatchCodeSnapshot: string | null = null;
      let targetBatchId: number | null = null;

      if (mode === 'same_product') {
        restockQty = Number(submitted.restockQty || 0);
        if (restockQty < 0) {
          throw new Error('Qty layak masuk tidak boleh negatif.');
        }
        if (restockQty - expectedQty > QUANTITY_EPSILON) {
          throw new Error('Qty layak masuk tidak boleh melebihi qty expected.');
        }
        if (restockQty > QUANTITY_EPSILON && !submitted.targetBatchId) {
          throw new Error('Batch tujuan wajib dipilih jika ada qty yang dikembalikan ke stok.');
        }

        if (restockQty > QUANTITY_EPSILON && submitted.targetBatchId) {
          const batch = await getBatchOrThrow(svc, Number(submitted.targetBatchId), Number(item.warehouse_product_id));
          targetBatchCodeSnapshot = batch.batch_code || null;
          targetBatchId = Number(submitted.targetBatchId);
          await recordStockInInternal(
            Number(item.warehouse_product_id),
            Number(submitted.targetBatchId),
            restockQty,
            'rts',
            String(verification.order_id),
            [
              `RTS verified untuk order ${verification.order_id}`,
              verification.business_code ? `business ${verification.business_code}` : null,
              submitted.notes?.trim() || null,
            ].filter(Boolean).join(' • '),
          );

          persistedAllocations.push({
            warehouse_product_id: Number(item.warehouse_product_id),
            warehouse_product_name: sourceProduct.name || null,
            warehouse_product_category: sourceProduct.category || null,
            quantity: restockQty,
            target_batch_id: Number(submitted.targetBatchId),
            target_batch_code_snapshot: targetBatchCodeSnapshot,
            notes: submitted.notes?.trim() || null,
          });
        }
      } else {
        for (const allocation of submitted.allocations || []) {
          const quantity = Number(allocation.quantity || 0);
          if (quantity < 0) {
            throw new Error('Qty alokasi RTS tidak boleh negatif.');
          }
          if (quantity <= QUANTITY_EPSILON) continue;
          if (!allocation.targetProductId) {
            throw new Error('Produk tujuan alokasi RTS wajib dipilih.');
          }
          if (!allocation.targetBatchId) {
            throw new Error('Batch tujuan wajib dipilih untuk setiap alokasi RTS.');
          }

          const targetProduct = targetProducts.get(Number(allocation.targetProductId));
          if (!targetProduct) {
            throw new Error('Produk tujuan alokasi RTS tidak ditemukan.');
          }
          if (
            targetProduct.entity !== sourceProduct.entity
            || targetProduct.warehouse !== sourceProduct.warehouse
          ) {
            throw new Error('Produk tujuan alokasi RTS harus berada di gudang/entity yang sama.');
          }

          const batch = await getBatchOrThrow(svc, Number(allocation.targetBatchId), Number(allocation.targetProductId));
          await recordStockInInternal(
            Number(allocation.targetProductId),
            Number(allocation.targetBatchId),
            quantity,
            'rts',
            String(verification.order_id),
            [
              `RTS decomposed untuk order ${verification.order_id}`,
              verification.business_code ? `business ${verification.business_code}` : null,
              `source ${sourceProduct.name || item.warehouse_product_id}`,
              allocation.notes?.trim() || submitted.notes?.trim() || null,
            ].filter(Boolean).join(' • '),
          );

          persistedAllocations.push({
            warehouse_product_id: Number(allocation.targetProductId),
            warehouse_product_name: targetProduct.name || null,
            warehouse_product_category: targetProduct.category || null,
            quantity,
            target_batch_id: Number(allocation.targetBatchId),
            target_batch_code_snapshot: batch.batch_code || null,
            notes: allocation.notes?.trim() || null,
          });
          restockQty += quantity;
        }

        if (restockQty - expectedQty > QUANTITY_EPSILON) {
          throw new Error('Total alokasi RTS tidak boleh melebihi qty expected.');
        }
      }

      const damagedQty = expectedQty - restockQty;
      const storedNotes = buildWarehouseRtsItemStoredNotes({
        userNotes: submitted.notes?.trim() || null,
        mode,
        allocations: persistedAllocations,
      });

      const { error: itemUpdateErr } = await svc
        .from('warehouse_rts_verification_items')
        .update({
          restock_qty: restockQty,
          damaged_qty: damagedQty < QUANTITY_EPSILON ? 0 : damagedQty,
          target_batch_id: targetBatchId,
          target_batch_code_snapshot: targetBatchCodeSnapshot,
          notes: storedNotes,
          updated_at: now,
        })
        .eq('id', Number(item.id));
      if (itemUpdateErr) throw itemUpdateErr;
    }

    const { error: headerUpdateErr } = await svc
      .from('warehouse_rts_verifications')
      .update({
        status: 'completed',
        notes: payload.notes?.trim() || null,
        reviewed_by: userId,
        completed_at: now,
        updated_at: now,
        order_status: verification.order_status || null,
      })
      .eq('id', verificationId);
    if (headerUpdateErr) throw headerUpdateErr;

    return {
      success: true,
      data: { verificationId },
    };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal menyelesaikan verifikasi RTS.'),
    };
  }
}

// ============================================================
// SCALEV FIFO DEDUCTION (called from webhook)
// ============================================================

export async function deductStockFifo(
  scalevProductName: string,
  quantity: number,
  scalevOrderId: string,
  scalevOrderDbId?: number,
) {
  const svc = createServiceSupabase();

  // Deprecated compatibility helper: only allow an exact legacy mapping.
  const legacyMappings = await fetchScalevMappingsByProductNames(svc, [scalevProductName]);
  const mapping = legacyMappings.find((row) =>
    row.scalev_product_name === scalevProductName
    && row.warehouse_product_id != null
    && !row.is_ignored
    && !isSuspiciousLegacyScalevTarget({
      scalevProductName,
      mapping: row,
    })
  );
  if (!mapping?.warehouse_product_id) return null;

  // Call FIFO deduction function
  const { data, error } = await callWarehouseDeductFifoCompat(svc, {
    p_product_id: Number(mapping.warehouse_product_id),
    p_quantity: quantity,
    p_reference_type: 'scalev_order',
    p_reference_id: scalevOrderId,
    p_notes: `Auto-deduct: ${scalevProductName} x${quantity}`,
    p_scalev_order_id: scalevOrderDbId ?? null,
  });
  if (error) throw error;
  return { product: mapping.warehouse_products?.name || scalevProductName, deductions: data };
}

// ============================================================
// ORDER REVERSAL (for deleted/canceled orders)
// ============================================================

async function reverseOutstandingWarehouseDeductions(
  svc: ReturnType<typeof createServiceSupabase>,
  orderId: string,
  scalevOrderDbId?: number | null,
  reason: string = 'order no longer shipped/completed',
  orderSnapshot?: ScalevOrderWarehouseSnapshot | null,
) {
  const ledgerRows = await getScalevOrderLedgerRowsDetailed(svc, orderId, scalevOrderDbId);
  const outstandingGroups = summarizeOutstandingLedgerGroups(ledgerRows);
  if (outstandingGroups.length === 0) return 0;
  const orderContext = orderSnapshot === undefined
    ? await loadScalevOrderWarehouseSnapshot(svc, orderId, scalevOrderDbId)
    : orderSnapshot;
  const reversalNote = buildWarehouseReversalNote(orderId, reason, orderContext);

  let reversed = 0;
  for (const group of outstandingGroups) {
    if (group.batch_id != null) {
      await incrementBatchQuantityOrThrow(
        svc,
        group.batch_id,
        group.warehouse_product_id,
        Number(group.quantity),
      );
    }

    await insertLedgerEntry(svc, {
      warehouse_product_id: group.warehouse_product_id,
      batch_id: group.batch_id,
      movement_type: 'IN',
      quantity: Number(group.quantity),
      reference_type: 'scalev_order',
      reference_id: orderId,
      scalev_order_id: scalevOrderDbId ?? null,
      notes: reversalNote,
    });
    reversed++;
  }

  return reversed;
}

function buildScalevWarehouseLedgerNote(
  target: ResolvedWarehouseTarget,
  prefix: string = 'Auto',
) {
  return `${prefix}: ${target.scalev_product_name} x${target.quantity} [${target.note_context}]`;
}

async function applyScalevWarehouseTargets(
  svc: ReturnType<typeof createServiceSupabase>,
  order: ScalevOrderWarehouseSnapshot,
  targets: ResolvedWarehouseTarget[],
  notePrefix: string = 'Auto',
) {
  let deducted = 0;
  const deductAt = order.shipped_time || order.completed_time || new Date().toISOString();

  for (const target of targets) {
    const { error } = await callWarehouseDeductFifoCompat(svc, {
      p_product_id: target.warehouse_product_id,
      p_quantity: target.quantity,
      p_reference_type: 'scalev_order',
      p_reference_id: order.order_id,
      p_notes: buildScalevWarehouseLedgerNote(target, notePrefix),
      p_created_at: deductAt,
      p_scalev_order_id: order.id,
    });
    if (error) throw error;
    deducted++;
  }

  return deducted;
}

export async function reverseWarehouseDeductions(
  orderId: string,
  scalevOrderDbId?: number | null,
  reason: string = 'order no longer shipped/completed',
): Promise<number> {
  const svc = createServiceSupabase();
  return reverseOutstandingWarehouseDeductions(svc, orderId, scalevOrderDbId, reason);
}

export async function reconcileScalevOrderWarehouse(orderId: string, scalevOrderDbId?: number | null) {
  const svc = createServiceSupabase();
  const order = await loadScalevOrderWarehouseSnapshot(svc, orderId, scalevOrderDbId);
  if (!order) throw new Error(`Order ${orderId} tidak ditemukan`);
  const goLiveAt = await loadWarehouseGoLiveAt(svc);

  if (!isWarehouseGoLiveActive(goLiveAt)) {
    return {
      action: 'skipped_pre_go_live',
      reversed: 0,
      deducted: 0,
      skipped: 0,
      unmapped_products: [],
    };
  }

  if (isScalevOrderBeforeWarehouseGoLive(order, goLiveAt)) {
    if (isReturnedScalevOrderStatus(order.status)) {
      const assessment = await assessScalevOrderWarehouseState(svc, order);
      try {
        return await queueWarehouseRtsVerification(svc, assessment, 'pre_go_live');
      } catch (error) {
        if (!isMissingWarehouseTableError(error)) throw error;
        return applyPreGoLiveScalevReturn(svc, assessment);
      }
    }

    try {
      await cancelPendingWarehouseRtsVerification(svc, order.id, order.status || null);
    } catch (error) {
      if (!isMissingWarehouseTableError(error)) throw error;
    }
    return {
      action: 'skipped_pre_go_live',
      reversed: 0,
      deducted: 0,
      skipped: 0,
      unmapped_products: [],
    };
  }

  const assessment = await assessScalevOrderWarehouseState(svc, order);
  const isTerminal = isTerminalScalevOrderStatus(order.status);

  if (isReturnedScalevOrderStatus(order.status)) {
    try {
      return await queueWarehouseRtsVerification(svc, assessment, 'post_go_live');
    } catch (error) {
      if (!isMissingWarehouseTableError(error)) throw error;
    }
  }

  try {
    await cancelPendingWarehouseRtsVerification(svc, order.id, order.status || null);
  } catch (error) {
    if (!isMissingWarehouseTableError(error)) throw error;
  }

  if (!isTerminal) {
    const reversed = await reverseOutstandingWarehouseDeductions(
      svc,
      order.order_id,
      order.id,
      `status changed to ${order.status || 'unknown'}`,
      order,
    );
    return {
      action: reversed > 0 ? 'reversed' : 'unchanged',
      reversed,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
    };
  }

  if (!assessment.mapping || assessment.productLines.length === 0) {
    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.unmappedProducts.length > 0) {
    if (assessment.outstandingGroups.length === 0 && assessment.targets.length > 0) {
      const deducted = await applyScalevWarehouseTargets(svc, order, assessment.targets);

      return {
        action: 'partial',
        reversed: 0,
        deducted,
        skipped: assessment.skippedIgnored,
        unmapped_products: assessment.unmappedProducts,
        ...buildWarehouseIssueSummary(assessment),
      };
    }

    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.targets.length === 0) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const alreadyMatched = mapsEqualWithTolerance(assessment.outstandingByProduct, assessment.desiredByProduct);
  if (alreadyMatched) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const reversed = await reverseOutstandingWarehouseDeductions(
    svc,
    order.order_id,
    order.id,
    `reconcile before ${order.status || 'unknown'} deduction`,
    order,
  );

  const deducted = await applyScalevWarehouseTargets(svc, order, assessment.targets);

  return {
    action: 'deducted',
    reversed,
    deducted,
    skipped: assessment.skippedIgnored,
    unmapped_products: [],
  };
}

export async function repairPreGoLiveWrongAttributionOrder(orderId: string, scalevOrderDbId?: number | null) {
  await requireWarehousePermission('wh:mapping_sync', 'Sync Deduction Gudang');
  const svc = createServiceSupabase();
  const order = await loadScalevOrderWarehouseSnapshot(svc, orderId, scalevOrderDbId);
  if (!order) throw new Error(`Order ${orderId} tidak ditemukan`);

  const goLiveAt = await loadWarehouseGoLiveAt(svc);
  if (isWarehouseGoLiveActive(goLiveAt) && !isScalevOrderBeforeWarehouseGoLive(order, goLiveAt)) {
    throw new Error(`Order ${orderId} bukan order pra-go-live.`);
  }

  const assessment = await assessScalevOrderWarehouseState(svc, order);
  const isTerminal = isTerminalScalevOrderStatus(order.status);
  if (!isTerminal) {
    return {
      action: 'skipped_non_terminal',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
    };
  }

  if (!assessment.mapping || assessment.productLines.length === 0) {
    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.unmappedProducts.length > 0) {
    return {
      action: 'partial',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: assessment.unmappedProducts,
      ...buildWarehouseIssueSummary(assessment),
    };
  }

  if (assessment.targets.length === 0) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  if (assessment.outstandingGroups.length === 0) {
    return {
      action: 'skipped_no_existing_ledger',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const alreadyMatched = mapsEqualWithTolerance(assessment.outstandingByProduct, assessment.desiredByProduct);
  if (alreadyMatched) {
    return {
      action: 'unchanged',
      reversed: 0,
      deducted: 0,
      skipped: assessment.skippedIgnored,
      unmapped_products: [],
    };
  }

  const reversed = await reverseOutstandingWarehouseDeductions(
    svc,
    order.order_id,
    order.id,
    'Deduction lama dibatalkan karena target produk warehouse salah.',
    order,
  );
  const deducted = await applyScalevWarehouseTargets(svc, order, assessment.targets, 'Repair pra-go-live');

  await recordWarehouseActivityLog({
    scope: 'pre_go_live_ledger_repair',
    action: 'repair_wrong_attribution',
    screen: 'Daily Summary',
    summary: `Memperbaiki salah atribusi deduction order ${order.order_id}`,
    targetType: 'scalev_order',
    targetId: String(order.id),
    targetLabel: order.order_id,
    businessCode: order.business_code || null,
    changedFields: ['warehouse_deduction'],
    beforeState: {
      outstanding_by_product: Object.fromEntries(assessment.outstandingByProduct.entries()),
    },
    afterState: {
      desired_by_product: Object.fromEntries(assessment.desiredByProduct.entries()),
    },
    context: {
      reversed,
      deducted,
      shipped_time: order.shipped_time || null,
      completed_time: order.completed_time || null,
      targets: assessment.targets.map((target) => ({
        warehouse_product_id: target.warehouse_product_id,
        scalev_product_name: target.scalev_product_name,
        quantity: target.quantity,
        note_context: target.note_context,
      })),
    },
  });

  return {
    action: 'repaired_pre_go_live',
    reversed,
    deducted,
    skipped: assessment.skippedIgnored,
    unmapped_products: [],
  };
}

// ============================================================
// PURCHASE ORDERS
// ============================================================

export async function createPurchaseOrder(
  productId: number,
  quantityRequested: number,
  vendor?: string,
  poDate?: string,
  expectedDate?: string,
  notes?: string,
) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_purchase_orders')
    .insert({
      warehouse_product_id: productId,
      quantity_requested: quantityRequested,
      vendor,
      po_date: poDate || new Date().toISOString().slice(0, 10),
      expected_date: expectedDate,
      notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function receivePurchaseOrder(
  poId: number,
  quantityReceived: number,
  batchId?: number,
  notes?: string,
) {
  const svc = createServiceSupabase();

  // Get PO details
  const { data: po, error: poErr } = await svc
    .from('warehouse_purchase_orders')
    .select('*')
    .eq('id', poId)
    .single();
  if (poErr) throw poErr;

  const newReceived = Number(po.quantity_received) + quantityReceived;
  const isComplete = newReceived >= Number(po.quantity_requested);

  // Update PO
  await svc
    .from('warehouse_purchase_orders')
    .update({
      quantity_received: newReceived,
      received_date: new Date().toISOString().slice(0, 10),
      status: isComplete ? 'completed' : 'partial',
      notes: notes ? `${po.notes || ''}\n${notes}`.trim() : po.notes,
    })
    .eq('id', poId);

  // Record stock IN
  await recordStockIn(
    po.warehouse_product_id,
    batchId || null,
    quantityReceived,
    'purchase_order',
    String(poId),
    `PO #${poId} received: ${quantityReceived} units`,
  );

  return { po_id: poId, quantity_received: newReceived, status: isComplete ? 'completed' : 'partial' };
}

export async function getPurchaseOrders(filters?: {
  productId?: number;
  status?: string;
  limit?: number;
}) {
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_purchase_orders')
    .select(`
      *,
      warehouse_products!inner(name, category, entity)
    `);

  if (filters?.productId) query = query.eq('warehouse_product_id', filters.productId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query
    .order('po_date', { ascending: false })
    .limit(filters?.limit || 50);
  if (error) throw error;
  return data || [];
}

// ============================================================
// SCALEV PRODUCT MAPPING
// ============================================================

export async function getScalevMappings(filter?: 'all' | 'mapped' | 'unmapped' | 'ignored') {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_scalev_mapping')
    .select(`
      *,
      warehouse_products(id, name, category, entity, warehouse)
    `);

  if (filter === 'mapped') query = query.not('warehouse_product_id', 'is', null).eq('is_ignored', false);
  if (filter === 'unmapped') query = query.is('warehouse_product_id', null).eq('is_ignored', false);
  if (filter === 'ignored') query = query.eq('is_ignored', true);

  const { data, error } = await query.order('scalev_product_name');
  if (error) throw error;

  return (data || []).map(r => ({
    ...r,
    frequency: 0, // Frequency loaded separately via getScalevFrequencies()
  }));
}

export async function getScalevFrequencies(): Promise<Record<string, number>> {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  try {
    const { data } = await svc.rpc('warehouse_scalev_mapping_frequencies');
    const map: Record<string, number> = {};
    if (data) for (const r of data) map[r.product_name] = r.cnt;
    return map;
  } catch {
    return {};
  }
}

export async function getScalevPriceTiers(): Promise<Record<string, { price: number; count: number }[]>> {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  try {
    const { data } = await svc.rpc('warehouse_scalev_price_tiers');
    const map: Record<string, { price: number; count: number }[]> = {};
    if (data) {
      for (const r of data) {
        if (!map[r.product_name]) map[r.product_name] = [];
        map[r.product_name].push({ price: r.price_tier, count: r.cnt });
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function updateScalevMapping(
  id: number,
  warehouseProductId: number | null,
  multiplier?: number,
  isIgnored?: boolean,
  notes?: string,
) {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  const { data: beforeRow, error: beforeError } = await svc
    .from('warehouse_scalev_mapping')
    .select(`
      id,
      scalev_product_name,
      warehouse_product_id,
      deduct_qty_multiplier,
      is_ignored,
      notes,
      warehouse_products(id, name, entity, warehouse, category)
    `)
    .eq('id', id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!beforeRow) throw new Error('Mapping Scalev tidak ditemukan.');

  const update: Record<string, any> = {};
  if (warehouseProductId !== undefined) update.warehouse_product_id = warehouseProductId;
  if (multiplier !== undefined) update.deduct_qty_multiplier = multiplier;
  if (isIgnored !== undefined) update.is_ignored = isIgnored;
  if (notes !== undefined) update.notes = notes;

  const { error } = await svc
    .from('warehouse_scalev_mapping')
    .update(update)
    .eq('id', id);
  if (error) throw error;

  const { data: afterRow, error: afterError } = await svc
    .from('warehouse_scalev_mapping')
    .select(`
      id,
      scalev_product_name,
      warehouse_product_id,
      deduct_qty_multiplier,
      is_ignored,
      notes,
      warehouse_products(id, name, entity, warehouse, category)
    `)
    .eq('id', id)
    .maybeSingle();
  if (afterError) throw afterError;
  if (!afterRow) return;

  const beforeState = {
    scalev_product_name: beforeRow.scalev_product_name,
    warehouse_product_id: beforeRow.warehouse_product_id,
    warehouse_product_label: formatAuditWarehouseProductLabel(beforeRow.warehouse_products),
    deduct_qty_multiplier: beforeRow.deduct_qty_multiplier,
    is_ignored: Boolean(beforeRow.is_ignored),
    notes: beforeRow.notes || null,
  };
  const afterState = {
    scalev_product_name: afterRow.scalev_product_name,
    warehouse_product_id: afterRow.warehouse_product_id,
    warehouse_product_label: formatAuditWarehouseProductLabel(afterRow.warehouse_products),
    deduct_qty_multiplier: afterRow.deduct_qty_multiplier,
    is_ignored: Boolean(afterRow.is_ignored),
    notes: afterRow.notes || null,
  };
  const changedFields = getAuditChangedFields(beforeState, afterState, [
    'warehouse_product_id',
    'deduct_qty_multiplier',
    'is_ignored',
    'notes',
  ]);

  if (changedFields.length === 0) return;

  let action = 'update';
  let summary = `Memperbarui mapping ${afterRow.scalev_product_name}`;

  if (!beforeState.is_ignored && afterState.is_ignored) {
    action = 'ignore';
    summary = `Meng-ignore ${afterRow.scalev_product_name}`;
  } else if (beforeState.is_ignored && !afterState.is_ignored) {
    action = 'unignore';
    summary = `Membuka ignore ${afterRow.scalev_product_name}`;
  } else if (!beforeState.warehouse_product_id && afterState.warehouse_product_id) {
    action = 'map';
    summary = `Memetakan ${afterRow.scalev_product_name} ke ${afterState.warehouse_product_label}`;
  } else if (beforeState.warehouse_product_id && !afterState.warehouse_product_id) {
    action = 'unmap';
    summary = `Melepas mapping ${afterRow.scalev_product_name} dari ${beforeState.warehouse_product_label}`;
  } else if (
    beforeState.warehouse_product_id
    && afterState.warehouse_product_id
    && beforeState.warehouse_product_id !== afterState.warehouse_product_id
  ) {
    action = 'remap';
    summary = `Mengubah mapping ${afterRow.scalev_product_name} dari ${beforeState.warehouse_product_label} ke ${afterState.warehouse_product_label}`;
  } else if (!areAuditValuesEqual(beforeState.deduct_qty_multiplier, afterState.deduct_qty_multiplier)) {
    action = 'update_multiplier';
    summary = `Mengubah multiplier ${afterRow.scalev_product_name} menjadi ${afterState.deduct_qty_multiplier}`;
  } else if (!areAuditValuesEqual(beforeState.notes, afterState.notes)) {
    action = 'update_notes';
    summary = `Memperbarui catatan mapping ${afterRow.scalev_product_name}`;
  }

  await recordWarehouseActivityLog({
    scope: 'legacy_scalev_mapping',
    action,
    screen: 'Mapping Scalev',
    summary,
    targetType: 'scalev_product_name',
    targetId: String(afterRow.id),
    targetLabel: afterRow.scalev_product_name,
    changedFields,
    beforeState,
    afterState,
    context: {
      mapping_id: Number(afterRow.id),
      warehouse_product_before: beforeState.warehouse_product_label,
      warehouse_product_after: afterState.warehouse_product_label,
    },
  });
}

export async function syncScalevProductNames() {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  // Insert any new product_names not yet in mapping table
  const { error } = await svc.rpc('warehouse_sync_scalev_names');
  if (error) throw error;

  await recordWarehouseActivityLog({
    scope: 'legacy_scalev_mapping',
    action: 'sync_names',
    screen: 'Mapping Scalev',
    summary: 'Menjalankan sync nama produk Scalev ke mapping legacy',
    targetType: 'rpc',
    targetId: 'warehouse_sync_scalev_names',
    targetLabel: 'warehouse_sync_scalev_names',
  });
}

// ============================================================
// WAREHOUSE BUSINESS MAPPING
// ============================================================

type WarehouseBusinessMappingAuditRow = {
  id: number;
  business_code: string;
  deduct_entity: string;
  deduct_warehouse: string | null;
  is_active: boolean | null;
  is_primary: boolean | null;
  notes: string | null;
};

function normalizeWarehouseBusinessAuditRow(row: Partial<WarehouseBusinessMappingAuditRow> | null | undefined) {
  return {
    business_code: row?.business_code || null,
    deduct_entity: row?.deduct_entity || null,
    deduct_warehouse: row?.deduct_warehouse || null,
    is_active: Boolean(row?.is_active),
    is_primary: Boolean(row?.is_primary),
    notes: row?.notes || null,
  };
}

async function listWarehouseBusinessMappingsForCode(
  svc: ReturnType<typeof createServiceSupabase>,
  businessCode: string,
): Promise<WarehouseBusinessMappingAuditRow[]> {
  const { data, error } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('business_code', businessCode)
    .order('is_primary', { ascending: false })
    .order('is_active', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []) as WarehouseBusinessMappingAuditRow[];
}

async function ensurePrimaryWarehouseBusinessMapping(
  svc: ReturnType<typeof createServiceSupabase>,
  businessCode: string,
  preferredId?: number | null,
) {
  const rows = await listWarehouseBusinessMappingsForCode(svc, businessCode);
  const activeRows = rows.filter((row) => Boolean(row.is_active));

  if (activeRows.length === 0) {
    const primaryIds = rows.filter((row) => Boolean(row.is_primary)).map((row) => Number(row.id));
    if (primaryIds.length > 0) {
      const { error } = await svc
        .from('warehouse_business_mapping')
        .update({ is_primary: false })
        .in('id', primaryIds);
      if (error) throw error;
    }
    return null;
  }

  const preferredRow = preferredId
    ? activeRows.find((row) => Number(row.id) === Number(preferredId)) || null
    : null;
  const existingPrimary = activeRows.find((row) => Boolean(row.is_primary)) || null;
  const desiredPrimary = preferredRow || existingPrimary || activeRows[0];

  const idsToClear = rows
    .filter((row) => Number(row.id) !== Number(desiredPrimary.id) && Boolean(row.is_primary))
    .map((row) => Number(row.id));
  if (idsToClear.length > 0) {
    const { error } = await svc
      .from('warehouse_business_mapping')
      .update({ is_primary: false })
      .in('id', idsToClear);
    if (error) throw error;
  }

  if (!desiredPrimary.is_primary) {
    const { error } = await svc
      .from('warehouse_business_mapping')
      .update({ is_primary: true })
      .eq('id', desiredPrimary.id);
    if (error) throw error;
  }

  return desiredPrimary;
}

export async function getWarehouseBusinessMappings() {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_business_mapping')
    .select('*, scalev_webhook_businesses!inner(business_name)')
    .order('business_code', { ascending: true })
    .order('is_primary', { ascending: false })
    .order('is_active', { ascending: false })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateWarehouseBusinessMapping(id: number, field: string, value: any) {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const { data: beforeRow, error: beforeError } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!beforeRow) throw new Error('Business mapping tidak ditemukan.');

  const normalizedValue = field === 'deduct_warehouse'
    ? String(value || 'BTN').trim().toUpperCase() || 'BTN'
    : field === 'deduct_entity'
      ? String(value || '').trim().toUpperCase()
      : value;

  if (field === 'is_primary') {
    if (normalizedValue) {
      const existingPrimaryIds = (await listWarehouseBusinessMappingsForCode(svc, beforeRow.business_code))
        .filter((row) => Number(row.id) !== Number(id) && Boolean(row.is_primary))
        .map((row) => Number(row.id));
      if (existingPrimaryIds.length > 0) {
        const { error } = await svc
          .from('warehouse_business_mapping')
          .update({ is_primary: false })
          .in('id', existingPrimaryIds);
        if (error) throw error;
      }
      const { error } = await svc
        .from('warehouse_business_mapping')
        .update({ is_primary: true, is_active: true })
        .eq('id', id);
      if (error) throw error;
      await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code, id);
    } else {
      const { error } = await svc
        .from('warehouse_business_mapping')
        .update({ is_primary: false })
        .eq('id', id);
      if (error) throw error;
      await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code);
    }
  } else {
    const updatePayload: Record<string, any> = { [field]: normalizedValue };
    const { error } = await svc
      .from('warehouse_business_mapping')
      .update(updatePayload)
      .eq('id', id);
    if (error) throw error;

    if (field === 'is_active' && !normalizedValue && beforeRow.is_primary) {
      await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code);
    } else if (field === 'is_active' && normalizedValue) {
      await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code, beforeRow.is_primary ? id : null);
    } else if (field === 'deduct_entity' || field === 'deduct_warehouse') {
      await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code, beforeRow.is_primary ? id : null);
    }
  }

  const { data: afterRow, error: afterError } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('id', id)
    .maybeSingle();
  if (afterError) throw afterError;
  if (!afterRow) return;

  const beforeState = normalizeWarehouseBusinessAuditRow(beforeRow);
  const afterState = normalizeWarehouseBusinessAuditRow(afterRow);
  const changedFields = getAuditChangedFields(beforeState, afterState, [
    'deduct_entity',
    'deduct_warehouse',
    'is_active',
    'is_primary',
    'notes',
  ]);
  if (changedFields.length === 0) return;

  await recordWarehouseActivityLog({
    scope: 'warehouse_business_mapping',
    action: 'update',
    screen: 'Mapping Business Warehouse',
    summary: `Memperbarui mapping business ${afterRow.business_code}`,
    targetType: 'business_code',
    targetId: String(afterRow.id),
    targetLabel: afterRow.business_code,
    businessCode: afterRow.business_code,
    changedFields,
    beforeState,
    afterState,
    context: {
      updated_field: field,
    },
  });
}

export async function createWarehouseBusinessMapping(businessCode: string, deductEntity: string, deductWarehouse = 'BTN') {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const normalizedBusinessCode = String(businessCode || '').trim().toUpperCase();
  const normalizedEntity = String(deductEntity || '').trim().toUpperCase();
  const normalizedWarehouse = String(deductWarehouse || 'BTN').trim().toUpperCase() || 'BTN';

  if (!normalizedBusinessCode) {
    throw new Error('Business code tidak valid.');
  }
  if (!normalizedEntity) {
    throw new Error('Entity gudang tidak valid.');
  }

  const beforeRows = await listWarehouseBusinessMappingsForCode(svc, normalizedBusinessCode);
  const beforeRow = beforeRows.find((row) => (
    row.deduct_entity === normalizedEntity
    && normalizeBusinessTargetWarehouse(row.deduct_warehouse) === normalizedWarehouse
  )) || null;
  const shouldBecomePrimary = beforeRows.filter((row) => Boolean(row.is_active)).length === 0;

  const { error } = await svc
    .from('warehouse_business_mapping')
    .upsert({
      business_code: normalizedBusinessCode,
      deduct_entity: normalizedEntity,
      deduct_warehouse: normalizedWarehouse,
      is_active: true,
      is_primary: beforeRow ? beforeRow.is_primary : shouldBecomePrimary,
    }, { onConflict: 'business_code,deduct_entity,deduct_warehouse' });
  if (error) throw error;

  const { data: afterRow, error: afterError } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('business_code', normalizedBusinessCode)
    .eq('deduct_entity', normalizedEntity)
    .eq('deduct_warehouse', normalizedWarehouse)
    .maybeSingle();
  if (afterError) throw afterError;
  if (!afterRow) return;

  if (shouldBecomePrimary || beforeRow?.is_primary) {
    await ensurePrimaryWarehouseBusinessMapping(svc, normalizedBusinessCode, Number(afterRow.id));
  } else {
    await ensurePrimaryWarehouseBusinessMapping(svc, normalizedBusinessCode);
  }

  const { data: refreshedAfterRow, error: refreshedAfterError } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('id', afterRow.id)
    .maybeSingle();
  if (refreshedAfterError) throw refreshedAfterError;
  if (!refreshedAfterRow) return;

  await recordWarehouseActivityLog({
    scope: 'warehouse_business_mapping',
    action: beforeRow ? 'upsert' : 'create',
    screen: 'Mapping Business Warehouse',
    summary: beforeRow
      ? `Memastikan mapping business ${normalizedBusinessCode} tetap aktif`
      : `Menambahkan gudang ${normalizedEntity} • ${normalizedWarehouse} untuk business ${normalizedBusinessCode}`,
    targetType: 'business_code',
    targetId: String(refreshedAfterRow.id),
    targetLabel: normalizedBusinessCode,
    businessCode: normalizedBusinessCode,
    changedFields: beforeRow
      ? getAuditChangedFields(
          normalizeWarehouseBusinessAuditRow(beforeRow),
          normalizeWarehouseBusinessAuditRow(refreshedAfterRow),
          ['deduct_entity', 'deduct_warehouse', 'is_active', 'is_primary'],
        )
      : ['deduct_entity', 'deduct_warehouse', 'is_active', 'is_primary'],
    beforeState: normalizeWarehouseBusinessAuditRow(beforeRow),
    afterState: normalizeWarehouseBusinessAuditRow(refreshedAfterRow),
    context: {},
  });
}

export async function removeWarehouseBusinessMapping(id: number) {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();

  const { data: beforeRow, error: beforeError } = await svc
    .from('warehouse_business_mapping')
    .select('id, business_code, deduct_entity, deduct_warehouse, is_active, is_primary, notes')
    .eq('id', id)
    .maybeSingle();
  if (beforeError) throw beforeError;
  if (!beforeRow) throw new Error('Business mapping tidak ditemukan.');

  const { error } = await svc
    .from('warehouse_business_mapping')
    .delete()
    .eq('id', id);
  if (error) throw error;

  await ensurePrimaryWarehouseBusinessMapping(svc, beforeRow.business_code);

  await recordWarehouseActivityLog({
    scope: 'warehouse_business_mapping',
    action: 'delete',
    screen: 'Mapping Business Warehouse',
    summary: `Menghapus gudang ${beforeRow.deduct_entity} • ${normalizeBusinessTargetWarehouse(beforeRow.deduct_warehouse)} dari business ${beforeRow.business_code}`,
    targetType: 'business_code',
    targetId: String(beforeRow.id),
    targetLabel: beforeRow.business_code,
    businessCode: beforeRow.business_code,
    changedFields: ['deduct_entity', 'deduct_warehouse', 'is_active', 'is_primary'],
    beforeState: normalizeWarehouseBusinessAuditRow(beforeRow),
    afterState: null,
    context: {},
  });
}

// ── Backfill warehouse deductions for shipped orders missing deductions ──
export async function backfillWarehouseDeductions(date: string) {
  const svc = createServiceSupabase();
  const goLiveAt = await loadWarehouseGoLiveAt(svc);
  if (!isWarehouseGoLiveActive(goLiveAt) || isDateBeforeWarehouseGoLive(date, goLiveAt)) {
    return { checked: 0, deducted: 0, reversed: 0, skipped: 0 };
  }

  const isGoLiveDay = isWarehouseGoLiveDate(date, goLiveAt);
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  let orders: Array<{
    id: number;
    order_id: string;
    business_code: string | null;
    status?: string | null;
    shipped_time: string | null;
    completed_time?: string | null;
  }> = [];
  let usedBacklogQueue = false;

  // Prefer the backlog queue so repair only touches orders that are actually mismatched.
  const backlogLimit = 500;
  let backlogOffset = 0;
  const backlogOrderIds: string[] = [];
  if (!isGoLiveDay) {
    while (true) {
      const backlogResult = await svc.rpc('warehouse_daily_undeducted_orders', {
        p_date: date,
        p_limit: backlogLimit,
        p_offset: backlogOffset,
      });
      if (backlogResult.error && !isMissingRpcFunctionError(backlogResult.error, 'warehouse_daily_undeducted_orders')) {
        throw backlogResult.error;
      }
      if (backlogResult.error) break;
      if (!Array.isArray(backlogResult.data)) break;

      const page = (backlogResult.data || [])
        .map((row: any) => String(row.order_id || '').trim())
        .filter(Boolean);
      if (page.length === 0) {
        usedBacklogQueue = true;
        break;
      }

      backlogOrderIds.push(...page);
      usedBacklogQueue = true;
      const totalCount = Number((backlogResult.data || [])[0]?.total_count || 0);
      backlogOffset += page.length;
      if (backlogOffset >= totalCount) break;
    }
  }

  if (usedBacklogQueue) {
    const uniqueOrderIds = Array.from(new Set(backlogOrderIds));
    if (uniqueOrderIds.length === 0) {
      return { checked: 0, deducted: 0, reversed: 0, skipped: 0 };
    }

    for (let i = 0; i < uniqueOrderIds.length; i += 200) {
      const chunk = uniqueOrderIds.slice(i, i + 200);
      const { data: pageOrders, error: ordErr } = await svc
        .from('scalev_orders')
        .select('id, order_id, business_code, status, shipped_time, completed_time')
        .in('order_id', chunk)
        .in('status', ['shipped', 'completed']);
      if (ordErr) throw ordErr;
      orders.push(...((pageOrders || []) as any[]));
    }
  } else {
    if (isGoLiveDay) {
      orders = (await fetchScalevOrdersForDate(svc, date)) as any[];
    } else {
      // Fallback for older databases without the backlog RPC.
      const { data: allOrders, error: ordErr } = await svc
        .from('scalev_orders')
        .select('id, order_id, business_code, status, shipped_time, completed_time')
        .in('status', ['shipped', 'completed'])
        .gte('shipped_time', dayStart)
        .lt('shipped_time', dayEnd)
        .limit(5000);
      if (ordErr) throw ordErr;
      orders = (allOrders || []) as any[];
    }
  }

  if (isGoLiveDay) {
    orders = orders.filter((order) => isScalevOrderOnOrAfterWarehouseGoLive(order, goLiveAt));
  }

  if (!orders || orders.length === 0) return { checked: 0, deducted: 0, reversed: 0, skipped: 0 };

  let totalDeducted = 0;
  let totalSkipped = 0;
  let totalReversed = 0;
  let checked = 0;

  for (const order of orders) {
    checked++;

    const result = await reconcileScalevOrderWarehouse(order.order_id, order.id);
    totalDeducted += Number(result.deducted || 0);
    totalReversed += Number(result.reversed || 0);
    totalSkipped += Number(result.skipped || 0) + Number((result.unmapped_products || []).length);
  }

  return { checked, deducted: totalDeducted, reversed: totalReversed, skipped: totalSkipped };
}

// ── Get shipped orders that have NO warehouse deduction for a date ──
export async function getUndeductedOrders(
  date: string,
  options?: { limit?: number; offset?: number },
): Promise<WarehouseUndeductedOrdersResult> {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(options?.limit || 100), 1), 500);
  const offset = Math.max(Number(options?.offset || 0), 0);
  const emptyResult = { rows: [], totalCount: 0, limit, offset, hasMore: false };
  const goLiveAt = await loadWarehouseGoLiveAt(svc);
  if (!isWarehouseGoLiveActive(goLiveAt) || isDateBeforeWarehouseGoLive(date, goLiveAt)) {
    return emptyResult;
  }

  const isGoLiveDay = isWarehouseGoLiveDate(date, goLiveAt);

  if (!isGoLiveDay) {
    const rpcResult = await svc.rpc('warehouse_daily_undeducted_orders', {
      p_date: date,
      p_limit: limit,
      p_offset: offset,
    });
    if (rpcResult.error && !isMissingRpcFunctionError(rpcResult.error, 'warehouse_daily_undeducted_orders')) {
      throw rpcResult.error;
    }
    if (!rpcResult.error && Array.isArray(rpcResult.data)) {
      const rows = (rpcResult.data || []).map((row: any) => ({
        order_id: row.order_id,
        business_code: row.business_code || null,
        product_lines: normalizeWarehouseOrderLines(row.product_lines),
        problem: row.problem,
        problem_detail: row.problem_detail,
      })) as WarehouseUndeductedOrderIssue[];
      const totalCount = Number((rpcResult.data || [])[0]?.total_count || 0);
      return {
        rows,
        totalCount,
        limit,
        offset,
        hasMore: offset + rows.length < totalCount,
      };
    }
  }

  const orders = (await fetchScalevOrdersForDate(svc, date))
    .filter((order) => !isGoLiveDay || isScalevOrderOnOrAfterWarehouseGoLive(order, goLiveAt));
  if (orders.length === 0) {
    return emptyResult;
  }

  const outstandingByOrder = await fetchOutstandingLedgerByOrderProduct(svc, orders);

  const results: WarehouseUndeductedOrderIssue[] = [];

  for (const order of orders) {
    const resolved = await resolveWarehouseTargetsForOrder(svc, order);
    const outstanding = outstandingByOrder.get(order.order_id) || new Map<number, number>();
    const hasIssue = resolved.productLines.length === 0
      || resolved.unmappedProducts.length > 0
      || !mapsEqualWithTolerance(outstanding, resolved.desiredByProduct);
    if (!hasIssue) continue;

    const issue = buildWarehouseIssueSummaryFromState({
      orderId: order.order_id,
      businessCode: order.seller_business_code || order.business_code,
      productLines: resolved.productLines,
      unmappedProducts: resolved.unmappedProducts,
      mapping: resolved.mapping,
      allowedMappings: resolved.allowedMappings,
    });

    results.push({
      order_id: order.order_id,
      business_code: order.seller_business_code || order.business_code,
      product_lines: resolved.productLines,
      problem: issue.problem,
      problem_detail: issue.problem_detail,
    });
  }

  const problemRank: Record<string, number> = {
    no_business_mapping: 1,
    no_product_mapping: 2,
    no_order_lines: 3,
    unknown: 4,
  };

  results.sort((a, b) => {
    const rankDiff = (problemRank[a.problem] || 99) - (problemRank[b.problem] || 99);
    if (rankDiff !== 0) return rankDiff;
    return b.order_id.localeCompare(a.order_id);
  });

  const rows = results.slice(offset, offset + limit);
  return {
    rows,
    totalCount: results.length,
    limit,
    offset,
    hasMore: offset + rows.length < results.length,
  };
}

// ── Backfill a single order's warehouse deduction ──
export async function backfillSingleOrder(orderId: string) {
  await requireWarehousePermission('wh:mapping_sync', 'Sync Deduction Gudang');
  const svc = createServiceSupabase();

  // Get order
  const { data: order, error: ordErr } = await svc
    .from('scalev_orders')
    .select(`
      id,
      order_id,
      business_code,
      business_name_raw,
      origin_business_name_raw,
      origin_raw,
      seller_business_code,
      origin_operator_business_code,
      origin_registry_id,
      status,
      shipped_time,
      completed_time
    `)
    .eq('order_id', orderId)
    .single();
  if (ordErr || !order) throw new Error(`Order ${orderId} tidak ditemukan`);
  const result = await reconcileScalevOrderWarehouse(order.order_id, order.id);
  return {
    deducted: Number(result.deducted || 0),
    reversed: Number(result.reversed || 0),
    skipped: Number(result.skipped || 0) + Number((result.unmapped_products || []).length),
    action: result.action,
    ...(('problem' in result && result.problem) ? { problem: result.problem, problem_detail: result.problem_detail } : {}),
  };
}

// ── Get deduction log for a date (side-by-side scalev vs warehouse product) ──
export async function getDeductionLog(date: string) {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const rpcResult = await svc.rpc('warehouse_daily_deduction_summary', { p_date: date });
  if (rpcResult.error && !isMissingRpcFunctionError(rpcResult.error, 'warehouse_daily_deduction_summary')) {
    throw rpcResult.error;
  }
  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    const rows = (rpcResult.data || []).map((row: any) => ({
      scalev_product: row.scalev_product,
      warehouse_product: row.warehouse_product,
      entity: row.entity,
      total_qty: Number(row.total_qty || 0),
      order_count: Number(row.order_count || 0),
      business_codes: row.business_codes || '',
    }));
    return {
      rows,
      totalUniqueOrders: Number((rpcResult.data || [])[0]?.total_unique_orders || 0),
    };
  }

  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  // Paginate to avoid Supabase max_rows limit (default 1000)
  const allData: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let includeScalevOrderId = true;
  while (true) {
    const selectFields = includeScalevOrderId
      ? `
        scalev_order_id,
        reference_id,
        quantity,
        notes,
        created_at,
        warehouse_products!inner(name, entity)
      `
      : `
        reference_id,
        quantity,
        notes,
        created_at,
        warehouse_products!inner(name, entity)
      `;

    const { data: page, error: pgErr } = await svc
      .from('warehouse_stock_ledger')
      .select(selectFields)
      .eq('reference_type', 'scalev_order')
      .eq('movement_type', 'OUT')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (pgErr && includeScalevOrderId && isMissingScalevOrderIdColumnError(pgErr)) {
      includeScalevOrderId = false;
      offset = 0;
      allData.length = 0;
      continue;
    }
    if (pgErr) throw pgErr;
    if (!page || page.length === 0) break;
    allData.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  const data = allData;

  if (data.length === 0) return { rows: [], totalUniqueOrders: 0 };

  // Get business_code for each order
  const orderIds = Array.from(new Set(data.map(d => d.reference_id)));
  const orderDbIds = includeScalevOrderId
    ? Array.from(new Set(data.map(d => d.scalev_order_id).filter((id): id is number => typeof id === 'number')))
    : [];
  const bizByOrderId = new Map<string, string>();
  const bizByDbId = new Map<number, string>();

  for (let i = 0; i < orderDbIds.length; i += 200) {
    const chunk = orderDbIds.slice(i, i + 200);
    const { data: orders } = await svc
      .from('scalev_orders')
      .select('id, business_code')
      .in('id', chunk);
    (orders || []).forEach(o => bizByDbId.set(o.id, o.business_code));
  }

  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data: orders } = await svc
      .from('scalev_orders')
      .select('order_id, business_code')
      .in('order_id', chunk);
    (orders || []).forEach(o => bizByOrderId.set(o.order_id, o.business_code));
  }

  // Aggregate by scalev_product + warehouse_product + entity
  const grouped = new Map<string, {
    scalev_product: string; warehouse_product: string; entity: string;
    total_qty: number; order_count: number;
    order_ids: Set<string>; business_codes: Set<string>;
  }>();
  const allOrderIds = new Set<string>();

  for (const d of data) {
    const notesMatch = (d.notes || '').match(/(?:Auto|Backfill|Auto-deduct): (.+?) x[\d.]+/);
    const wp = d.warehouse_products as any;
    const scalevProduct = notesMatch ? notesMatch[1] : d.notes || '-';
    const warehouseProduct = wp?.name || '-';
    const entity = wp?.entity || '-';
    const key = `${scalevProduct}||${warehouseProduct}||${entity}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        scalev_product: scalevProduct,
        warehouse_product: warehouseProduct,
        entity,
        total_qty: 0,
        order_count: 0,
        order_ids: new Set(),
        business_codes: new Set(),
      });
    }
    const row = grouped.get(key)!;
    row.total_qty += Math.abs(Number(d.quantity));
    row.order_ids.add(d.reference_id);
    allOrderIds.add(d.reference_id);
    const biz = includeScalevOrderId && typeof d.scalev_order_id === 'number'
      ? bizByDbId.get(d.scalev_order_id) || bizByOrderId.get(d.reference_id)
      : bizByOrderId.get(d.reference_id);
    if (biz) row.business_codes.add(biz);
  }

  const rows = Array.from(grouped.values())
    .map(g => ({
      scalev_product: g.scalev_product,
      warehouse_product: g.warehouse_product,
      entity: g.entity,
      total_qty: g.total_qty,
      order_count: g.order_ids.size,
      business_codes: Array.from(g.business_codes).join(', '),
    }))
    .sort((a, b) => b.total_qty - a.total_qty);

  return { rows, totalUniqueOrders: allOrderIds.size };
}

// ============================================================
// VENDORS
// ============================================================

export async function getVendors() {
  await requireVendorReadAccess('Vendor Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_vendors')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createVendor(vendor: { name: string; address?: string; phone?: string; pic_name?: string; notes?: string; is_pkp?: boolean }) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_vendors')
    .insert(vendor)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id: number, updates: Record<string, any>) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_vendors')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteVendor(id: number) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_vendors')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// STOCK OPNAME — session-based workflow
// ============================================================

export async function getActiveSOSession() {
  await requireWarehouseAccess('Stock Opname');
  const svc = createServiceSupabase();
  return getLatestUsableActiveSOSession(svc);
}

export async function getSOSessionItems(sessionId: number) {
  await requireWarehouseAccess('Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_opname')
    .select('*')
    .eq('session_id', sessionId)
    .order('product_name');
  if (error) throw error;
  return data || [];
}

async function getSOSessionItemCount(
  svc: ReturnType<typeof createServiceSupabase>,
  sessionId: number,
) {
  const { count, error } = await svc
    .from('warehouse_stock_opname')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw error;
  return count || 0;
}

async function deleteEmptySOSession(
  svc: ReturnType<typeof createServiceSupabase>,
  sessionId: number,
) {
  const { error: deleteRowsErr } = await svc
    .from('warehouse_stock_opname')
    .delete()
    .eq('session_id', sessionId);
  if (deleteRowsErr) throw deleteRowsErr;

  const { error: deleteSessionErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .delete()
    .eq('id', sessionId)
    .in('status', ['counting', 'reviewing']);
  if (deleteSessionErr) throw deleteSessionErr;
}

async function getLatestUsableActiveSOSession(
  svc: ReturnType<typeof createServiceSupabase>,
) {
  const { data: sessions, error } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('*')
    .in('status', ['counting', 'reviewing'])
    .order('created_at', { ascending: false });
  if (error) throw error;

  for (const session of (sessions || [])) {
    const itemCount = await getSOSessionItemCount(svc, Number(session.id));
    if (itemCount > 0) return session;
    await deleteEmptySOSession(svc, Number(session.id));
  }

  return null;
}

export async function createStockOpnameSession(
  entity: string,
  warehouse: string,
  label: string,
  date: string,
) : Promise<WarehouseMutationResult<{ id: number }>> {
  let sessionId: number | null = null;
  try {
    await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
    const svc = createServiceSupabase();
    const userId = await getCurrentUserId();

    const existingSession = await getLatestUsableActiveSOSession(svc);
    if (existingSession) {
      throw new Error(`Masih ada stock opname aktif (${existingSession.opname_label} - ${existingSession.entity} ${existingSession.opname_date})`);
    }

    // Create session
    const { data: session, error: sessErr } = await svc
      .from('warehouse_stock_opname_sessions')
      .insert({ entity, warehouse, opname_date: date, opname_label: label, created_by: userId })
      .select('id')
      .single();
    if (sessErr) throw sessErr;
    sessionId = Number(session.id);

    // Get all active products for this entity + warehouse
    const { data: products, error: prodErr } = await svc
      .from('warehouse_products')
      .select('id, name, category')
      .eq('entity', entity)
      .eq('warehouse', warehouse)
      .eq('is_active', true)
      .order('category')
      .order('name');
    if (prodErr) throw prodErr;
    if (!products || products.length === 0) {
      throw new Error(`Belum ada produk aktif untuk ${entity}-${warehouse}, jadi SO tidak bisa dibuat.`);
    }

    // Get current stock balances
    const { data: balances, error: balErr } = await svc
      .from('v_warehouse_stock_balance')
      .select('product_id, current_stock')
      .eq('entity', entity)
      .eq('warehouse', warehouse);
    if (balErr) throw balErr;

    const balMap: Record<number, number> = {};
    (balances || []).forEach((b: any) => { balMap[b.product_id] = Number(b.current_stock) || 0; });

    // Pre-populate opname rows (blind count — sesudah_so starts null)
    const rows = (products || []).map(p => ({
      session_id: sessionId,
      warehouse: warehouse,
      opname_date: date,
      opname_label: label,
      product_name: p.name,
      category: p.category,
      warehouse_product_id: p.id,
      sebelum_so: balMap[p.id] || 0,
      sesudah_so: null,
      selisih: 0,
      is_skipped: false,
    }));

    const { error: insErr } = await svc.from('warehouse_stock_opname').insert(rows);
    if (insErr) throw insErr;

    return { success: true, data: { id: sessionId } };
  } catch (error) {
    if (sessionId != null) {
      try {
        const svc = createServiceSupabase();
        await deleteEmptySOSession(svc, sessionId);
      } catch {}
    }

    const rawMessage = getWarehouseMutationErrorMessage(error, 'Gagal membuat sesi stock opname.');
    if (isUniqueViolation(error) && rawMessage.includes('warehouse_stock_opname_warehouse_opname_date_opname_label')) {
      return {
        success: false,
        error: 'Schema database SO masih memakai unique key lama. Jalankan migration/session uniqueness terbaru dulu, lalu coba buat SO lagi.',
      };
    }

    return {
      success: false,
      error: rawMessage,
    };
  }
}

export async function saveStockOpnameCounts(
  sessionId: number,
  counts: { id: number; sesudah_so: number | null; sebelum_so: number; is_skipped?: boolean }[],
) : Promise<WarehouseMutationResult> {
  try {
    await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
    const svc = createServiceSupabase();

    const { data: session, error: sessionErr } = await svc
      .from('warehouse_stock_opname_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session || session.status !== 'counting') {
      throw new Error('Stock opname ini tidak sedang dalam fase hitung');
    }

    for (const c of counts) {
      if (!c.is_skipped && c.sesudah_so != null && (!Number.isFinite(c.sesudah_so) || c.sesudah_so < 0)) {
        throw new Error('Stok fisik harus berupa angka 0 atau lebih besar.');
      }
      if (!Number.isFinite(c.sebelum_so)) {
        throw new Error('Saldo sistem untuk stock opname tidak valid. Silakan reload halaman lalu coba lagi.');
      }
    }

    for (const c of counts) {
      const isSkipped = Boolean(c.is_skipped);
      const sesudahSo = isSkipped ? null : c.sesudah_so;
      const selisih = !isSkipped && sesudahSo != null ? sesudahSo - c.sebelum_so : 0;
      const { error } = await svc
        .from('warehouse_stock_opname')
        .update({ sesudah_so: sesudahSo, selisih, is_skipped: isSkipped })
        .eq('id', c.id)
        .eq('session_id', sessionId);
      if (error) throw error;
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal menyimpan hasil stock opname.'),
    };
  }
}

export async function submitSOForReview(sessionId: number): Promise<WarehouseMutationResult> {
  try {
    await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
    const svc = createServiceSupabase();

    const { data: session, error: sessionErr } = await svc
      .from('warehouse_stock_opname_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session || session.status !== 'counting') {
      throw new Error('Stock opname ini tidak sedang dalam fase hitung');
    }

    const { count: incompleteCount, error: incompleteErr } = await svc
      .from('warehouse_stock_opname')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('is_skipped', false)
      .is('sesudah_so', null);
    if (incompleteErr) throw incompleteErr;
    if ((incompleteCount || 0) > 0) {
      throw new Error('Masih ada item yang belum diisi stok fisiknya.');
    }

    const { error } = await svc
      .from('warehouse_stock_opname_sessions')
      .update({ status: 'reviewing' })
      .eq('id', sessionId)
      .eq('status', 'counting');
    if (error) throw error;

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal submit stock opname untuk direview.'),
    };
  }
}

export async function revertSOToCounting(sessionId: number): Promise<WarehouseMutationResult> {
  try {
    await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
    const svc = createServiceSupabase();
    const { error } = await svc
      .from('warehouse_stock_opname_sessions')
      .update({ status: 'counting' })
      .eq('id', sessionId)
      .eq('status', 'reviewing');
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal mengembalikan stock opname ke fase hitung.'),
    };
  }
}

export async function approveStockOpname(sessionId: number): Promise<WarehouseMutationResult<{ adjustedCount: number }>> {
  try {
    await requireWarehousePermission('wh:opname_approve', 'Approve Stock Opname');
    const svc = createServiceSupabase();

    const { data: session, error: sessionErr } = await svc
      .from('warehouse_stock_opname_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session || session.status !== 'reviewing') {
      throw new Error('Stock opname ini tidak siap di-approve');
    }

    const { count: incompleteCount, error: incompleteErr } = await svc
      .from('warehouse_stock_opname')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('is_skipped', false)
      .is('sesudah_so', null);
    if (incompleteErr) throw incompleteErr;
    if ((incompleteCount || 0) > 0) {
      throw new Error('Masih ada item stock opname yang belum dihitung');
    }

    const { data: existingAdjustments, error: adjustmentErr } = await svc
      .from('warehouse_stock_ledger')
      .select('id')
      .eq('reference_type', 'opname')
      .like('notes', `[SO#${sessionId}]%`)
      .limit(1);
    if (adjustmentErr) throw adjustmentErr;
    if (existingAdjustments && existingAdjustments.length > 0) {
      throw new Error('Stock opname ini sudah pernah di-adjust');
    }

    // Get all items with variance
    const { data: items, error: itemErr } = await svc
      .from('warehouse_stock_opname')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_skipped', false)
      .neq('selisih', 0);
    if (itemErr) throw itemErr;

    // Create ADJUST entries for each variance
    for (const item of (items || [])) {
      if (!item.warehouse_product_id || item.selisih === 0) continue;
      await recordStockOpnameAdjustInternal(svc, item, sessionId);
    }

    // Mark session completed
    const { error } = await svc
      .from('warehouse_stock_opname_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('status', 'reviewing');
    if (error) throw error;

    return { success: true, data: { adjustedCount: (items || []).length } };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal approve stock opname.'),
    };
  }
}

export async function cancelSOSession(sessionId: number): Promise<WarehouseMutationResult> {
  try {
    await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
    const svc = createServiceSupabase();
    const { error } = await svc
      .from('warehouse_stock_opname_sessions')
      .update({ status: 'canceled' })
      .eq('id', sessionId)
      .eq('status', 'counting');
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: getWarehouseMutationErrorMessage(error, 'Gagal membatalkan stock opname.'),
    };
  }
}
