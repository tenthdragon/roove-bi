'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import { recordWarehouseActivityLog } from '@/lib/warehouse-activity-log-actions';

const SCALEV_BASE_URL = 'https://api.scalev.id/v2';
const SUPABASE_PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 200;
const BUNDLE_DETAIL_CONCURRENCY = 3;
const BUNDLE_SYNC_BATCH_SIZE = 80;
const SCALEV_FETCH_MAX_RETRIES = 4;
const SCALEV_FETCH_RETRY_BASE_DELAY_MS = 900;

type WarehouseProductLite = {
  id: number;
  name: string;
  category: string | null;
  entity: string | null;
  warehouse: string | null;
};

type BusinessTarget = {
  deduct_entity: string | null;
  deduct_warehouse: string | null;
  is_active: boolean;
  notes: string | null;
};

type ScalevBusinessConfig = {
  id: number;
  business_code: string;
  business_name: string;
  api_key: string | null;
};

type ScalevBundleVariantApi = {
  id?: number | null;
  product_id?: number | null;
  unique_id?: string | null;
  uuid?: string | null;
  sku?: string | null;
  name?: string | null;
  display?: string | null;
  product_name?: string | null;
  item_type?: string | null;
  product?: {
    id?: number | null;
    name?: string | null;
  } | null;
};

type ScalevBundleLineApi = {
  id?: number | null;
  quantity?: number | string | null;
  variant?: ScalevBundleVariantApi | null;
};

type ScalevBundleDetailApi = {
  id: number;
  name?: string | null;
  public_name?: string | null;
  display?: string | null;
  custom_id?: string | null;
  bundlelines?: ScalevBundleLineApi[] | null;
};

type BundleComponentRow = {
  bundle_line_key: string;
  quantity: number;
  scalev_variant_id: number | null;
  scalev_product_id: number | null;
  scalev_variant_unique_id: string | null;
  scalev_variant_sku: string | null;
  label: string;
  secondary_label: string | null;
  resolved_warehouse_product_id: number | null;
  resolved_warehouse_product: WarehouseProductLite | null;
  resolution_source: 'variant' | 'product' | null;
};

export type ScalevBundleMappingRow = {
  bundle_id: number;
  entity_key: string;
  label: string;
  secondary_label: string | null;
  custom_id: string | null;
  identifiers_count: number;
  identifiers_preview: string[];
  components_count: number;
  resolved_components_count: number;
  unresolved_components_count: number;
  status: 'resolved' | 'partial' | 'unresolved' | 'missing-lines';
  components: BundleComponentRow[];
};

export type ScalevBundleMappingPayload = {
  business_id: number;
  business_code: string;
  business_target: BusinessTarget | null;
  bundle_lines_count: number;
  bundle_lines_last_synced_at: string | null;
  schema_message: string | null;
  rows: ScalevBundleMappingRow[];
};

