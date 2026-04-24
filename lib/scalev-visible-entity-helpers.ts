import { createServiceSupabase } from './supabase-server';

export type ScalevVisibilityKind = 'owned' | 'shared';

export type VisibleCatalogMetadata = {
  viewer_business_id: number;
  viewer_business_code: string;
  owner_business_id: number;
  owner_business_code: string;
  processor_business_id: number;
  processor_business_code: string;
  visibility_kind: ScalevVisibilityKind;
};

export type VisibleDirectCatalogEntityRow = VisibleCatalogMetadata & {
  business_id: number;
  business_code: string;
  entity_type: 'product' | 'variant';
  entity_key: string;
  scalev_product_id: number;
  scalev_variant_id: number | null;
  label: string;
  secondary_label: string | null;
  sku: string | null;
  item_type: string | null;
  identifiers: string[];
};

export type VisibleBundleCatalogEntityRow = VisibleCatalogMetadata & {
  business_id: number;
  business_code: string;
  entity_type: 'bundle';
  entity_key: string;
  scalev_bundle_id: number;
  label: string;
  secondary_label: string | null;
  custom_id: string | null;
  is_bundle_sharing: boolean;
  identifiers: string[];
  last_synced_at: string | null;
};

export type CanonicalCatalogMappingRow = {
  id: number | null;
  business_id: number;
  business_code: string | null;
  scalev_entity_key: string;
  scalev_entity_type: 'product' | 'variant' | null;
  warehouse_product_id: number | null;
  mapping_source: string | null;
  notes: string | null;
  warehouse_products: {
    id: number;
    name: string | null;
    category: string | null;
    entity: string | null;
    warehouse: string | null;
    scalev_product_names?: string[] | null;
  } | null;
};

type VisibleEntityLike = {
  visibility_kind?: unknown;
  visibilityKind?: unknown;
  is_shared?: unknown;
  isShared?: unknown;
  owner_business_id?: unknown;
  ownerBusinessId?: unknown;
  owner_business_code?: unknown;
  ownerBusinessCode?: unknown;
  owner_business?: unknown;
  ownerBusiness?: unknown;
  processor_business_id?: unknown;
  processorBusinessId?: unknown;
  processor_business_code?: unknown;
  processorBusinessCode?: unknown;
  processor_business?: unknown;
  processorBusiness?: unknown;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
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

function parsePositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'object') {
      const nested = parsePositiveNumber(
        (value as any).id,
        (value as any).business_id,
        (value as any).businessId,
      );
      if (nested != null) return nested;
      continue;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return null;
}

function parseBusinessCode(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    if (typeof value === 'object') {
      const nested = parseBusinessCode(
        (value as any).business_code,
        (value as any).businessCode,
        (value as any).code,
        (value as any).short_code,
      );
      if (nested) return nested;
      continue;
    }

    const text = cleanString(value);
    if (text) return text;
  }

  return null;
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function buildIdentifierMap(rows: any[]) {
  const identifiersByEntityKey = new Map<string, string[]>();
  for (const row of rows) {
    const entityKey = String(row.entity_key || '').trim();
    const identifier = String(row.identifier || '').trim();
    if (!entityKey || !identifier) continue;
    if (!identifiersByEntityKey.has(entityKey)) identifiersByEntityKey.set(entityKey, []);
    identifiersByEntityKey.get(entityKey)!.push(identifier);
  }

  return identifiersByEntityKey;
}

function buildEntityKeyIdSets(
  entityKeys?: string[] | null,
  productIds?: number[] | null,
  variantIds?: number[] | null,
) {
  const normalizedProductIds = new Set<number>(
    (productIds || [])
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  const normalizedVariantIds = new Set<number>(
    (variantIds || [])
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  );

  for (const entityKey of entityKeys || []) {
    const [entityType, rawId] = String(entityKey || '').split(':');
    const entityId = Number(rawId || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) continue;
    if (entityType === 'product') normalizedProductIds.add(entityId);
    if (entityType === 'variant') normalizedVariantIds.add(entityId);
  }

  return {
    productIds: Array.from(normalizedProductIds),
    variantIds: Array.from(normalizedVariantIds),
  };
}

export function dedupeIdentifiers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const raw = cleanString(value);
    if (!raw) continue;
    const normalized = normalizeIdentifier(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(raw);
  }

  return results;
}

