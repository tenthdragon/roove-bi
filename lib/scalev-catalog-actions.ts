'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import { recordWarehouseActivityLog } from '@/lib/warehouse-activity-log-actions';
import {
  extractVisibleCatalogMetadata,
  type ScalevVisibilityKind,
} from '@/lib/scalev-visible-entity-helpers';
import {
  syncScalevCatalogBundleLinesUntilComplete,
} from '@/lib/scalev-catalog-bundle-actions';

const SCALEV_BASE_URL = 'https://api.scalev.id/v2';
const SCALEV_PAGE_SIZE = 50;
const UPSERT_CHUNK_SIZE = 200;
const SCALEV_REQUEST_SPACING_MS = 250;
const SCALEV_ENDPOINT_SPACING_MS = 750;
const SCALEV_MAX_RETRIES = 4;
const SCALEV_RETRY_BASE_MS = 1_500;
const CATALOG_SYNC_BUSINESS_CONCURRENCY = 2;
const VISIBLE_CUTOVER_BUNDLE_BUSINESS_CONCURRENCY = 2;
const VISIBLE_CUTOVER_BUNDLE_BATCH_SIZE = 160;

export type ScalevCatalogView = 'products' | 'variants' | 'bundles' | 'identifiers';

type ScalevCatalogVisibilityFields = {
  visibility_kind: ScalevVisibilityKind;
  owner_business_code: string;
  processor_business_code: string;
};

export type ScalevCatalogBusinessSummary = {
  id: number;
  business_code: string;
  business_name: string;
  is_active: boolean;
  has_api_key: boolean;
  catalog_schema_ready: boolean;
  catalog_schema_message: string | null;
  sync_status: 'idle' | 'running' | 'success' | 'failed';
  last_synced_at: string | null;
  last_error: string | null;
  products_count: number;
  variants_count: number;
  bundles_count: number;
  identifiers_count: number;
};

type ScalevVisibleCatalogCutoverProgressStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'warning'
  | 'failed'
  | 'skipped';

export type ScalevVisibleCatalogCutoverBusinessProgress = {
  business_id: number;
  business_code: string;
  business_name: string;
  catalog_status: ScalevVisibleCatalogCutoverProgressStatus;
  catalog_updated_at: string | null;
  bundle_status: ScalevVisibleCatalogCutoverProgressStatus;
  bundle_updated_at: string | null;
  bundles_total: number;
  bundles_processed: number;
  bundle_failed_count: number;
  latest_error: string | null;
};

export type ScalevVisibleCatalogCutoverProgress = {
  schema_ready: boolean;
  schema_message: string | null;
  active: boolean;
  phase: 'idle' | 'catalog' | 'bundle' | 'completed' | 'failed';
  started_at: string | null;
  finished_at: string | null;
  total_businesses: number;
  catalog_finished_count: number;
  catalog_success_count: number;
  catalog_failed_count: number;
  bundle_finished_count: number;
  bundle_success_count: number;
  bundle_warning_count: number;
  bundle_failed_count: number;
  total_bundles: number;
  processed_bundles: number;
  current_business_code: string | null;
  current_business_name: string | null;
  last_event_at: string | null;
  summary: string;
  businesses: ScalevVisibleCatalogCutoverBusinessProgress[];
};

type WarehouseActivityLogLite = {
  created_at: string;
  action: string;
  business_code: string | null;
  summary: string;
  after_state: Record<string, any>;
  context: Record<string, any>;
};

type ScalevCatalogProductRow = {
  id: number;
  scalev_product_id: number;
  name: string;
  public_name: string | null;
  display: string | null;
  slug: string | null;
  item_type: string | null;
  is_inventory: boolean;
  is_multiple: boolean;
  is_listed_at_marketplace: boolean;
  variants_count: number;
  scalev_last_updated_at: string | null;
  last_synced_at: string;
} & ScalevCatalogVisibilityFields;

type ScalevCatalogVariantRow = {
  id: number;
  scalev_variant_id: number;
  name: string;
  product_name: string | null;
  sku: string | null;
  scalev_variant_unique_id: string | null;
  scalev_variant_uuid: string | null;
  option1_value: string | null;
  option2_value: string | null;
  option3_value: string | null;
  item_type: string | null;
  last_synced_at: string;
} & ScalevCatalogVisibilityFields;

type ScalevCatalogBundleRow = {
  id: number;
  name: string;
  public_name: string | null;
  display: string | null;
  custom_id: string | null;
  weight_bump: number | null;
  is_bundle_sharing: boolean;
  price_options_count: number;
  last_synced_at: string;
} & ScalevCatalogVisibilityFields;

type ScalevCatalogIdentifierRow = {
  id: number;
  identifier: string;
  source: string;
  entity_type: 'product' | 'variant' | 'bundle';
  entity_label: string;
  last_synced_at: string;
} & ScalevCatalogVisibilityFields;

export type ScalevCatalogEntryRow =
  | ScalevCatalogProductRow
  | ScalevCatalogVariantRow
  | ScalevCatalogBundleRow
  | ScalevCatalogIdentifierRow;

type ScalevBusinessConfig = {
  id: number;
  business_code: string;
  business_name: string;
  api_key: string | null;
  is_active: boolean;
};

type ScalevProductApi = {
  id: number;
  uuid?: string | null;
  slug?: string | null;
  name?: string | null;
  public_name?: string | null;
  display?: string | null;
  item_type?: string | null;
  is_inventory?: boolean | null;
  is_multiple?: boolean | null;
  is_listed_at_marketplace?: boolean | null;
  created_at?: string | null;
  last_updated_at?: string | null;
  visibility_kind?: string | null;
  is_shared?: boolean | null;
  owner_business_id?: number | null;
  owner_business_code?: string | null;
  owner_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
  processor_business_id?: number | null;
  processor_business_code?: string | null;
  processor_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
  variants?: ScalevVariantApi[] | null;
};

type ScalevVariantApi = {
  id: number;
  unique_id?: string | null;
  uuid?: string | null;
  name?: string | null;
  product_name?: string | null;
  sku?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  item_type?: string | null;
  visibility_kind?: string | null;
  is_shared?: boolean | null;
  owner_business_id?: number | null;
  owner_business_code?: string | null;
  owner_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
  processor_business_id?: number | null;
  processor_business_code?: string | null;
  processor_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
};

type ScalevBundlePriceOptionApi = {
  unique_id?: string | null;
  slug?: string | null;
};

type ScalevBundleApi = {
  id: number;
  name?: string | null;
  public_name?: string | null;
  display?: string | null;
  custom_id?: string | null;
  weight_bump?: number | string | null;
  is_bundle_sharing?: boolean | null;
  visibility_kind?: string | null;
  is_shared?: boolean | null;
  owner_business_id?: number | null;
  owner_business_code?: string | null;
  owner_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
  processor_business_id?: number | null;
  processor_business_code?: string | null;
  processor_business?: { id?: number | null; business_code?: string | null; code?: string | null } | null;
  bundle_price_options?: ScalevBundlePriceOptionApi[] | null;
};

type IdentifierSeed = {
  business_id: number;
  business_code: string;
  entity_type: 'product' | 'variant' | 'bundle';
  entity_key: string;
  entity_label: string;
  scalev_product_id: number | null;
  scalev_variant_id: number | null;
  scalev_bundle_id: number | null;
  identifier: string;
  identifier_normalized: string;
  source: string;
  last_synced_at: string;
  visibility_kind: ScalevVisibilityKind;
  owner_business_id: number;
  owner_business_code: string;
  processor_business_id: number;
  processor_business_code: string;
};

async function requireScalevCatalogAccess(label = 'Katalog Scalev') {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:mapping', label);
}