function cleanString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeIdentifier(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseNumeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getMissingBundleSchemaMessage() {
  return 'Tabel bundle composition Scalev belum tersedia. Jalankan migration 108 terlebih dahulu.';
}

function getMissingCatalogSchemaMessage() {
  return 'Katalog Scalev belum tersedia. Jalankan sync Katalog Scalev terlebih dahulu.';
}

function getMissingProductMappingSchemaMessage() {
  return 'Tabel product mapping Scalev belum terlihat oleh API Supabase. Jalankan migration 107 atau refresh schema cache bila perlu.';
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchAllPagesSafe<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<{ data: T[] | null; error: any }> {
  try {
    const data = await fetchAllPages(fetchPage);
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
}

async function requireScalevBundleMappingAccess(label = 'Bundle Mapping Scalev') {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:mapping', label);
}

async function getBusinessById(businessId: number): Promise<ScalevBusinessConfig> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, api_key')
    .eq('id', businessId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error('Business Scalev tidak ditemukan.');
  }

  return data as ScalevBusinessConfig;
}

async function assertBundleLineSchemaReady() {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_catalog_bundle_lines')
    .select('id')
    .limit(1);

  if (!error) return;
  if (isMissingTableError(error)) {
    throw new Error(getMissingBundleSchemaMessage());
  }
  throw error;
}

async function fetchScalevBundleDetail(
  apiKey: string,
  bundleId: number,
): Promise<ScalevBundleDetailApi> {
  const response = await fetch(`${SCALEV_BASE_URL}/bundles/${bundleId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(
      `Scalev API error ${response.status} untuk bundle ${bundleId}${body ? `: ${body.slice(0, 160)}` : ''}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  if (json.code !== 200 || !json.data) {
    throw new Error(`Scalev API mengembalikan bundle ${bundleId} tanpa data yang valid.`);
  }

  return json.data as ScalevBundleDetailApi;
}

async function fetchScalevBundleDetailWithRetry(
  apiKey: string,
  bundleId: number,
): Promise<ScalevBundleDetailApi> {
  let lastError: any = null;

  for (let attempt = 0; attempt < SCALEV_FETCH_MAX_RETRIES; attempt += 1) {
    try {
      return await fetchScalevBundleDetail(apiKey, bundleId);
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === SCALEV_FETCH_MAX_RETRIES - 1) {
        throw error;
      }

      await sleep(SCALEV_FETCH_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error(`Gagal mengambil detail bundle ${bundleId}.`);
}

async function replaceBundleLinesForBundles(
  businessId: number,
  bundleIds: number[],
  rows: Record<string, any>[],
) {
  if (bundleIds.length === 0) return;

  const svc = createServiceSupabase();
  const { error: deleteError } = await svc
    .from('scalev_catalog_bundle_lines')
    .delete()
    .eq('business_id', businessId)
    .in('scalev_bundle_id', bundleIds);
  if (deleteError) throw deleteError;

  if (rows.length === 0) return;

  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await svc
      .from('scalev_catalog_bundle_lines')
      .insert(chunk);
    if (error) throw error;
  }
}

function buildBundleLineRows(
  business: ScalevBusinessConfig,
  details: ScalevBundleDetailApi[],
  syncAt: string,
) {
  const rows: Record<string, any>[] = [];

  for (const detail of details) {
    const bundleName = cleanString(detail.display) || cleanString(detail.public_name) || cleanString(detail.name) || `Bundle ${detail.id}`;
    const bundleLines = Array.isArray(detail.bundlelines) ? detail.bundlelines : [];
    for (let index = 0; index < bundleLines.length; index += 1) {
      const line = bundleLines[index];
      const variant = line.variant || {};
      const lineQuantity = parseNumeric(line.quantity, 1);
      const lineId = Number(line.id || 0);
      const variantId = Number(variant.id || 0);
      const productId = Number(variant.product_id || variant.product?.id || 0);
      const lineKey = lineId > 0
        ? `line:${lineId}`
        : variantId > 0
          ? `variant:${variantId}`
          : `position:${index}`;

      rows.push({
        business_id: business.id,
        business_code: business.business_code,
        scalev_bundle_id: Number(detail.id),
        scalev_bundle_name: bundleName,
        scalev_bundle_line_id: lineId > 0 ? lineId : null,
        scalev_bundle_line_key: lineKey,
        line_position: index,
        quantity: lineQuantity > 0 ? lineQuantity : 1,
        scalev_product_id: productId > 0 ? productId : null,
        scalev_variant_id: variantId > 0 ? variantId : null,
        scalev_variant_unique_id: cleanString(variant.unique_id),
        scalev_variant_uuid: cleanString(variant.uuid),
        scalev_variant_sku: cleanString(variant.sku),
        scalev_variant_name: cleanString(variant.display) || cleanString(variant.name),
        scalev_variant_product_name: cleanString(variant.product_name) || cleanString(variant.product?.name),
        variant_item_type: cleanString(variant.item_type),
        last_synced_at: syncAt,
      });
    }
  }

  return rows;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  const errors: Array<{ item: T; message: string }> = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length || 1) }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= items.length) return;

      const item = items[currentIndex];
      try {
        results.push(await worker(item));
      } catch (error: any) {
        errors.push({
          item,
          message: error?.message || 'Unknown error',
        });
      }
    }
  });

  await Promise.all(runners);
  return { results, errors };
}