export function normalizeScalevVisibilityKind(
  rawValue: unknown,
  viewerBusinessCode: string,
  ownerBusinessCode: string,
  processorBusinessCode: string,
): ScalevVisibilityKind {
  const normalized = String(rawValue ?? '').trim().toLowerCase();
  if (normalized === 'shared') return 'shared';
  if (normalized === 'owned') return 'owned';

  if (
    (ownerBusinessCode && viewerBusinessCode && ownerBusinessCode !== viewerBusinessCode)
    || (processorBusinessCode && viewerBusinessCode && processorBusinessCode !== viewerBusinessCode)
  ) {
    return 'shared';
  }

  if (rawValue === true) return 'shared';
  return 'owned';
}

export function extractVisibleCatalogMetadata(args: {
  viewerBusinessId: number;
  viewerBusinessCode: string;
  source?: VisibleEntityLike | null;
  fallback?: Partial<VisibleCatalogMetadata> | null;
}): VisibleCatalogMetadata {
  const source = args.source || {};
  const fallback = args.fallback || null;
  const viewerBusinessId = Number(args.viewerBusinessId || fallback?.viewer_business_id || 0);
  const viewerBusinessCode = cleanString(args.viewerBusinessCode || fallback?.viewer_business_code) || '';

  const ownerBusinessId = parsePositiveNumber(
    (source as any).owner_business_id,
    (source as any).ownerBusinessId,
    (source as any).owner_business,
    (source as any).ownerBusiness,
    fallback?.owner_business_id,
    viewerBusinessId,
  ) || viewerBusinessId;
  const ownerBusinessCode = parseBusinessCode(
    (source as any).owner_business_code,
    (source as any).ownerBusinessCode,
    (source as any).owner_business,
    (source as any).ownerBusiness,
    fallback?.owner_business_code,
    ownerBusinessId === viewerBusinessId ? viewerBusinessCode : null,
    viewerBusinessCode,
  ) || viewerBusinessCode;

  const processorBusinessId = parsePositiveNumber(
    (source as any).processor_business_id,
    (source as any).processorBusinessId,
    (source as any).processor_business,
    (source as any).processorBusiness,
    fallback?.processor_business_id,
    ownerBusinessId,
    viewerBusinessId,
  ) || ownerBusinessId;
  const processorBusinessCode = parseBusinessCode(
    (source as any).processor_business_code,
    (source as any).processorBusinessCode,
    (source as any).processor_business,
    (source as any).processorBusiness,
    fallback?.processor_business_code,
    processorBusinessId === ownerBusinessId ? ownerBusinessCode : null,
    processorBusinessId === viewerBusinessId ? viewerBusinessCode : null,
    ownerBusinessCode,
    viewerBusinessCode,
  ) || ownerBusinessCode;

  return {
    viewer_business_id: viewerBusinessId,
    viewer_business_code: viewerBusinessCode,
    owner_business_id: ownerBusinessId,
    owner_business_code: ownerBusinessCode,
    processor_business_id: processorBusinessId,
    processor_business_code: processorBusinessCode,
    visibility_kind: normalizeScalevVisibilityKind(
      (source as any).visibility_kind ?? (source as any).visibilityKind ?? (source as any).is_shared ?? (source as any).isShared,
      viewerBusinessCode,
      ownerBusinessCode,
      processorBusinessCode,
    ),
  };
}

export function buildCanonicalMappingLookupKey(businessId: number, entityKey: string) {
  return `${Number(businessId || 0)}:${String(entityKey || '').trim()}`;
}

export function buildViewerEntityLookupKey(businessId: number, entityKey: string) {
  return `${Number(businessId || 0)}:${String(entityKey || '').trim()}`;
}