function isCatalogSchemaMissingError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === 'PGRST205'
    || code === '42P01'
    || /schema cache/i.test(message)
    || /does not exist/i.test(message)
  );
}

function isActivityLogSchemaMissingError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function cleanRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseIsoDate(value: unknown): number | null {
  const text = parseText(value);
  if (!text) return null;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? time : null;
}

function pickLaterDate(current: string | null, candidate: string | null) {
  const currentTime = parseIsoDate(current);
  const candidateTime = parseIsoDate(candidate);

  if (candidateTime == null) return current;
  if (currentTime == null || candidateTime > currentTime) return candidate;
  return current;
}

function buildCutoverSummary(progress: {
  active: boolean;
  phase: ScalevVisibleCatalogCutoverProgress['phase'];
  totalBusinesses: number;
  catalogFinishedCount: number;
  bundleFinishedCount: number;
  totalBundles: number;
  processedBundles: number;
  currentBusinessCode: string | null;
  bundleWarningCount: number;
  bundleFailedCount: number;
}) {
  if (progress.phase === 'idle') {
    return 'Belum ada bulk sync visible catalog yang tercatat.';
  }

  if (progress.active) {
    if (progress.phase === 'catalog') {
      return `Fase katalog berjalan: ${progress.catalogFinishedCount}/${progress.totalBusinesses} business selesai.`;
    }
    const currentBusiness = progress.currentBusinessCode ? ` Business aktif: ${progress.currentBusinessCode}.` : '';
    return `Fase bundle berjalan: ${progress.bundleFinishedCount}/${progress.totalBusinesses} business selesai, ${progress.processedBundles}/${progress.totalBundles} bundle diproses.${currentBusiness}`;
  }

  if (progress.phase === 'failed') {
    return `Bulk sync berhenti dengan error setelah ${progress.catalogFinishedCount}/${progress.totalBusinesses} business katalog selesai.`;
  }

  if (progress.bundleWarningCount > 0 || progress.bundleFailedCount > 0) {
    return `Bulk sync selesai dengan catatan: ${progress.bundleFinishedCount}/${progress.totalBusinesses} business bundle selesai, ${progress.bundleWarningCount + progress.bundleFailedCount} business memiliki masalah bundle.`;
  }

  return `Bulk sync selesai: ${progress.totalBusinesses}/${progress.totalBusinesses} business katalog dan bundle selesai.`;
}

function getCatalogSchemaMissingMessage(): string {
  return "Schema katalog visible Scalev belum terbaca oleh API Supabase. Pastikan migration 129 sudah jalan, lalu refresh schema cache dengan `NOTIFY pgrst, 'reload schema';`.";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) return;

        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

function cleanString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseNumeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSearchTerm(value: string | undefined): string | null {
  const cleaned = String(value || '')
    .trim()
    .replace(/[%(),]/g, ' ')
    .replace(/\s+/g, ' ');
  return cleaned ? `%${cleaned}%` : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const targetMs = Date.parse(headerValue);
  if (!Number.isFinite(targetMs)) return null;

  return Math.max(0, targetMs - Date.now());
}

function getScalevRetryDelayMs(response: Response, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  if (retryAfterMs != null && retryAfterMs > 0) {
    return retryAfterMs;
  }

  return SCALEV_RETRY_BASE_MS * Math.max(1, attempt + 1);
}

async function getCatalogSchemaState(): Promise<{ ready: boolean; message: string | null }> {
  const svc = createServiceSupabase();
  const { error: productError } = await svc
    .from('scalev_catalog_products')
    .select('id, owner_business_code, processor_business_code')
    .limit(1);

  if (productError) {
    if (isCatalogSchemaMissingError(productError)) {
      return { ready: false, message: getCatalogSchemaMissingMessage() };
    }

    throw productError;
  }

  const { error: bundleError } = await svc
    .from('scalev_catalog_bundles')
    .select('id, owner_business_code, processor_business_code')
    .limit(1);

  if (!bundleError) {
    return { ready: true, message: null };
  }

  if (isCatalogSchemaMissingError(bundleError)) {
    return { ready: false, message: getCatalogSchemaMissingMessage() };
  }

  throw bundleError;
}

async function fetchScalevPaginatedResults<T>(
  apiKey: string,
  path: string,
  pageSize: number = SCALEV_PAGE_SIZE,
): Promise<T[]> {
  const allResults: T[] = [];
  let lastId = 0;
  let hasNext = true;

  while (hasNext) {
    let url = `${SCALEV_BASE_URL}/${path}?page_size=${pageSize}`;
    if (lastId > 0) url += `&last_id=${lastId}`;

    let response: Response | null = null;

    for (let attempt = 0; attempt <= SCALEV_MAX_RETRIES; attempt += 1) {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: 'no-store',
      });

      if (response.ok) break;

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt === SCALEV_MAX_RETRIES) {
        throw new Error(`Scalev API error ${response.status} for ${path}`);
      }

      await sleep(getScalevRetryDelayMs(response, attempt));
    }

    if (!response || !response.ok) {
      throw new Error(`Scalev API error saat membaca ${path}`);
    }

    const json = await response.json();
    if (json.code !== 200) {
      throw new Error(`Scalev API returned code ${json.code} for ${path}`);
    }

    const pageResults = Array.isArray(json.data?.results) ? json.data.results : [];
    allResults.push(...pageResults);
    hasNext = Boolean(json.data?.has_next);
    lastId = Number(json.data?.last_id || 0);

    if (hasNext) {
      await sleep(SCALEV_REQUEST_SPACING_MS);
    }
  }

  return allResults;
}

async function batchUpsert(
  table: string,
  rows: Record<string, any>[],
  onConflict: string,
) {
  if (rows.length === 0) return;

  const svc = createServiceSupabase();
  for (const chunk of chunkArray(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await svc
      .from(table)
      .upsert(chunk, { onConflict });
    if (error) throw error;
  }
}

async function cleanupStaleCatalogRows(
  table: string,
  businessId: number,
  syncAt: string,
) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from(table)
    .delete()
    .eq('business_id', businessId)
    .neq('last_synced_at', syncAt);
  if (error) throw error;
}

function pushIdentifier(
  target: Map<string, IdentifierSeed>,
  seed: Omit<IdentifierSeed, 'identifier' | 'identifier_normalized' | 'source'> & {
    value: string | null;
    source: string;
  },
) {
  if (!seed.value) return;

  const normalized = normalizeIdentifier(seed.value);
  if (!normalized) return;

  const dedupeKey = [
    seed.business_id,
    normalized,
    seed.entity_type,
    seed.source,
    seed.entity_key,
  ].join('::');

  if (target.has(dedupeKey)) return;

  target.set(dedupeKey, {
    business_id: seed.business_id,
    business_code: seed.business_code,
    entity_type: seed.entity_type,
    entity_key: seed.entity_key,
    entity_label: seed.entity_label,
    scalev_product_id: seed.scalev_product_id,
    scalev_variant_id: seed.scalev_variant_id,
    scalev_bundle_id: seed.scalev_bundle_id,
    identifier: seed.value,
    identifier_normalized: normalized,
    source: seed.source,
    last_synced_at: seed.last_synced_at,
    visibility_kind: seed.visibility_kind,
    owner_business_id: seed.owner_business_id,
    owner_business_code: seed.owner_business_code,
    processor_business_id: seed.processor_business_id,
    processor_business_code: seed.processor_business_code,
  });
}

