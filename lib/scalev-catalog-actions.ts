'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import { recordWarehouseActivityLog } from '@/lib/warehouse-activity-log-actions';

const SCALEV_BASE_URL = 'https://api.scalev.id/v2';
const SCALEV_PAGE_SIZE = 50;
const UPSERT_CHUNK_SIZE = 200;

export type ScalevCatalogView = 'products' | 'variants' | 'bundles' | 'identifiers';

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

type ScalevCatalogProductRow = {
  id: number;
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
};

type ScalevCatalogVariantRow = {
  id: number;
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
};

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
};

type ScalevCatalogIdentifierRow = {
  id: number;
  identifier: string;
  source: string;
  entity_type: 'product' | 'variant' | 'bundle';
  entity_label: string;
  last_synced_at: string;
};

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

function getCatalogSchemaMissingMessage(): string {
  return 'Tabel katalog Scalev belum tersedia untuk API Supabase. Jalankan migration tahap 1 lalu refresh schema cache Supabase.';
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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

async function getCatalogSchemaState(): Promise<{ ready: boolean; message: string | null }> {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_catalog_products')
    .select('id')
    .limit(1);

  if (!error) {
    return { ready: true, message: null };
  }

  if (isCatalogSchemaMissingError(error)) {
    return { ready: false, message: getCatalogSchemaMissingMessage() };
  }

  throw error;
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

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Scalev API error ${response.status} for ${path}`);
    }

    const json = await response.json();
    if (json.code !== 200) {
      throw new Error(`Scalev API returned code ${json.code} for ${path}`);
    }

    const pageResults = Array.isArray(json.data?.results) ? json.data.results : [];
    allResults.push(...pageResults);
    hasNext = Boolean(json.data?.has_next);
    lastId = Number(json.data?.last_id || 0);
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
    });

    for (const variant of product.variants || []) {
      const variantName = cleanString(variant.name) || productLabel;
      const variantProductName = cleanString(variant.product_name) || productName;
      const variantLabel = variantName || variantProductName || productLabel;

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
      });
    }
  }

  for (const bundle of bundles) {
    const bundleName = cleanString(bundle.name) || `Bundle ${bundle.id}`;
    const bundlePublicName = cleanString(bundle.public_name);
    const bundleDisplay = cleanString(bundle.display);
    const bundleCustomId = cleanString(bundle.custom_id);
    const bundleLabel = bundleDisplay || bundlePublicName || bundleName;

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
    const [products, bundles] = await Promise.all([
      fetchScalevPaginatedResults<ScalevProductApi>(business.api_key, 'products'),
      fetchScalevPaginatedResults<ScalevBundleApi>(business.api_key, 'bundles/simplified'),
    ]);

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

export async function syncScalevCatalogAllBusinesses() {
  await requireScalevCatalogAccess();
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, api_key, is_active')
    .eq('is_active', true)
    .not('api_key', 'is', null)
    .order('business_code', { ascending: true });

  if (error) throw error;

  const results: Array<Record<string, any>> = [];
  for (const business of (data || []) as ScalevBusinessConfig[]) {
    try {
      results.push(await performScalevCatalogSync(business, 'bulk'));
    } catch (syncError: any) {
      results.push({
        success: false,
        business_id: business.id,
        business_code: business.business_code,
        business_name: business.business_name,
        error: syncError?.message || 'Gagal sync katalog Scalev.',
      });
    }
  }

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
      .select('id, name, public_name, display, slug, item_type, is_inventory, is_multiple, is_listed_at_marketplace, variants_count, scalev_last_updated_at, last_synced_at')
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
      .select('id, name, product_name, sku, scalev_variant_unique_id, scalev_variant_uuid, option1_value, option2_value, option3_value, item_type, last_synced_at')
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
      .select('id, name, public_name, display, custom_id, weight_bump, is_bundle_sharing, price_options_count, last_synced_at')
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
    .select('id, identifier, source, entity_type, entity_label, last_synced_at')
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