export async function fetchVisibleDirectCatalogEntities(
  svc: ReturnType<typeof createServiceSupabase>,
  businessId: number,
  options?: {
    entityKeys?: string[] | null;
    productIds?: number[] | null;
    variantIds?: number[] | null;
    includeProductsWithVariants?: boolean;
  },
): Promise<{ businessCode: string; rows: VisibleDirectCatalogEntityRow[] }> {
  const requestedBusinessId = Number(businessId || 0);
  if (!Number.isFinite(requestedBusinessId) || requestedBusinessId <= 0) {
    return { businessCode: '', rows: [] };
  }

  const { productIds, variantIds } = buildEntityKeyIdSets(
    options?.entityKeys,
    options?.productIds,
    options?.variantIds,
  );

  const variantRows: any[] = [];
  if (variantIds.length > 0) {
    for (const chunk of chunkArray(variantIds, 500)) {
      const { data, error } = await svc
        .from('scalev_catalog_variants')
        .select(`
          business_id,
          business_code,
          scalev_product_id,
          scalev_variant_id,
          name,
          product_name,
          sku,
          item_type,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .in('scalev_variant_id', chunk);
      if (error) throw error;
      variantRows.push(...((data || []) as any[]));
    }
  } else {
    const rows = await fetchAllPages<any>((from, to) => (
      svc
        .from('scalev_catalog_variants')
        .select(`
          business_id,
          business_code,
          scalev_product_id,
          scalev_variant_id,
          name,
          product_name,
          sku,
          item_type,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .order('product_name', { ascending: true })
        .order('name', { ascending: true })
        .range(from, to)
    ));
    variantRows.push(...rows);
  }

  const productRows: any[] = [];
  if (productIds.length > 0) {
    for (const chunk of chunkArray(productIds, 500)) {
      const { data, error } = await svc
        .from('scalev_catalog_products')
        .select(`
          business_id,
          business_code,
          scalev_product_id,
          name,
          public_name,
          display,
          slug,
          item_type,
          variants_count,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .in('scalev_product_id', chunk);
      if (error) throw error;
      productRows.push(...((data || []) as any[]));
    }
  } else {
    const rows = await fetchAllPages<any>((from, to) => (
      svc
        .from('scalev_catalog_products')
        .select(`
          business_id,
          business_code,
          scalev_product_id,
          name,
          public_name,
          display,
          slug,
          item_type,
          variants_count,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .order('name', { ascending: true })
        .range(from, to)
    ));
    productRows.push(...rows);
  }

  const businessCode = cleanString(
    variantRows[0]?.business_code || productRows[0]?.business_code,
  ) || '';

  const directEntityKeys = [
    ...variantRows.map((row) => `variant:${row.scalev_variant_id}`),
    ...productRows.map((row) => `product:${row.scalev_product_id}`),
  ];
  const identifiers: any[] = [];
  for (const chunk of chunkArray(directEntityKeys, 500)) {
    if (chunk.length === 0) continue;
    const { data, error } = await svc
      .from('scalev_catalog_identifiers')
      .select('entity_key, identifier')
      .eq('business_id', requestedBusinessId)
      .in('entity_key', chunk);
    if (error) throw error;
    identifiers.push(...((data || []) as any[]));
  }
  const identifiersByEntityKey = buildIdentifierMap(identifiers);

  const rows: VisibleDirectCatalogEntityRow[] = [];
  for (const variant of variantRows) {
    const entityKey = `variant:${variant.scalev_variant_id}`;
    const visibility = extractVisibleCatalogMetadata({
      viewerBusinessId: requestedBusinessId,
      viewerBusinessCode: businessCode || cleanString(variant.business_code) || '',
      source: variant,
    });
    rows.push({
      ...visibility,
      business_id: requestedBusinessId,
      business_code: visibility.viewer_business_code,
      entity_type: 'variant',
      entity_key: entityKey,
      scalev_product_id: Number(variant.scalev_product_id),
      scalev_variant_id: Number(variant.scalev_variant_id),
      label: cleanString(variant.name) || cleanString(variant.product_name) || `Variant ${variant.scalev_variant_id}`,
      secondary_label: cleanString(variant.product_name),
      sku: cleanString(variant.sku),
      item_type: cleanString(variant.item_type),
      identifiers: dedupeIdentifiers([
        cleanString(variant.name),
        cleanString(variant.product_name),
        cleanString(variant.sku),
        ...(identifiersByEntityKey.get(entityKey) || []),
      ]),
    });
  }

  for (const product of productRows) {
    if (!options?.includeProductsWithVariants && Number(product.variants_count || 0) > 0) continue;

    const entityKey = `product:${product.scalev_product_id}`;
    const visibility = extractVisibleCatalogMetadata({
      viewerBusinessId: requestedBusinessId,
      viewerBusinessCode: businessCode || cleanString(product.business_code) || '',
      source: product,
    });
    const label = cleanString(product.display) || cleanString(product.public_name) || cleanString(product.name) || `Product ${product.scalev_product_id}`;
    rows.push({
      ...visibility,
      business_id: requestedBusinessId,
      business_code: visibility.viewer_business_code,
      entity_type: 'product',
      entity_key: entityKey,
      scalev_product_id: Number(product.scalev_product_id),
      scalev_variant_id: null,
      label,
      secondary_label: (cleanString(product.name) && cleanString(product.name) !== label ? cleanString(product.name) : cleanString(product.public_name)) || null,
      sku: null,
      item_type: cleanString(product.item_type),
      identifiers: dedupeIdentifiers([
        cleanString(product.name),
        cleanString(product.public_name),
        cleanString(product.display),
        cleanString(product.slug),
        ...(identifiersByEntityKey.get(entityKey) || []),
      ]),
    });
  }

  rows.sort((left, right) => {
    const leftKey = `${left.secondary_label || left.label} ${left.label}`;
    const rightKey = `${right.secondary_label || right.label} ${right.label}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    businessCode,
    rows,
  };
}

export async function fetchVisibleDirectCatalogEntitiesByBusinessRequests(
  svc: ReturnType<typeof createServiceSupabase>,
  requests: Map<number, { variantIds?: Set<number>; productIds?: Set<number> }>,
  options?: { includeProductsWithVariants?: boolean },
): Promise<VisibleDirectCatalogEntityRow[]> {
  const rows: VisibleDirectCatalogEntityRow[] = [];

  for (const [businessId, request] of Array.from(requests.entries())) {
    const response = await fetchVisibleDirectCatalogEntities(svc, businessId, {
      variantIds: Array.from(request.variantIds || []),
      productIds: Array.from(request.productIds || []),
      includeProductsWithVariants: options?.includeProductsWithVariants,
    });
    rows.push(...response.rows);
  }

  return rows;
}

export function buildVisibleDirectEntityLookup(rows: VisibleDirectCatalogEntityRow[]) {
  const lookup = new Map<string, VisibleDirectCatalogEntityRow>();
  for (const row of rows) {
    lookup.set(buildViewerEntityLookupKey(row.viewer_business_id, row.entity_key), row);
  }
  return lookup;
}

export async function fetchVisibleBundleCatalogEntities(
  svc: ReturnType<typeof createServiceSupabase>,
  businessId: number,
  options?: { entityKeys?: string[] | null; bundleIds?: number[] | null },
): Promise<{ businessCode: string; rows: VisibleBundleCatalogEntityRow[] }> {
  const requestedBusinessId = Number(businessId || 0);
  if (!Number.isFinite(requestedBusinessId) || requestedBusinessId <= 0) {
    return { businessCode: '', rows: [] };
  }

  const requestedBundleIds = new Set<number>(
    (options?.bundleIds || [])
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  for (const entityKey of options?.entityKeys || []) {
    const [entityType, rawId] = String(entityKey || '').split(':');
    const entityId = Number(rawId || 0);
    if (entityType === 'bundle' && Number.isFinite(entityId) && entityId > 0) {
      requestedBundleIds.add(entityId);
    }
  }

  const bundleRows: any[] = [];
  const bundleIds = Array.from(requestedBundleIds);
  if (bundleIds.length > 0) {
    for (const chunk of chunkArray(bundleIds, 500)) {
      const { data, error } = await svc
        .from('scalev_catalog_bundles')
        .select(`
          business_id,
          business_code,
          scalev_bundle_id,
          name,
          public_name,
          display,
          custom_id,
          is_bundle_sharing,
          last_synced_at,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .in('scalev_bundle_id', chunk);
      if (error) throw error;
      bundleRows.push(...((data || []) as any[]));
    }
  } else {
    const rows = await fetchAllPages<any>((from, to) => (
      svc
        .from('scalev_catalog_bundles')
        .select(`
          business_id,
          business_code,
          scalev_bundle_id,
          name,
          public_name,
          display,
          custom_id,
          is_bundle_sharing,
          last_synced_at,
          visibility_kind,
          owner_business_id,
          owner_business_code,
          processor_business_id,
          processor_business_code
        `)
        .eq('business_id', requestedBusinessId)
        .order('name', { ascending: true })
        .range(from, to)
    ));
    bundleRows.push(...rows);
  }

  const businessCode = cleanString(bundleRows[0]?.business_code) || '';
  const bundleEntityKeys = bundleRows.map((row) => `bundle:${row.scalev_bundle_id}`);
  const identifiers: any[] = [];
  for (const chunk of chunkArray(bundleEntityKeys, 500)) {
    if (chunk.length === 0) continue;
    const { data, error } = await svc
      .from('scalev_catalog_identifiers')
      .select('entity_key, identifier')
      .eq('business_id', requestedBusinessId)
      .eq('entity_type', 'bundle')
      .in('entity_key', chunk);
    if (error) throw error;
    identifiers.push(...((data || []) as any[]));
  }
  const identifiersByEntityKey = buildIdentifierMap(identifiers);

  const rows: VisibleBundleCatalogEntityRow[] = bundleRows.map((bundle) => {
    const entityKey = `bundle:${bundle.scalev_bundle_id}`;
    const visibility = extractVisibleCatalogMetadata({
      viewerBusinessId: requestedBusinessId,
      viewerBusinessCode: businessCode || cleanString(bundle.business_code) || '',
      source: bundle,
    });
    const label = cleanString(bundle.display) || cleanString(bundle.public_name) || cleanString(bundle.name) || `Bundle ${bundle.scalev_bundle_id}`;
    return {
      ...visibility,
      business_id: requestedBusinessId,
      business_code: visibility.viewer_business_code,
      entity_type: 'bundle',
      entity_key: entityKey,
      scalev_bundle_id: Number(bundle.scalev_bundle_id),
      label,
      secondary_label: (cleanString(bundle.name) && cleanString(bundle.name) !== label ? cleanString(bundle.name) : cleanString(bundle.public_name)) || null,
      custom_id: cleanString(bundle.custom_id),
      is_bundle_sharing: Boolean(bundle.is_bundle_sharing),
      identifiers: dedupeIdentifiers([
        cleanString(bundle.name),
        cleanString(bundle.public_name),
        cleanString(bundle.display),
        cleanString(bundle.custom_id),
        ...(identifiersByEntityKey.get(entityKey) || []),
      ]),
      last_synced_at: cleanString(bundle.last_synced_at),
    };
  });

  return {
    businessCode,
    rows,
  };
}