function buildCatalogPayload(
  business: ScalevBusinessConfig,
  products: ScalevProductApi[],
  bundles: ScalevBundleApi[],
  syncAt: string,
) {
  const productRows: Record<string, any>[] = [];
  const variantRows: Record<string, any>[] = [];
  const bundleRows: Record<string, any>[] = [];
  const identifierMap = new Map<string, IdentifierSeed>();

  for (const product of products) {
    const productName = cleanString(product.name) || `Product ${product.id}`;
    const productPublicName = cleanString(product.public_name);
    const productDisplay = cleanString(product.display);
    const productSlug = cleanString(product.slug);
    const productLabel = productDisplay || productPublicName || productName;
    const productVisibility = extractVisibleCatalogMetadata({
      viewerBusinessId: business.id,
      viewerBusinessCode: business.business_code,
      source: product,
    });

    productRows.push({
      business_id: business.id,
      business_code: business.business_code,
      scalev_product_id: Number(product.id),
      scalev_product_uuid: cleanString(product.uuid),
      slug: productSlug,
      name: productName,
      public_name: productPublicName,
      display: productDisplay,
      item_type: cleanString(product.item_type),
      is_inventory: Boolean(product.is_inventory),
      is_multiple: Boolean(product.is_multiple),
      is_listed_at_marketplace: Boolean(product.is_listed_at_marketplace),
      variants_count: Array.isArray(product.variants) ? product.variants.length : 0,
      scalev_created_at: cleanString(product.created_at),
      scalev_last_updated_at: cleanString(product.last_updated_at),
      last_synced_at: syncAt,
      visibility_kind: productVisibility.visibility_kind,
      owner_business_id: productVisibility.owner_business_id,
      owner_business_code: productVisibility.owner_business_code,
      processor_business_id: productVisibility.processor_business_id,
      processor_business_code: productVisibility.processor_business_code,
    });

    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'product',
      entity_key: `product:${product.id}`,
      entity_label: productLabel,
      scalev_product_id: Number(product.id),
      scalev_variant_id: null,
      scalev_bundle_id: null,
      value: productName,
      source: 'product.name',
      last_synced_at: syncAt,
      visibility_kind: productVisibility.visibility_kind,
      owner_business_id: productVisibility.owner_business_id,
      owner_business_code: productVisibility.owner_business_code,
      processor_business_id: productVisibility.processor_business_id,
      processor_business_code: productVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'product',
      entity_key: `product:${product.id}`,
      entity_label: productLabel,
      scalev_product_id: Number(product.id),
      scalev_variant_id: null,
      scalev_bundle_id: null,
      value: productPublicName,
      source: 'product.public_name',
      last_synced_at: syncAt,
      visibility_kind: productVisibility.visibility_kind,
      owner_business_id: productVisibility.owner_business_id,
      owner_business_code: productVisibility.owner_business_code,
      processor_business_id: productVisibility.processor_business_id,
      processor_business_code: productVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'product',
      entity_key: `product:${product.id}`,
      entity_label: productLabel,
      scalev_product_id: Number(product.id),
      scalev_variant_id: null,
      scalev_bundle_id: null,
      value: productDisplay,
      source: 'product.display',
      last_synced_at: syncAt,
      visibility_kind: productVisibility.visibility_kind,
      owner_business_id: productVisibility.owner_business_id,
      owner_business_code: productVisibility.owner_business_code,
      processor_business_id: productVisibility.processor_business_id,
      processor_business_code: productVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'product',
      entity_key: `product:${product.id}`,
      entity_label: productLabel,
      scalev_product_id: Number(product.id),
      scalev_variant_id: null,
      scalev_bundle_id: null,
      value: productSlug,
      source: 'product.slug',
      last_synced_at: syncAt,
      visibility_kind: productVisibility.visibility_kind,
      owner_business_id: productVisibility.owner_business_id,
      owner_business_code: productVisibility.owner_business_code,
      processor_business_id: productVisibility.processor_business_id,
      processor_business_code: productVisibility.processor_business_code,
    });

    for (const variant of product.variants || []) {
      const variantName = cleanString(variant.name) || productLabel;
      const variantProductName = cleanString(variant.product_name) || productName;
      const variantLabel = variantName || variantProductName || productLabel;
      const variantVisibility = extractVisibleCatalogMetadata({
        viewerBusinessId: business.id,
        viewerBusinessCode: business.business_code,
        source: variant,
        fallback: productVisibility,
      });

      variantRows.push({
        business_id: business.id,
        business_code: business.business_code,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_variant_unique_id: cleanString(variant.unique_id),
        scalev_variant_uuid: cleanString(variant.uuid),
        product_name: variantProductName,
        name: variantName,
        sku: cleanString(variant.sku),
        option1_value: cleanString(variant.option1_value),
        option2_value: cleanString(variant.option2_value),
        option3_value: cleanString(variant.option3_value),
        item_type: cleanString(variant.item_type),
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });

      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'variant',
        entity_key: `variant:${variant.id}`,
        entity_label: variantLabel,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_bundle_id: null,
        value: variantName,
        source: 'variant.name',
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'variant',
        entity_key: `variant:${variant.id}`,
        entity_label: variantLabel,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_bundle_id: null,
        value: variantProductName,
        source: 'variant.product_name',
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'variant',
        entity_key: `variant:${variant.id}`,
        entity_label: variantLabel,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_bundle_id: null,
        value: cleanString(variant.sku),
        source: 'variant.sku',
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'variant',
        entity_key: `variant:${variant.id}`,
        entity_label: variantLabel,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_bundle_id: null,
        value: cleanString(variant.unique_id),
        source: 'variant.unique_id',
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'variant',
        entity_key: `variant:${variant.id}`,
        entity_label: variantLabel,
        scalev_product_id: Number(product.id),
        scalev_variant_id: Number(variant.id),
        scalev_bundle_id: null,
        value: cleanString(variant.uuid),
        source: 'variant.uuid',
        last_synced_at: syncAt,
        visibility_kind: variantVisibility.visibility_kind,
        owner_business_id: variantVisibility.owner_business_id,
        owner_business_code: variantVisibility.owner_business_code,
        processor_business_id: variantVisibility.processor_business_id,
        processor_business_code: variantVisibility.processor_business_code,
      });
    }
  }

  for (const bundle of bundles) {
    const bundleName = cleanString(bundle.name) || `Bundle ${bundle.id}`;
    const bundlePublicName = cleanString(bundle.public_name);
    const bundleDisplay = cleanString(bundle.display);
    const bundleCustomId = cleanString(bundle.custom_id);
    const bundleLabel = bundleDisplay || bundlePublicName || bundleName;
    const bundleVisibility = extractVisibleCatalogMetadata({
      viewerBusinessId: business.id,
      viewerBusinessCode: business.business_code,
      source: bundle,
    });

    bundleRows.push({
      business_id: business.id,
      business_code: business.business_code,
      scalev_bundle_id: Number(bundle.id),
      name: bundleName,
      public_name: bundlePublicName,
      display: bundleDisplay,
      custom_id: bundleCustomId,
      weight_bump: parseNumeric(bundle.weight_bump),
      is_bundle_sharing: Boolean(bundle.is_bundle_sharing),
      price_options_count: Array.isArray(bundle.bundle_price_options)
        ? bundle.bundle_price_options.length
        : 0,
      last_synced_at: syncAt,
      visibility_kind: bundleVisibility.visibility_kind,
      owner_business_id: bundleVisibility.owner_business_id,
      owner_business_code: bundleVisibility.owner_business_code,
      processor_business_id: bundleVisibility.processor_business_id,
      processor_business_code: bundleVisibility.processor_business_code,
    });

    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'bundle',
      entity_key: `bundle:${bundle.id}`,
      entity_label: bundleLabel,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: Number(bundle.id),
      value: bundleName,
      source: 'bundle.name',
      last_synced_at: syncAt,
      visibility_kind: bundleVisibility.visibility_kind,
      owner_business_id: bundleVisibility.owner_business_id,
      owner_business_code: bundleVisibility.owner_business_code,
      processor_business_id: bundleVisibility.processor_business_id,
      processor_business_code: bundleVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'bundle',
      entity_key: `bundle:${bundle.id}`,
      entity_label: bundleLabel,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: Number(bundle.id),
      value: bundlePublicName,
      source: 'bundle.public_name',
      last_synced_at: syncAt,
      visibility_kind: bundleVisibility.visibility_kind,
      owner_business_id: bundleVisibility.owner_business_id,
      owner_business_code: bundleVisibility.owner_business_code,
      processor_business_id: bundleVisibility.processor_business_id,
      processor_business_code: bundleVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'bundle',
      entity_key: `bundle:${bundle.id}`,
      entity_label: bundleLabel,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: Number(bundle.id),
      value: bundleDisplay,
      source: 'bundle.display',
      last_synced_at: syncAt,
      visibility_kind: bundleVisibility.visibility_kind,
      owner_business_id: bundleVisibility.owner_business_id,
      owner_business_code: bundleVisibility.owner_business_code,
      processor_business_id: bundleVisibility.processor_business_id,
      processor_business_code: bundleVisibility.processor_business_code,
    });
    pushIdentifier(identifierMap, {
      business_id: business.id,
      business_code: business.business_code,
      entity_type: 'bundle',
      entity_key: `bundle:${bundle.id}`,
      entity_label: bundleLabel,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: Number(bundle.id),
      value: bundleCustomId,
      source: 'bundle.custom_id',
      last_synced_at: syncAt,
      visibility_kind: bundleVisibility.visibility_kind,
      owner_business_id: bundleVisibility.owner_business_id,
      owner_business_code: bundleVisibility.owner_business_code,
      processor_business_id: bundleVisibility.processor_business_id,
      processor_business_code: bundleVisibility.processor_business_code,
    });

    for (const priceOption of bundle.bundle_price_options || []) {
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'bundle',
        entity_key: `bundle:${bundle.id}`,
        entity_label: bundleLabel,
        scalev_product_id: null,
        scalev_variant_id: null,
        scalev_bundle_id: Number(bundle.id),
        value: cleanString(priceOption.unique_id),
        source: 'bundle.price_option_unique_id',
        last_synced_at: syncAt,
        visibility_kind: bundleVisibility.visibility_kind,
        owner_business_id: bundleVisibility.owner_business_id,
        owner_business_code: bundleVisibility.owner_business_code,
        processor_business_id: bundleVisibility.processor_business_id,
        processor_business_code: bundleVisibility.processor_business_code,
      });
      pushIdentifier(identifierMap, {
        business_id: business.id,
        business_code: business.business_code,
        entity_type: 'bundle',
        entity_key: `bundle:${bundle.id}`,
        entity_label: bundleLabel,
        scalev_product_id: null,
        scalev_variant_id: null,
        scalev_bundle_id: Number(bundle.id),
        value: cleanString(priceOption.slug),
        source: 'bundle.price_option_slug',
        last_synced_at: syncAt,
        visibility_kind: bundleVisibility.visibility_kind,
        owner_business_id: bundleVisibility.owner_business_id,
        owner_business_code: bundleVisibility.owner_business_code,
        processor_business_id: bundleVisibility.processor_business_id,
        processor_business_code: bundleVisibility.processor_business_code,
      });
    }
  }

  return {
    productRows,
    variantRows,
    bundleRows,
    identifierRows: Array.from(identifierMap.values()),
  };
}

