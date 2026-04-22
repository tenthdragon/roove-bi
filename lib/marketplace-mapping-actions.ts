'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import { requireDashboardRoles } from '@/lib/dashboard-access';

type MarketplaceUploadSourceRow = {
  id: number;
  source_key: string;
  source_label: string;
  platform: 'shopee' | 'tiktok' | 'lazada' | 'blibli';
  business_id: number;
  business_code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type MarketplaceUploadSourceStoreRow = {
  id: number;
  source_id: number;
  store_name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type MarketplaceStoreMappingRuleRow = {
  id: number;
  source_id: number;
  source_store_id: number;
  business_id: number;
  business_code: string;
  match_field: 'sku' | 'product_name';
  match_type: 'exact' | 'prefix' | 'contains';
  match_value: string;
  match_value_normalized: string;
  target_entity_type: 'product' | 'variant' | 'bundle' | null;
  target_entity_key: string | null;
  scalev_product_id: number | null;
  scalev_variant_id: number | null;
  scalev_bundle_id: number | null;
  target_entity_label: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getMissingSchemaMessage() {
  return 'Tabel marketplace mapping belum tersedia. Jalankan migration 118 terlebih dahulu.';
}

async function requireOwner(label: string) {
  const { profile } = await requireDashboardRoles(['owner'], `Hanya owner yang bisa mengakses ${label}.`);
  return profile;
}

async function getSourceOrThrow(sourceId: number) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_upload_sources')
    .select('id, source_key, source_label, platform, business_id, business_code, description, is_active, created_at, updated_at')
    .eq('id', sourceId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }
  if (!data) throw new Error('Source account marketplace tidak ditemukan.');
  return data as MarketplaceUploadSourceRow;
}

async function getSourceStoreOrThrow(sourceId: number, sourceStoreId: number) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_upload_source_stores')
    .select('id, source_id, store_name, sort_order, created_at, updated_at')
    .eq('id', sourceStoreId)
    .eq('source_id', sourceId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }
  if (!data) throw new Error('Store tujuan tidak termasuk daftar store yang diizinkan untuk source ini.');
  return data as MarketplaceUploadSourceStoreRow;
}

async function resolveCatalogEntity(input: { businessId: number; entityKey: string | null | undefined }) {
  const entityKey = String(input.entityKey || '').trim();
  if (!entityKey) {
    return {
      target_entity_type: null,
      target_entity_key: null,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: null,
      target_entity_label: null,
    };
  }

  const [entityType, rawId] = entityKey.split(':');
  const numericId = Number(rawId || 0);
  if (!entityType || !Number.isFinite(numericId) || numericId <= 0) {
    throw new Error('Entity katalog Scalev tidak valid.');
  }

  const svc = createServiceSupabase();

  if (entityType === 'variant') {
    const { data, error } = await svc
      .from('scalev_catalog_variants')
      .select('scalev_product_id, scalev_variant_id, name, product_name, sku')
      .eq('business_id', input.businessId)
      .eq('scalev_variant_id', numericId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Variant Scalev tidak ditemukan untuk business ini.');

    const labelParts = [data.product_name, data.name, data.sku ? `[${data.sku}]` : null].filter(Boolean);
    return {
      target_entity_type: 'variant' as const,
      target_entity_key: entityKey,
      scalev_product_id: Number(data.scalev_product_id || 0) || null,
      scalev_variant_id: Number(data.scalev_variant_id || 0) || null,
      scalev_bundle_id: null,
      target_entity_label: labelParts.join(' • ') || `Variant ${numericId}`,
    };
  }

  if (entityType === 'bundle') {
    const { data, error } = await svc
      .from('scalev_catalog_bundles')
      .select('scalev_bundle_id, name, public_name, display, custom_id')
      .eq('business_id', input.businessId)
      .eq('scalev_bundle_id', numericId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Bundle Scalev tidak ditemukan untuk business ini.');

    const primary = data.display || data.public_name || data.name || `Bundle ${numericId}`;
    const label = data.custom_id ? `${primary} • [${data.custom_id}]` : primary;
    return {
      target_entity_type: 'bundle' as const,
      target_entity_key: entityKey,
      scalev_product_id: null,
      scalev_variant_id: null,
      scalev_bundle_id: Number(data.scalev_bundle_id || 0) || null,
      target_entity_label: label,
    };
  }

  if (entityType === 'product') {
    const { data, error } = await svc
      .from('scalev_catalog_products')
      .select('scalev_product_id, name, public_name, display, slug')
      .eq('business_id', input.businessId)
      .eq('scalev_product_id', numericId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Product Scalev tidak ditemukan untuk business ini.');

    const primary = data.display || data.public_name || data.name || `Product ${numericId}`;
    const label = data.slug ? `${primary} • [${data.slug}]` : primary;
    return {
      target_entity_type: 'product' as const,
      target_entity_key: entityKey,
      scalev_product_id: Number(data.scalev_product_id || 0) || null,
      scalev_variant_id: null,
      scalev_bundle_id: null,
      target_entity_label: label,
    };
  }

  throw new Error('Tipe entity Scalev tidak didukung.');
}

export async function getMarketplaceMappingSnapshot() {
  await requireOwner('Marketplace Mapping');
  const svc = createServiceSupabase();

  const [sourcesRes, storesRes, rulesRes] = await Promise.all([
    svc
      .from('marketplace_upload_sources')
      .select('id, source_key, source_label, platform, business_id, business_code, description, is_active, created_at, updated_at')
      .order('platform', { ascending: true })
      .order('source_label', { ascending: true }),
    svc
      .from('marketplace_upload_source_stores')
      .select('id, source_id, store_name, sort_order, created_at, updated_at')
      .order('source_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('store_name', { ascending: true }),
    svc
      .from('marketplace_store_mapping_rules')
      .select('*')
      .order('source_id', { ascending: true })
      .order('match_field', { ascending: true })
      .order('match_type', { ascending: true })
      .order('match_value', { ascending: true }),
  ]);

  for (const response of [sourcesRes, storesRes, rulesRes]) {
    if (response.error) {
      if (isMissingTableError(response.error)) throw new Error(getMissingSchemaMessage());
      throw response.error;
    }
  }

  const sources = (sourcesRes.data || []) as MarketplaceUploadSourceRow[];
  const stores = (storesRes.data || []) as MarketplaceUploadSourceStoreRow[];
  const rules = (rulesRes.data || []) as MarketplaceStoreMappingRuleRow[];

  const storesBySourceId = new Map<number, MarketplaceUploadSourceStoreRow[]>();
  for (const store of stores) {
    if (!storesBySourceId.has(store.source_id)) storesBySourceId.set(store.source_id, []);
    storesBySourceId.get(store.source_id)!.push(store);
  }

  const ruleCountBySourceId = new Map<number, number>();
  for (const rule of rules) {
    ruleCountBySourceId.set(rule.source_id, (ruleCountBySourceId.get(rule.source_id) || 0) + 1);
  }

  const sourceStoreById = new Map<number, MarketplaceUploadSourceStoreRow>();
  for (const store of stores) {
    sourceStoreById.set(store.id, store);
  }

  return {
    sources: sources.map((source) => ({
      ...source,
      stores: storesBySourceId.get(source.id) || [],
      rule_count: ruleCountBySourceId.get(source.id) || 0,
    })),
    rules: rules.map((rule) => ({
      ...rule,
      source_store_name: sourceStoreById.get(rule.source_store_id)?.store_name || null,
    })),
  };
}

export async function searchMarketplaceCatalogEntities(input: {
  sourceId: number;
  query: string;
}) {
  await requireOwner('Marketplace Mapping');
  const source = await getSourceOrThrow(Number(input.sourceId || 0));

  const rawQuery = String(input.query || '').trim();
  const normalizedQuery = normalizeIdentifier(rawQuery);
  if (rawQuery.length < 2 && normalizedQuery.length < 2) return [];

  const svc = createServiceSupabase();
  const searches: any[] = [];
  if (rawQuery.length >= 2) {
    searches.push(
      svc
        .from('scalev_catalog_identifiers')
        .select('entity_type, entity_key, entity_label, scalev_product_id, scalev_variant_id, scalev_bundle_id, identifier')
        .eq('business_id', source.business_id)
        .ilike('identifier', `%${rawQuery}%`)
        .limit(50),
      svc
        .from('scalev_catalog_identifiers')
        .select('entity_type, entity_key, entity_label, scalev_product_id, scalev_variant_id, scalev_bundle_id, identifier')
        .eq('business_id', source.business_id)
        .ilike('entity_label', `%${rawQuery}%`)
        .limit(50),
    );
  }
  if (normalizedQuery.length >= 2) {
    searches.push(
      svc
        .from('scalev_catalog_identifiers')
        .select('entity_type, entity_key, entity_label, scalev_product_id, scalev_variant_id, scalev_bundle_id, identifier')
        .eq('business_id', source.business_id)
        .ilike('identifier_normalized', `%${normalizedQuery}%`)
        .limit(50),
    );
  }

  if (searches.length === 0) return [];

  const responses = await Promise.all(searches);
  for (const response of responses) {
    if (response.error) throw response.error;
  }

  const grouped = new Map<string, {
    entity_type: 'product' | 'variant' | 'bundle';
    entity_key: string;
    entity_label: string;
    scalev_product_id: number | null;
    scalev_variant_id: number | null;
    scalev_bundle_id: number | null;
    identifiers: string[];
    search_score: number;
  }>();

  const addIdentifierRow = (row: any) => {
    const key = String(row.entity_key || '').trim();
    if (!key) return;
    if (!grouped.has(key)) {
      grouped.set(key, {
        entity_type: row.entity_type,
        entity_key: key,
        entity_label: row.entity_label,
        scalev_product_id: row.scalev_product_id != null ? Number(row.scalev_product_id) : null,
        scalev_variant_id: row.scalev_variant_id != null ? Number(row.scalev_variant_id) : null,
        scalev_bundle_id: row.scalev_bundle_id != null ? Number(row.scalev_bundle_id) : null,
        identifiers: [],
        search_score: 0,
      });
    }
    const current = grouped.get(key)!;
    const identifier = String(row.identifier || '').trim();
    if (identifier && !current.identifiers.includes(identifier)) current.identifiers.push(identifier);

    const normalizedLabel = normalizeIdentifier(current.entity_label);
    const normalizedIdentifier = normalizeIdentifier(identifier);
    let score = 0;
    if (normalizedLabel === normalizedQuery) score += 180;
    if (normalizedIdentifier === normalizedQuery) score += 220;
    if (normalizedIdentifier.startsWith(normalizedQuery) && normalizedQuery) score += 140;
    if (normalizedLabel.includes(normalizedQuery) && normalizedQuery) score += 120;
    if (String(current.entity_label || '').toLowerCase().includes(rawQuery.toLowerCase())) score += 90;
    if (identifier.toLowerCase().includes(rawQuery.toLowerCase())) score += 110;
    current.search_score = Math.max(current.search_score, score);
  };

  responses.forEach((response) => {
    for (const row of response.data || []) addIdentifierRow(row);
  });

  const variantIds = Array.from(new Set(
    Array.from(grouped.values())
      .filter((row) => row.entity_type === 'variant' && row.scalev_variant_id)
      .map((row) => Number(row.scalev_variant_id)),
  ));
  const bundleIds = Array.from(new Set(
    Array.from(grouped.values())
      .filter((row) => row.entity_type === 'bundle' && row.scalev_bundle_id)
      .map((row) => Number(row.scalev_bundle_id)),
  ));
  const productIds = Array.from(new Set(
    Array.from(grouped.values())
      .filter((row) => row.entity_type === 'product' && row.scalev_product_id)
      .map((row) => Number(row.scalev_product_id)),
  ));

  const [variantRes, bundleRes, productRes] = await Promise.all([
    variantIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : svc
          .from('scalev_catalog_variants')
          .select('scalev_variant_id, product_name, name, sku')
          .eq('business_id', source.business_id)
          .in('scalev_variant_id', variantIds),
    bundleIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : svc
          .from('scalev_catalog_bundles')
          .select('scalev_bundle_id, name, public_name, display, custom_id')
          .eq('business_id', source.business_id)
          .in('scalev_bundle_id', bundleIds),
    productIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : svc
          .from('scalev_catalog_products')
          .select('scalev_product_id, name, public_name, display, slug')
          .eq('business_id', source.business_id)
          .in('scalev_product_id', productIds),
  ]);

  for (const response of [variantRes, bundleRes, productRes]) {
    if (response.error) throw response.error;
  }

  const variantById = new Map<number, any>((variantRes.data || []).map((row: any) => [Number(row.scalev_variant_id), row]));
  const bundleById = new Map<number, any>((bundleRes.data || []).map((row: any) => [Number(row.scalev_bundle_id), row]));
  const productById = new Map<number, any>((productRes.data || []).map((row: any) => [Number(row.scalev_product_id), row]));

  return Array.from(grouped.values())
    .map((row) => {
      let label = row.entity_label;
      let secondaryLabel: string | null = null;

      if (row.entity_type === 'variant' && row.scalev_variant_id) {
        const variant = variantById.get(Number(row.scalev_variant_id));
        if (variant) {
          label = variant.name || row.entity_label;
          secondaryLabel = [variant.product_name, variant.sku ? `[${variant.sku}]` : null].filter(Boolean).join(' • ') || null;
        }
      } else if (row.entity_type === 'bundle' && row.scalev_bundle_id) {
        const bundle = bundleById.get(Number(row.scalev_bundle_id));
        if (bundle) {
          label = bundle.display || bundle.public_name || bundle.name || row.entity_label;
          secondaryLabel = bundle.custom_id ? `[${bundle.custom_id}]` : null;
        }
      } else if (row.entity_type === 'product' && row.scalev_product_id) {
        const product = productById.get(Number(row.scalev_product_id));
        if (product) {
          label = product.display || product.public_name || product.name || row.entity_label;
          secondaryLabel = product.slug ? `[${product.slug}]` : null;
        }
      }

      return {
        ...row,
        entity_label: label,
        secondary_label: secondaryLabel,
        identifiers_preview: row.identifiers.slice(0, 5),
      };
    })
    .sort((left, right) => {
      if (right.search_score !== left.search_score) return right.search_score - left.search_score;
      return String(left.entity_label || '').localeCompare(String(right.entity_label || ''));
    })
    .slice(0, 24);
}

export async function saveMarketplaceStoreMappingRule(input: {
  id?: number;
  sourceId: number;
  sourceStoreId: number;
  matchField: 'sku' | 'product_name';
  matchType: 'exact' | 'prefix' | 'contains';
  matchValue: string;
  targetEntityKey?: string | null;
  notes?: string | null;
  isActive?: boolean;
}) {
  await requireOwner('Marketplace Mapping');

  const sourceId = Number(input.sourceId || 0);
  const sourceStoreId = Number(input.sourceStoreId || 0);
  if (!sourceId || !sourceStoreId) {
    throw new Error('Source account dan store tujuan wajib dipilih.');
  }

  if (!['sku', 'product_name'].includes(String(input.matchField))) {
    throw new Error('Field mapping tidak valid.');
  }
  if (!['exact', 'prefix', 'contains'].includes(String(input.matchType))) {
    throw new Error('Jenis pencocokan tidak valid.');
  }

  const matchValue = String(input.matchValue || '').trim();
  const matchValueNormalized = normalizeIdentifier(matchValue);
  if (!matchValue || !matchValueNormalized) {
    throw new Error('Nilai SKU / nama produk untuk mapping wajib diisi.');
  }

  const source = await getSourceOrThrow(sourceId);
  await getSourceStoreOrThrow(sourceId, sourceStoreId);

  const resolvedEntity = await resolveCatalogEntity({
    businessId: source.business_id,
    entityKey: input.targetEntityKey,
  });

  const payload = {
    source_id: source.id,
    source_store_id: sourceStoreId,
    business_id: source.business_id,
    business_code: source.business_code,
    match_field: input.matchField,
    match_type: input.matchType,
    match_value: matchValue,
    match_value_normalized: matchValueNormalized,
    target_entity_type: resolvedEntity.target_entity_type,
    target_entity_key: resolvedEntity.target_entity_key,
    scalev_product_id: resolvedEntity.scalev_product_id,
    scalev_variant_id: resolvedEntity.scalev_variant_id,
    scalev_bundle_id: resolvedEntity.scalev_bundle_id,
    target_entity_label: resolvedEntity.target_entity_label,
    notes: cleanText(input.notes),
    is_active: input.isActive !== false,
  };

  const svc = createServiceSupabase();
  if (input.id) {
    const { error } = await svc
      .from('marketplace_store_mapping_rules')
      .update(payload)
      .eq('id', Number(input.id));

    if (error) {
      if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
      if (error.code === '23505') throw new Error('Rule dengan field, tipe, dan nilai yang sama sudah ada di source ini.');
      throw error;
    }
  } else {
    const { error } = await svc
      .from('marketplace_store_mapping_rules')
      .insert(payload);

    if (error) {
      if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
      if (error.code === '23505') throw new Error('Rule dengan field, tipe, dan nilai yang sama sudah ada di source ini.');
      throw error;
    }
  }

  return { success: true };
}

export async function toggleMarketplaceStoreMappingRule(ruleId: number, isActive: boolean) {
  await requireOwner('Marketplace Mapping');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('marketplace_store_mapping_rules')
    .update({ is_active: Boolean(isActive) })
    .eq('id', Number(ruleId || 0));

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  return { success: true };
}

export async function deleteMarketplaceStoreMappingRule(ruleId: number) {
  await requireOwner('Marketplace Mapping');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('marketplace_store_mapping_rules')
    .delete()
    .eq('id', Number(ruleId || 0));

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  return { success: true };
}