export async function fetchCanonicalCatalogMappingsByRequests(
  svc: ReturnType<typeof createServiceSupabase>,
  requestsByBusinessId: Map<number, Set<string>>,
): Promise<CanonicalCatalogMappingRow[]> {
  const rows: CanonicalCatalogMappingRow[] = [];

  for (const [businessId, entityKeys] of Array.from(requestsByBusinessId.entries())) {
    const normalizedBusinessId = Number(businessId || 0);
    const normalizedKeys = Array.from(entityKeys || []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!Number.isFinite(normalizedBusinessId) || normalizedBusinessId <= 0 || normalizedKeys.length === 0) {
      continue;
    }

    for (const chunk of chunkArray(normalizedKeys, 500)) {
      const { data, error } = await svc
        .from('warehouse_scalev_catalog_mapping')
        .select(`
          id,
          business_id,
          business_code,
          scalev_entity_key,
          scalev_entity_type,
          warehouse_product_id,
          mapping_source,
          notes,
          warehouse_products(id, name, category, entity, warehouse, scalev_product_names)
        `)
        .eq('business_id', normalizedBusinessId)
        .in('scalev_entity_key', chunk);
      if (error) throw error;

      for (const row of (data || []) as any[]) {
        const rawWarehouseProduct = Array.isArray(row.warehouse_products)
          ? row.warehouse_products[0] || null
          : row.warehouse_products || null;
        rows.push({
          id: row.id != null ? Number(row.id) : null,
          business_id: Number(row.business_id),
          business_code: cleanString(row.business_code),
          scalev_entity_key: String(row.scalev_entity_key || ''),
          scalev_entity_type: row.scalev_entity_type === 'product' || row.scalev_entity_type === 'variant'
            ? row.scalev_entity_type
            : null,
          warehouse_product_id: row.warehouse_product_id != null ? Number(row.warehouse_product_id) : null,
          mapping_source: cleanString(row.mapping_source),
          notes: cleanString(row.notes),
          warehouse_products: rawWarehouseProduct?.id
            ? {
                id: Number(rawWarehouseProduct.id),
                name: rawWarehouseProduct.name || null,
                category: rawWarehouseProduct.category || null,
                entity: rawWarehouseProduct.entity || null,
                warehouse: rawWarehouseProduct.warehouse || null,
                scalev_product_names: Array.isArray(rawWarehouseProduct.scalev_product_names)
                  ? rawWarehouseProduct.scalev_product_names
                  : [],
              }
            : null,
        });
      }
    }
  }

  return rows;
}