async function upsertSyncState(input: {
  business_id: number;
  business_code: string;
  sync_status: 'idle' | 'running' | 'success' | 'failed';
  last_synced_at?: string | null;
  last_error?: string | null;
  products_count?: number;
  variants_count?: number;
  bundles_count?: number;
  identifiers_count?: number;
}) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_catalog_sync_state')
    .upsert({
      business_id: input.business_id,
      business_code: input.business_code,
      sync_status: input.sync_status,
      last_synced_at: input.last_synced_at ?? null,
      last_error: input.last_error ?? null,
      products_count: input.products_count ?? 0,
      variants_count: input.variants_count ?? 0,
      bundles_count: input.bundles_count ?? 0,
      identifiers_count: input.identifiers_count ?? 0,
    }, { onConflict: 'business_id' });
  if (error) throw error;
}

async function getBusinessById(businessId: number): Promise<ScalevBusinessConfig> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, api_key, is_active')
    .eq('id', businessId)
    .single();

  if (error || !data) {
    throw new Error('Business Scalev tidak ditemukan.');
  }

  return data as ScalevBusinessConfig;
}

async function getActiveScalevBusinessesForSync() {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, api_key, is_active')
    .eq('is_active', true)
    .not('api_key', 'is', null)
    .order('business_code', { ascending: true });

  if (error) throw error;
  return (data || []) as ScalevBusinessConfig[];
}

async function getLatestVisibleCutoverRunMetadata() {
  const svc = createServiceSupabase();

  const { data: startedRow, error: startedError } = await svc
    .from('warehouse_activity_log')
    .select('created_at, action, summary, business_code, after_state, context')
    .eq('scope', 'scalev_catalog_sync')
    .eq('action', 'sync_visible_cutover_started')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (startedError) {
    if (isActivityLogSchemaMissingError(startedError)) {
      return {
        schemaReady: false,
        schemaMessage: 'Audit log warehouse belum tersedia. Jalankan migration 109 terlebih dahulu.',
        startedLog: null as WarehouseActivityLogLite | null,
        terminalLog: null as WarehouseActivityLogLite | null,
        active: false,
      };
    }
    throw startedError;
  }

  const normalizedStarted = startedRow
    ? {
      created_at: startedRow.created_at,
      action: startedRow.action,
      business_code: startedRow.business_code || null,
      summary: startedRow.summary || '',
      after_state: cleanRecord(startedRow.after_state),
      context: cleanRecord(startedRow.context),
    }
    : null;

  if (!normalizedStarted) {
    return {
      schemaReady: true,
      schemaMessage: null,
      startedLog: null as WarehouseActivityLogLite | null,
      terminalLog: null as WarehouseActivityLogLite | null,
      active: false,
    };
  }

  const { data: terminalRow, error: terminalError } = await svc
    .from('warehouse_activity_log')
    .select('created_at, action, summary, business_code, after_state, context')
    .eq('scope', 'scalev_catalog_sync')
    .in('action', ['sync_visible_cutover', 'sync_visible_cutover_failed'])
    .gte('created_at', normalizedStarted.created_at)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (terminalError) {
    if (isActivityLogSchemaMissingError(terminalError)) {
      return {
        schemaReady: false,
        schemaMessage: 'Audit log warehouse belum tersedia. Jalankan migration 109 terlebih dahulu.',
        startedLog: null as WarehouseActivityLogLite | null,
        terminalLog: null as WarehouseActivityLogLite | null,
        active: false,
      };
    }
    throw terminalError;
  }

  const normalizedTerminal = terminalRow
    ? {
      created_at: terminalRow.created_at,
      action: terminalRow.action,
      business_code: terminalRow.business_code || null,
      summary: terminalRow.summary || '',
      after_state: cleanRecord(terminalRow.after_state),
      context: cleanRecord(terminalRow.context),
    }
    : null;

  return {
    schemaReady: true,
    schemaMessage: null,
    startedLog: normalizedStarted,
    terminalLog: normalizedTerminal,
    active: !normalizedTerminal,
  };
}