export async function syncScalevCatalogBundleLines(
  businessId: number,
  options?: {
    offset?: number;
    limit?: number;
  },
) {
  await requireScalevBundleMappingAccess();
  await assertBundleLineSchemaReady();

  const business = await getBusinessById(businessId);
  if (!business.api_key) {
    throw new Error(`Business ${business.business_code} belum punya API key.`);
  }

  const svc = createServiceSupabase();
  const offset = Math.max(Number(options?.offset || 0), 0);
  const limit = Math.min(Math.max(Number(options?.limit || BUNDLE_SYNC_BATCH_SIZE), 1), 200);

  let bundles: Array<{ scalev_bundle_id: number | null }> = [];
  let totalBundles = 0;
  try {
    const { data, error, count } = await svc
      .from('scalev_catalog_bundles')
      .select('scalev_bundle_id', { count: 'exact' })
      .eq('business_id', businessId)
      .order('scalev_bundle_id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    bundles = Array.isArray(data) ? data : [];
    totalBundles = Number(count || 0);
  } catch (bundleError: any) {
    if (isMissingTableError(bundleError)) {
      throw new Error(getMissingCatalogSchemaMessage());
    }
    throw bundleError;
  }

  const bundleIds = Array.from(
    new Set(
      (bundles || [])
        .map((row: any) => Number(row.scalev_bundle_id || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );

  if (bundleIds.length === 0) {
    await recordWarehouseActivityLog({
      scope: 'scalev_bundle_sync',
      action: 'sync_success',
      screen: 'Bundle Mapping Scalev',
      summary: offset === 0
        ? `Sync isi bundle ${business.business_code} selesai tanpa bundle aktif`
        : `Batch sync isi bundle ${business.business_code} selesai`,
      targetType: 'business',
      targetId: String(business.id),
      targetLabel: `${business.business_code} • ${business.business_name}`,
      businessCode: business.business_code,
      changedFields: ['bundles_scanned', 'bundle_lines_count', 'failed_count', 'offset', 'limit'],
      beforeState: {},
      afterState: {
        bundles_scanned: 0,
        bundle_lines_count: 0,
        failed_count: 0,
        offset,
        limit,
      },
      context: {},
    });
    return {
      success: true,
      business_id: business.id,
      business_code: business.business_code,
      business_name: business.business_name,
      total_bundles: totalBundles,
      offset,
      next_offset: offset,
      completed: offset >= totalBundles,
      bundles_scanned: 0,
      bundle_lines_count: 0,
      failed_count: 0,
    };
  }

  const syncAt = new Date().toISOString();
  const { results, errors } = await mapWithConcurrency(
    bundleIds,
    BUNDLE_DETAIL_CONCURRENCY,
    async (bundleId) => fetchScalevBundleDetailWithRetry(business.api_key!, bundleId),
  );

  const rows = buildBundleLineRows(business, results, syncAt);
  await replaceBundleLinesForBundles(businessId, bundleIds, rows);

  const nextOffset = offset + bundleIds.length;
  const completed = nextOffset >= totalBundles;

  await recordWarehouseActivityLog({
    scope: 'scalev_bundle_sync',
    action: errors.length === 0 ? 'sync_success' : 'sync_partial',
    screen: 'Bundle Mapping Scalev',
    summary: errors.length === 0
      ? `Batch sync isi bundle ${business.business_code} berhasil`
      : `Batch sync isi bundle ${business.business_code} selesai dengan ${errors.length} gagal`,
    targetType: 'business',
    targetId: String(business.id),
    targetLabel: `${business.business_code} • ${business.business_name}`,
    businessCode: business.business_code,
    changedFields: ['bundles_scanned', 'bundle_lines_count', 'failed_count', 'last_synced_at', 'offset', 'limit', 'completed'],
    beforeState: {},
    afterState: {
      bundles_scanned: bundleIds.length,
      bundle_lines_count: rows.length,
      failed_count: errors.length,
      last_synced_at: syncAt,
      offset,
      limit,
      completed,
    },
    context: {
      total_bundles: totalBundles,
      next_offset: nextOffset,
      failed_bundle_ids: errors.slice(0, 20).map(({ item }) => item),
    },
  });

  return {
    success: errors.length === 0,
    business_id: business.id,
    business_code: business.business_code,
    business_name: business.business_name,
    total_bundles: totalBundles,
    offset,
    next_offset: nextOffset,
    completed,
    bundles_scanned: bundleIds.length,
    bundle_lines_count: rows.length,
    failed_count: errors.length,
    failed_bundle_ids: errors.slice(0, 10).map(({ item }) => item),
    last_synced_at: syncAt,
  };
}

export async function getScalevCatalogBundleMappings(businessId: number): Promise<ScalevBundleMappingPayload> {
  await requireScalevBundleMappingAccess();

  const svc = createServiceSupabase();
  const { data: businessRow, error: businessError } = await svc
    .from('scalev_webhook_businesses')
    .select('business_code')
    .eq('id', businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  const businessCode = businessRow?.business_code || '';

  let schemaMessage: string | null = null;
  const [
    { data: bundles, error: bundleError },
    { data: bundleLines, error: bundleLineError },
    { data: identifiers, error: identifierError },
    { data: mappings, error: mappingError },
    { data: businessTargetRow, error: targetError },
  ] = await Promise.all([
    fetchAllPagesSafe<any>((from, to) => (
      svc
        .from('scalev_catalog_bundles')
        .select('business_id, business_code, scalev_bundle_id, name, public_name, display, custom_id')
        .eq('business_id', businessId)
        .order('name', { ascending: true })
        .order('scalev_bundle_id', { ascending: true })
        .range(from, to)
    )),
    fetchAllPagesSafe<any>((from, to) => (
      svc
        .from('scalev_catalog_bundle_lines')
        .select(`
          business_id,
          scalev_bundle_id,
          scalev_bundle_name,
          scalev_bundle_line_key,
          line_position,
          quantity,
          scalev_product_id,
          scalev_variant_id,
          scalev_variant_unique_id,
          scalev_variant_sku,
          scalev_variant_name,
          scalev_variant_product_name,
          last_synced_at
        `)
        .eq('business_id', businessId)
        .order('scalev_bundle_id', { ascending: true })
        .order('line_position', { ascending: true })
        .order('scalev_bundle_line_key', { ascending: true })
        .range(from, to)
    )),
    fetchAllPagesSafe<any>((from, to) => (
      svc
        .from('scalev_catalog_identifiers')
        .select('entity_key, identifier')
        .eq('business_id', businessId)
        .eq('entity_type', 'bundle')
        .order('entity_key', { ascending: true })
        .order('identifier', { ascending: true })
        .range(from, to)
    )),
    fetchAllPagesSafe<any>((from, to) => (
      svc
        .from('warehouse_scalev_catalog_mapping')
        .select(`
          scalev_entity_key,
          warehouse_product_id,
          scalev_entity_type,
          warehouse_products(id, name, category, entity, warehouse)
        `)
        .eq('business_id', businessId)
        .not('warehouse_product_id', 'is', null)
        .order('scalev_entity_key', { ascending: true })
        .range(from, to)
    )),
    businessCode
      ? svc
          .from('warehouse_business_mapping')
          .select('deduct_entity, deduct_warehouse, is_active, notes')
          .eq('business_code', businessCode)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (bundleError) {
    if (isMissingTableError(bundleError)) {
      throw new Error(getMissingCatalogSchemaMessage());
    }
    throw bundleError;
  }
  if (bundleLineError) {
    if (isMissingTableError(bundleLineError)) {
      schemaMessage = getMissingBundleSchemaMessage();
    } else {
      throw bundleLineError;
    }
  }
  if (identifierError) throw identifierError;
  if (mappingError) {
    if (isMissingTableError(mappingError)) {
      schemaMessage = schemaMessage
        ? `${schemaMessage} Product mapping juga belum terlihat oleh API Supabase.`
        : getMissingProductMappingSchemaMessage();
    } else {
      throw mappingError;
    }
  }
  if (targetError) throw targetError;

  const businessTarget: BusinessTarget | null = businessTargetRow
    ? {
        deduct_entity: businessTargetRow.deduct_entity || null,
        deduct_warehouse: businessTargetRow.deduct_warehouse || null,
        is_active: Boolean(businessTargetRow.is_active),
        notes: businessTargetRow.notes || null,
      }
    : null;

  const identifiersByBundleKey = new Map<string, string[]>();
  for (const row of (identifiers || []) as any[]) {
    const key = String(row.entity_key || '').trim();
    if (!key) continue;
    if (!identifiersByBundleKey.has(key)) identifiersByBundleKey.set(key, []);
    identifiersByBundleKey.get(key)!.push(String(row.identifier || ''));
  }

  const mappingByEntityKey = new Map<string, { warehouse_product_id: number; warehouse_product: WarehouseProductLite; entity_type: 'product' | 'variant' | null }>();
  for (const row of (mappings || []) as any[]) {
    if (!row.warehouse_products?.id) continue;
    mappingByEntityKey.set(String(row.scalev_entity_key), {
      warehouse_product_id: Number(row.warehouse_product_id),
      warehouse_product: {
        id: Number(row.warehouse_products.id),
        name: row.warehouse_products.name,
        category: row.warehouse_products.category || null,
        entity: row.warehouse_products.entity || null,
        warehouse: row.warehouse_products.warehouse || null,
      },
      entity_type: row.scalev_entity_type === 'product' || row.scalev_entity_type === 'variant'
        ? row.scalev_entity_type
        : null,
    });
  }

  const componentsByBundleId = new Map<number, BundleComponentRow[]>();
  let lastSyncedAt: string | null = null;
  for (const row of (bundleLines || []) as any[]) {
    const bundleId = Number(row.scalev_bundle_id || 0);
    if (!bundleId) continue;
    if (!componentsByBundleId.has(bundleId)) componentsByBundleId.set(bundleId, []);

    lastSyncedAt = lastSyncedAt || row.last_synced_at || null;
    const variantKey = row.scalev_variant_id ? `variant:${row.scalev_variant_id}` : null;
    const productKey = row.scalev_product_id ? `product:${row.scalev_product_id}` : null;
    const resolved = (variantKey && mappingByEntityKey.get(variantKey))
      || (productKey && mappingByEntityKey.get(productKey))
      || null;

    componentsByBundleId.get(bundleId)!.push({
      bundle_line_key: row.scalev_bundle_line_key,
      quantity: Number(row.quantity || 0),
      scalev_variant_id: row.scalev_variant_id != null ? Number(row.scalev_variant_id) : null,
      scalev_product_id: row.scalev_product_id != null ? Number(row.scalev_product_id) : null,
      scalev_variant_unique_id: row.scalev_variant_unique_id || null,
      scalev_variant_sku: row.scalev_variant_sku || null,
      label: row.scalev_variant_name || row.scalev_variant_product_name || row.scalev_bundle_name || 'Komponen bundle',
      secondary_label: row.scalev_variant_name && row.scalev_variant_product_name && row.scalev_variant_name !== row.scalev_variant_product_name
        ? row.scalev_variant_product_name
        : row.scalev_variant_sku || null,
      resolved_warehouse_product_id: resolved?.warehouse_product_id || null,
      resolved_warehouse_product: resolved?.warehouse_product || null,
      resolution_source: resolved?.entity_type === 'variant'
        ? 'variant'
        : resolved?.entity_type === 'product'
          ? 'product'
          : null,
    });
  }

  const rows: ScalevBundleMappingRow[] = ((bundles || []) as any[]).map((bundle) => {
    const bundleId = Number(bundle.scalev_bundle_id);
    const entityKey = `bundle:${bundleId}`;
    const components = componentsByBundleId.get(bundleId) || [];
    const resolvedComponents = components.filter((component) => component.resolved_warehouse_product_id != null);
    const unresolvedComponents = components.filter((component) => component.resolved_warehouse_product_id == null);
    const label = bundle.display || bundle.public_name || bundle.name || `Bundle ${bundleId}`;
    const secondaryLabel = [bundle.name, bundle.public_name].find((value: string | null) => value && value !== label) || null;
    const identifiersPreview = Array.from(
      new Map(
        (identifiersByBundleKey.get(entityKey) || [])
          .filter(Boolean)
          .map((identifier) => [normalizeIdentifier(identifier), identifier]),
      ).values(),
    );

    let status: ScalevBundleMappingRow['status'] = 'missing-lines';
    if (components.length > 0 && unresolvedComponents.length === 0) {
      status = 'resolved';
    } else if (components.length > 0 && resolvedComponents.length > 0) {
      status = 'partial';
    } else if (components.length > 0) {
      status = 'unresolved';
    }

    return {
      bundle_id: bundleId,
      entity_key: entityKey,
      label,
      secondary_label: secondaryLabel,
      custom_id: bundle.custom_id || null,
      identifiers_count: identifiersPreview.length,
      identifiers_preview: identifiersPreview.slice(0, 4),
      components_count: components.length,
      resolved_components_count: resolvedComponents.length,
      unresolved_components_count: unresolvedComponents.length,
      status,
      components,
    };
  });

  rows.sort((left, right) => {
    const rank = {
      partial: 0,
      unresolved: 1,
      'missing-lines': 2,
      resolved: 3,
    } as const;
    if (rank[left.status] !== rank[right.status]) return rank[left.status] - rank[right.status];
    return left.label.localeCompare(right.label);
  });

  return {
    business_id: businessId,
    business_code: businessCode,
    business_target: businessTarget,
    bundle_lines_count: (bundleLines || []).length,
    bundle_lines_last_synced_at: lastSyncedAt,
    schema_message: schemaMessage,
    rows,
  };
}