async function performScalevCatalogSync(
  business: ScalevBusinessConfig,
  trigger: 'single' | 'bulk' = 'single',
) {
  if (!business.api_key) {
    throw new Error(`Business ${business.business_code} belum punya API key.`);
  }

  await upsertSyncState({
    business_id: business.id,
    business_code: business.business_code,
    sync_status: 'running',
    last_error: null,
  });

  try {
    const syncAt = new Date().toISOString();
    const products = await fetchScalevPaginatedResults<ScalevProductApi>(business.api_key, 'products');
    await sleep(SCALEV_ENDPOINT_SPACING_MS);
    const bundles = await fetchScalevPaginatedResults<ScalevBundleApi>(business.api_key, 'bundles/simplified');

    const payload = buildCatalogPayload(business, products, bundles, syncAt);

    await batchUpsert('scalev_catalog_products', payload.productRows, 'business_id,scalev_product_id');
    await batchUpsert('scalev_catalog_variants', payload.variantRows, 'business_id,scalev_variant_id');
    await batchUpsert('scalev_catalog_bundles', payload.bundleRows, 'business_id,scalev_bundle_id');
    await batchUpsert(
      'scalev_catalog_identifiers',
      payload.identifierRows,
      'business_id,identifier_normalized,entity_type,source,entity_key',
    );

    await cleanupStaleCatalogRows('scalev_catalog_identifiers', business.id, syncAt);
    await cleanupStaleCatalogRows('scalev_catalog_bundles', business.id, syncAt);
    await cleanupStaleCatalogRows('scalev_catalog_variants', business.id, syncAt);
    await cleanupStaleCatalogRows('scalev_catalog_products', business.id, syncAt);

    await upsertSyncState({
      business_id: business.id,
      business_code: business.business_code,
      sync_status: 'success',
      last_synced_at: syncAt,
      last_error: null,
      products_count: payload.productRows.length,
      variants_count: payload.variantRows.length,
      bundles_count: payload.bundleRows.length,
      identifiers_count: payload.identifierRows.length,
    });

    await recordWarehouseActivityLog({
      scope: 'scalev_catalog_sync',
      action: 'sync_success',
      screen: 'Katalog Scalev',
      summary: `Sync katalog ${business.business_code} berhasil`,
      targetType: 'business',
      targetId: String(business.id),
      targetLabel: `${business.business_code} • ${business.business_name}`,
      businessCode: business.business_code,
      changedFields: ['products_count', 'variants_count', 'bundles_count', 'identifiers_count', 'last_synced_at'],
      beforeState: {},
      afterState: {
        sync_status: 'success',
        products_count: payload.productRows.length,
        variants_count: payload.variantRows.length,
        bundles_count: payload.bundleRows.length,
        identifiers_count: payload.identifierRows.length,
        last_synced_at: syncAt,
      },
      context: {
        trigger,
      },
    });

    return {
      success: true,
      business_id: business.id,
      business_code: business.business_code,
      business_name: business.business_name,
      products_count: payload.productRows.length,
      variants_count: payload.variantRows.length,
      bundles_count: payload.bundleRows.length,
      identifiers_count: payload.identifierRows.length,
      last_synced_at: syncAt,
    };
  } catch (error: any) {
    await upsertSyncState({
      business_id: business.id,
      business_code: business.business_code,
      sync_status: 'failed',
      last_error: error?.message || 'Gagal sync katalog Scalev.',
    });

    await recordWarehouseActivityLog({
      scope: 'scalev_catalog_sync',
      action: 'sync_failed',
      screen: 'Katalog Scalev',
      summary: `Sync katalog ${business.business_code} gagal`,
      targetType: 'business',
      targetId: String(business.id),
      targetLabel: `${business.business_code} • ${business.business_name}`,
      businessCode: business.business_code,
      changedFields: ['sync_status', 'last_error'],
      beforeState: {},
      afterState: {
        sync_status: 'failed',
        last_error: error?.message || 'Gagal sync katalog Scalev.',
      },
      context: {
        trigger,
      },
    });
    throw error;
  }
}

export async function getScalevCatalogBusinesses(): Promise<ScalevCatalogBusinessSummary[]> {
  await requireScalevCatalogAccess();
  const svc = createServiceSupabase();
  const schema = await getCatalogSchemaState();

  const { data: businesses, error: businessError } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, is_active, api_key')
    .order('business_code', { ascending: true });

  if (businessError) throw businessError;

  if (!schema.ready) {
    return (businesses || []).map((business: any) => ({
      id: Number(business.id),
      business_code: business.business_code,
      business_name: business.business_name,
      is_active: Boolean(business.is_active),
      has_api_key: Boolean(business.api_key),
      catalog_schema_ready: false,
      catalog_schema_message: schema.message,
      sync_status: 'idle' as const,
      last_synced_at: null,
      last_error: null,
      products_count: 0,
      variants_count: 0,
      bundles_count: 0,
      identifiers_count: 0,
    }));
  }

  const { data: syncStates, error: syncError } = await svc
    .from('scalev_catalog_sync_state')
    .select('business_id, sync_status, last_synced_at, last_error, products_count, variants_count, bundles_count, identifiers_count');

  if (syncError) {
    if (isCatalogSchemaMissingError(syncError)) {
      return (businesses || []).map((business: any) => ({
        id: Number(business.id),
        business_code: business.business_code,
        business_name: business.business_name,
        is_active: Boolean(business.is_active),
        has_api_key: Boolean(business.api_key),
        catalog_schema_ready: false,
        catalog_schema_message: getCatalogSchemaMissingMessage(),
        sync_status: 'idle' as const,
        last_synced_at: null,
        last_error: null,
        products_count: 0,
        variants_count: 0,
        bundles_count: 0,
        identifiers_count: 0,
      }));
    }
    throw syncError;
  }

  const syncByBusinessId = new Map<number, any>(
    (syncStates || []).map((row: any) => [Number(row.business_id), row]),
  );

  return (businesses || []).map((business: any) => {
    const syncState = syncByBusinessId.get(Number(business.id));
    return {
      id: Number(business.id),
      business_code: business.business_code,
      business_name: business.business_name,
      is_active: Boolean(business.is_active),
      has_api_key: Boolean(business.api_key),
      catalog_schema_ready: true,
      catalog_schema_message: null,
      sync_status: (syncState?.sync_status || 'idle') as 'idle' | 'running' | 'success' | 'failed',
      last_synced_at: syncState?.last_synced_at || null,
      last_error: syncState?.last_error || null,
      products_count: Number(syncState?.products_count || 0),
      variants_count: Number(syncState?.variants_count || 0),
      bundles_count: Number(syncState?.bundles_count || 0),
      identifiers_count: Number(syncState?.identifiers_count || 0),
    };
  });
}

export async function syncScalevCatalogBusiness(businessId: number) {
  await requireScalevCatalogAccess();
  const business = await getBusinessById(businessId);
  return performScalevCatalogSync(business, 'single');
}

export async function syncScalevCatalogAllBusinesses(preloadedBusinesses?: ScalevBusinessConfig[]) {
  await requireScalevCatalogAccess();
  const activeBusinesses = preloadedBusinesses || await getActiveScalevBusinessesForSync();
  const results = await mapWithConcurrency(
    activeBusinesses,
    CATALOG_SYNC_BUSINESS_CONCURRENCY,
    async (business) => {
      try {
        return await performScalevCatalogSync(business, 'bulk');
      } catch (syncError: any) {
        return {
          success: false,
          business_id: business.id,
          business_code: business.business_code,
          business_name: business.business_name,
          error: syncError?.message || 'Gagal sync katalog Scalev.',
        };
      }
    },
  );

  await recordWarehouseActivityLog({
    scope: 'scalev_catalog_sync',
    action: 'sync_all',
    screen: 'Katalog Scalev',
    summary: 'Menjalankan sync katalog untuk semua business aktif',
    targetType: 'batch',
    targetId: 'all-businesses',
    targetLabel: 'All Scalev Businesses',
    changedFields: ['total_businesses', 'success_count', 'failed_count'],
    beforeState: {},
    afterState: {
      total_businesses: results.length,
      success_count: results.filter((row) => row.success).length,
      failed_count: results.filter((row) => !row.success).length,
    },
    context: {
      businesses: results.map((row) => ({
        business_id: row.business_id,
        business_code: row.business_code,
        success: Boolean(row.success),
      })),
    },
  });

  return results;
}

export async function getScalevVisibleCatalogCutoverProgress(): Promise<ScalevVisibleCatalogCutoverProgress> {
  await requireScalevCatalogAccess();

  const schema = await getCatalogSchemaState();
  const activeBusinesses = await getActiveScalevBusinessesForSync();
  const idleBusinesses: ScalevVisibleCatalogCutoverBusinessProgress[] = activeBusinesses.map((business) => ({
    business_id: business.id,
    business_code: business.business_code,
    business_name: business.business_name,
    catalog_status: 'pending',
    catalog_updated_at: null,
    bundle_status: 'pending',
    bundle_updated_at: null,
    bundles_total: 0,
    bundles_processed: 0,
    bundle_failed_count: 0,
    latest_error: null,
  }));

  if (!schema.ready) {
    return {
      schema_ready: false,
      schema_message: schema.message,
      active: false,
      phase: 'idle',
      started_at: null,
      finished_at: null,
      total_businesses: idleBusinesses.length,
      catalog_finished_count: 0,
      catalog_success_count: 0,
      catalog_failed_count: 0,
      bundle_finished_count: 0,
      bundle_success_count: 0,
      bundle_warning_count: 0,
      bundle_failed_count: 0,
      total_bundles: 0,
      processed_bundles: 0,
      current_business_code: null,
      current_business_name: null,
      last_event_at: null,
      summary: schema.message || 'Schema katalog Scalev belum siap dipakai.',
      businesses: idleBusinesses,
    };
  }

  const run = await getLatestVisibleCutoverRunMetadata();
  if (!run.schemaReady) {
    return {
      schema_ready: false,
      schema_message: run.schemaMessage,
      active: false,
      phase: 'idle',
      started_at: null,
      finished_at: null,
      total_businesses: idleBusinesses.length,
      catalog_finished_count: 0,
      catalog_success_count: 0,
      catalog_failed_count: 0,
      bundle_finished_count: 0,
      bundle_success_count: 0,
      bundle_warning_count: 0,
      bundle_failed_count: 0,
      total_bundles: 0,
      processed_bundles: 0,
      current_business_code: null,
      current_business_name: null,
      last_event_at: null,
      summary: run.schemaMessage || 'Audit log warehouse belum siap dipakai.',
      businesses: idleBusinesses,
    };
  }

  if (!run.startedLog) {
    return {
      schema_ready: true,
      schema_message: null,
      active: false,
      phase: 'idle',
      started_at: null,
      finished_at: null,
      total_businesses: idleBusinesses.length,
      catalog_finished_count: 0,
      catalog_success_count: 0,
      catalog_failed_count: 0,
      bundle_finished_count: 0,
      bundle_success_count: 0,
      bundle_warning_count: 0,
      bundle_failed_count: 0,
      total_bundles: 0,
      processed_bundles: 0,
      current_business_code: null,
      current_business_name: null,
      last_event_at: null,
      summary: 'Belum ada bulk sync visible catalog yang tercatat.',
      businesses: idleBusinesses,
    };
  }

  const startedAt = run.startedLog.created_at;
  const svc = createServiceSupabase();
  const [syncStateRes, catalogLogRes, bundleLogRes] = await Promise.all([
    svc
      .from('scalev_catalog_sync_state')
      .select('business_id, business_code, sync_status, last_synced_at, last_error, bundles_count')
      .order('business_code', { ascending: true }),
    svc
      .from('warehouse_activity_log')
      .select('created_at, action, business_code, summary, after_state, context')
      .eq('scope', 'scalev_catalog_sync')
      .in('action', ['sync_success', 'sync_failed'])
      .gte('created_at', startedAt)
      .order('created_at', { ascending: false })
      .limit(200),
    svc
      .from('warehouse_activity_log')
      .select('created_at, action, business_code, summary, after_state, context')
      .eq('scope', 'scalev_bundle_sync')
      .in('action', ['sync_success', 'sync_partial', 'sync_failed'])
      .gte('created_at', startedAt)
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  if (syncStateRes.error) throw syncStateRes.error;
  if (catalogLogRes.error) {
    if (isActivityLogSchemaMissingError(catalogLogRes.error)) {
      return {
        schema_ready: false,
        schema_message: 'Audit log warehouse belum tersedia. Jalankan migration 109 terlebih dahulu.',
        active: false,
        phase: 'idle',
        started_at: null,
        finished_at: null,
        total_businesses: idleBusinesses.length,
        catalog_finished_count: 0,
        catalog_success_count: 0,
        catalog_failed_count: 0,
        bundle_finished_count: 0,
        bundle_success_count: 0,
        bundle_warning_count: 0,
        bundle_failed_count: 0,
        total_bundles: 0,
        processed_bundles: 0,
        current_business_code: null,
        current_business_name: null,
        last_event_at: null,
        summary: 'Audit log warehouse belum siap dipakai.',
        businesses: idleBusinesses,
      };
    }
    throw catalogLogRes.error;
  }
  if (bundleLogRes.error) {
    if (isActivityLogSchemaMissingError(bundleLogRes.error)) {
      return {
        schema_ready: false,
        schema_message: 'Audit log warehouse belum tersedia. Jalankan migration 109 terlebih dahulu.',
        active: false,
        phase: 'idle',
        started_at: null,
        finished_at: null,
        total_businesses: idleBusinesses.length,
        catalog_finished_count: 0,
        catalog_success_count: 0,
        catalog_failed_count: 0,
        bundle_finished_count: 0,
        bundle_success_count: 0,
        bundle_warning_count: 0,
        bundle_failed_count: 0,
        total_bundles: 0,
        processed_bundles: 0,
        current_business_code: null,
        current_business_name: null,
        last_event_at: null,
        summary: 'Audit log warehouse belum siap dipakai.',
        businesses: idleBusinesses,
      };
    }
    throw bundleLogRes.error;
  }

  const syncStates = (syncStateRes.data || []) as any[];
  const catalogLogs = ((catalogLogRes.data || []) as any[])
    .filter((row) => String(cleanRecord(row.context)?.trigger || '') === 'bulk')
    .map((row) => ({
      created_at: row.created_at,
      action: row.action,
      business_code: row.business_code || null,
      summary: row.summary || '',
      after_state: cleanRecord(row.after_state),
      context: cleanRecord(row.context),
    })) as WarehouseActivityLogLite[];
  const bundleLogs = ((bundleLogRes.data || []) as any[]).map((row) => ({
    created_at: row.created_at,
    action: row.action,
    business_code: row.business_code || null,
    summary: row.summary || '',
    after_state: cleanRecord(row.after_state),
    context: cleanRecord(row.context),
  })) as WarehouseActivityLogLite[];

  const syncStateByBusinessId = new Map<number, any>(
    syncStates.map((row) => [Number(row.business_id), row]),
  );
  const latestCatalogLogByCode = new Map<string, WarehouseActivityLogLite>();
  for (const row of catalogLogs) {
    const businessCode = parseText(row.business_code);
    if (!businessCode || latestCatalogLogByCode.has(businessCode)) continue;
    latestCatalogLogByCode.set(businessCode, row);
  }

  const latestBundleLogByCode = new Map<string, WarehouseActivityLogLite>();
  const bundleFailedByCode = new Map<string, number>();
  for (const row of bundleLogs) {
    const businessCode = parseText(row.business_code);
    if (!businessCode) continue;
    if (!latestBundleLogByCode.has(businessCode)) {
      latestBundleLogByCode.set(businessCode, row);
    }
    bundleFailedByCode.set(
      businessCode,
      Number(bundleFailedByCode.get(businessCode) || 0) + parseNumber(row.after_state?.failed_count),
    );
  }

  let catalogFinishedCount = 0;
  let catalogSuccessCount = 0;
  let catalogFailedCount = 0;
  let bundleFinishedCount = 0;
  let bundleSuccessCount = 0;
  let bundleWarningCount = 0;
  let bundleFailedCount = 0;
  let totalBundles = 0;
  let processedBundles = 0;
  let lastEventAt = pickLaterDate(startedAt, run.terminalLog?.created_at || null);

  const businesses = activeBusinesses.map((business) => {
    const syncState = syncStateByBusinessId.get(Number(business.id));
    const latestCatalogLog = latestCatalogLogByCode.get(business.business_code);
    const latestBundleLog = latestBundleLogByCode.get(business.business_code);

    let catalogStatus: ScalevVisibleCatalogCutoverProgressStatus = 'pending';
    if (latestCatalogLog?.action === 'sync_success') {
      catalogStatus = 'success';
    } else if (latestCatalogLog?.action === 'sync_failed') {
      catalogStatus = 'failed';
    } else if (syncState?.sync_status === 'running') {
      catalogStatus = 'running';
    }

    if (catalogStatus === 'success' || catalogStatus === 'failed') {
      catalogFinishedCount += 1;
    }
    if (catalogStatus === 'success') catalogSuccessCount += 1;
    if (catalogStatus === 'failed') catalogFailedCount += 1;

    const bundlesTotal = Math.max(
      parseNumber(latestBundleLog?.context?.total_bundles),
      parseNumber(syncState?.bundles_count),
    );
    totalBundles += bundlesTotal;

    let bundleStatus: ScalevVisibleCatalogCutoverProgressStatus = 'pending';
    let bundlesProcessed = 0;
    let latestError = catalogStatus === 'failed'
      ? parseText(syncState?.last_error) || parseText(latestCatalogLog?.summary)
      : null;

    if (latestBundleLog) {
      const nextOffset = Math.max(
        parseNumber(latestBundleLog.context?.next_offset),
        parseNumber(latestBundleLog.after_state?.offset) + parseNumber(latestBundleLog.after_state?.bundles_scanned),
      );
      bundlesProcessed = Math.min(nextOffset, bundlesTotal || nextOffset);
      const batchFailedCount = Number(bundleFailedByCode.get(business.business_code) || 0);
      if (latestBundleLog.action === 'sync_failed') {
        bundleStatus = 'failed';
        latestError = parseText(latestBundleLog.context?.error) || parseText(latestBundleLog.summary);
      } else if (latestBundleLog.after_state?.completed) {
        bundleStatus = batchFailedCount > 0 || latestBundleLog.action === 'sync_partial' ? 'warning' : 'success';
      } else {
        bundleStatus = 'running';
      }
    } else if (catalogStatus === 'failed') {
      bundleStatus = 'skipped';
    }

    if (bundleStatus === 'success' || bundleStatus === 'warning' || bundleStatus === 'failed') {
      bundleFinishedCount += 1;
    }
    if (bundleStatus === 'success') bundleSuccessCount += 1;
    if (bundleStatus === 'warning') bundleWarningCount += 1;
    if (bundleStatus === 'failed') bundleFailedCount += 1;

    processedBundles += bundlesProcessed;
    lastEventAt = pickLaterDate(lastEventAt, latestCatalogLog?.created_at || null);
    lastEventAt = pickLaterDate(lastEventAt, latestBundleLog?.created_at || null);

    return {
      business_id: business.id,
      business_code: business.business_code,
      business_name: business.business_name,
      catalog_status: catalogStatus,
      catalog_updated_at: latestCatalogLog?.created_at || null,
      bundle_status: bundleStatus,
      bundle_updated_at: latestBundleLog?.created_at || null,
      bundles_total: bundlesTotal,
      bundles_processed: bundlesProcessed,
      bundle_failed_count: Number(bundleFailedByCode.get(business.business_code) || 0),
      latest_error: latestError,
    };
  });

  const activePhase: ScalevVisibleCatalogCutoverProgress['phase'] = run.active
    ? businesses.some((business) => business.catalog_status === 'pending' || business.catalog_status === 'running')
      ? 'catalog'
      : 'bundle'
    : run.terminalLog?.action === 'sync_visible_cutover_failed'
      ? 'failed'
      : 'completed';

  const currentBusiness = activePhase === 'catalog'
    ? businesses.find((business) => business.catalog_status === 'running')
      || businesses.find((business) => business.catalog_status === 'pending')
      || null
    : activePhase === 'bundle'
      ? businesses.find((business) => business.bundle_status === 'running')
        || businesses.find((business) => business.bundle_status === 'pending')
        || null
      : null;

  const summary = buildCutoverSummary({
    active: run.active,
    phase: activePhase,
    totalBusinesses: businesses.length,
    catalogFinishedCount,
    bundleFinishedCount,
    totalBundles,
    processedBundles,
    currentBusinessCode: currentBusiness?.business_code || null,
    bundleWarningCount,
    bundleFailedCount,
  });

  return {
    schema_ready: true,
    schema_message: null,
    active: run.active,
    phase: activePhase,
    started_at: startedAt,
    finished_at: run.terminalLog?.created_at || null,
    total_businesses: businesses.length,
    catalog_finished_count: catalogFinishedCount,
    catalog_success_count: catalogSuccessCount,
    catalog_failed_count: catalogFailedCount,
    bundle_finished_count: bundleFinishedCount,
    bundle_success_count: bundleSuccessCount,
    bundle_warning_count: bundleWarningCount,
    bundle_failed_count: bundleFailedCount,
    total_bundles: totalBundles,
    processed_bundles: processedBundles,
    current_business_code: currentBusiness?.business_code || null,
    current_business_name: currentBusiness?.business_name || null,
    last_event_at: lastEventAt,
    summary,
    businesses,
  };
}

export async function syncScalevVisibleCatalogCutoverAllBusinesses() {
  await requireScalevCatalogAccess();
  const existingRun = await getLatestVisibleCutoverRunMetadata();
  if (existingRun.active) {
    throw new Error('Sync Semua Business + Bundle masih berjalan. Tunggu run aktif selesai atau refresh progress terlebih dahulu.');
  }

  const activeBusinesses = await getActiveScalevBusinessesForSync();
  const startedAt = new Date().toISOString();

  await recordWarehouseActivityLog({
    scope: 'scalev_catalog_sync',
    action: 'sync_visible_cutover_started',
    screen: 'Katalog Scalev',
    summary: 'Memulai sync visible catalog dan bundle lines untuk cutover deduction baru',
    targetType: 'batch',
    targetId: 'visible-cutover',
    targetLabel: 'Visible Catalog Cutover',
    changedFields: ['phase', 'total_businesses'],
    beforeState: {},
    afterState: {
      phase: 'catalog',
      total_businesses: activeBusinesses.length,
    },
    context: {
      started_at: startedAt,
      business_ids: activeBusinesses.map((business) => business.id),
      business_codes: activeBusinesses.map((business) => business.business_code),
    },
    createdAt: startedAt,
  });

  try {
    const catalogResults = await syncScalevCatalogAllBusinesses(activeBusinesses);
    const successfulCatalogResults = catalogResults.filter((result) => result?.success && result.business_id);
    const bundleResults = await mapWithConcurrency(
      successfulCatalogResults,
      VISIBLE_CUTOVER_BUNDLE_BUSINESS_CONCURRENCY,
      async (result) => {
        try {
          return await syncScalevCatalogBundleLinesUntilComplete(Number(result.business_id), {
            batchSize: VISIBLE_CUTOVER_BUNDLE_BATCH_SIZE,
          });
        } catch (bundleError: any) {
          await recordWarehouseActivityLog({
            scope: 'scalev_bundle_sync',
            action: 'sync_failed',
            screen: 'Bundle Mapping Scalev',
            summary: `Sync isi bundle ${result.business_code} gagal`,
            targetType: 'business',
            targetId: String(result.business_id),
            targetLabel: `${result.business_code} • ${result.business_name || result.business_code}`,
            businessCode: result.business_code,
            changedFields: ['failed_count'],
            beforeState: {},
            afterState: {
              completed: false,
              failed_count: 1,
            },
            context: {
              error: bundleError?.message || 'Gagal sync isi bundle.',
            },
          });
          return {
            success: false,
            business_id: result.business_id,
            business_code: result.business_code,
            business_name: result.business_name,
            error: bundleError?.message || 'Gagal sync isi bundle.',
          };
        }
      },
    );

    await recordWarehouseActivityLog({
      scope: 'scalev_catalog_sync',
      action: 'sync_visible_cutover',
      screen: 'Katalog Scalev',
      summary: 'Menjalankan sync visible catalog dan bundle lines untuk cutover deduction baru',
      targetType: 'batch',
      targetId: 'visible-cutover',
      targetLabel: 'Visible Catalog Cutover',
      changedFields: ['catalog_success_count', 'catalog_failed_count', 'bundle_success_count', 'bundle_failed_count'],
      beforeState: {
        phase: 'bundle',
      },
      afterState: {
        catalog_success_count: catalogResults.filter((row) => row.success).length,
        catalog_failed_count: catalogResults.filter((row) => !row.success).length,
        bundle_success_count: bundleResults.filter((row) => row.success).length,
        bundle_failed_count: bundleResults.filter((row) => !row.success).length,
      },
      context: {
        started_at: startedAt,
        catalog_results: catalogResults.map((row) => ({
          business_id: row.business_id,
          business_code: row.business_code,
          success: Boolean(row.success),
        })),
        bundle_results: bundleResults.map((row) => ({
          business_id: row.business_id,
          business_code: row.business_code,
          success: Boolean(row.success),
        })),
      },
    });

    return {
      catalog_results: catalogResults,
      bundle_results: bundleResults,
      catalog_success_count: catalogResults.filter((row) => row.success).length,
      catalog_failed_count: catalogResults.filter((row) => !row.success).length,
      bundle_success_count: bundleResults.filter((row) => row.success).length,
      bundle_failed_count: bundleResults.filter((row) => !row.success).length,
    };
  } catch (error: any) {
    await recordWarehouseActivityLog({
      scope: 'scalev_catalog_sync',
      action: 'sync_visible_cutover_failed',
      screen: 'Katalog Scalev',
      summary: 'Bulk sync visible catalog berhenti karena error',
      targetType: 'batch',
      targetId: 'visible-cutover',
      targetLabel: 'Visible Catalog Cutover',
      changedFields: ['error'],
      beforeState: {},
      afterState: {
        error: error?.message || 'Gagal menjalankan sync visible catalog.',
      },
      context: {
        started_at: startedAt,
        business_codes: activeBusinesses.map((business) => business.business_code),
      },
    });
    throw error;
  }
}

export async function getScalevCatalogEntries(input: {
  businessId: number;
  view: ScalevCatalogView;
  search?: string;
  limit?: number;
}): Promise<ScalevCatalogEntryRow[]> {
  await requireScalevCatalogAccess();
  const schema = await getCatalogSchemaState();
  if (!schema.ready) return [];
  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(input.limit || 200), 1), 500);
  const searchTerm = sanitizeSearchTerm(input.search);

  if (input.view === 'products') {
    let query = svc
      .from('scalev_catalog_products')
      .select(`
        id,
        business_code,
        scalev_product_id,
        name,
        public_name,
        display,
        slug,
        item_type,
        is_inventory,
        is_multiple,
        is_listed_at_marketplace,
        variants_count,
        scalev_last_updated_at,
        last_synced_at,
        visibility_kind,
        owner_business_code,
        processor_business_code
      `)
      .eq('business_id', input.businessId)
      .order('name', { ascending: true })
      .limit(limit);

    if (searchTerm) {
      query = query.or(`name.ilike.${searchTerm},public_name.ilike.${searchTerm},display.ilike.${searchTerm},slug.ilike.${searchTerm}`);
    }

    const { data, error } = await query;
    if (error) {
      if (isCatalogSchemaMissingError(error)) return [];
      throw error;
    }
    return (data || []) as ScalevCatalogProductRow[];
  }

  if (input.view === 'variants') {
    let query = svc
      .from('scalev_catalog_variants')
      .select(`
        id,
        business_code,
        scalev_variant_id,
        name,
        product_name,
        sku,
        scalev_variant_unique_id,
        scalev_variant_uuid,
        option1_value,
        option2_value,
        option3_value,
        item_type,
        last_synced_at,
        visibility_kind,
        owner_business_code,
        processor_business_code
      `)
      .eq('business_id', input.businessId)
      .order('product_name', { ascending: true })
      .order('name', { ascending: true })
      .limit(limit);

    if (searchTerm) {
      query = query.or(`name.ilike.${searchTerm},product_name.ilike.${searchTerm},sku.ilike.${searchTerm},scalev_variant_unique_id.ilike.${searchTerm},scalev_variant_uuid.ilike.${searchTerm}`);
    }

    const { data, error } = await query;
    if (error) {
      if (isCatalogSchemaMissingError(error)) return [];
      throw error;
    }
    return (data || []) as ScalevCatalogVariantRow[];
  }

  if (input.view === 'bundles') {
    let query = svc
      .from('scalev_catalog_bundles')
      .select(`
        id,
        name,
        public_name,
        display,
        custom_id,
        weight_bump,
        is_bundle_sharing,
        price_options_count,
        last_synced_at,
        visibility_kind,
        owner_business_code,
        processor_business_code
      `)
      .eq('business_id', input.businessId)
      .order('name', { ascending: true })
      .limit(limit);

    if (searchTerm) {
      query = query.or(`name.ilike.${searchTerm},public_name.ilike.${searchTerm},display.ilike.${searchTerm},custom_id.ilike.${searchTerm}`);
    }

    const { data, error } = await query;
    if (error) {
      if (isCatalogSchemaMissingError(error)) return [];
      throw error;
    }
    return (data || []) as ScalevCatalogBundleRow[];
  }

  let query = svc
    .from('scalev_catalog_identifiers')
    .select(`
      id,
      identifier,
      source,
      entity_type,
      entity_label,
      last_synced_at,
      visibility_kind,
      owner_business_code,
      processor_business_code
    `)
    .eq('business_id', input.businessId)
    .order('identifier', { ascending: true })
    .limit(limit);

  if (searchTerm) {
    query = query.or(`identifier.ilike.${searchTerm},entity_label.ilike.${searchTerm},source.ilike.${searchTerm}`);
  }

  const { data, error } = await query;
  if (error) {
    if (isCatalogSchemaMissingError(error)) return [];
    throw error;
  }
  return (data || []) as ScalevCatalogIdentifierRow[];
}
