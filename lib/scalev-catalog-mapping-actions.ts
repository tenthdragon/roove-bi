'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import {
  getWarehouseActivityLogChangedFields,
  recordWarehouseActivityLog,
} from '@/lib/warehouse-activity-log-actions';

type WarehouseProductLite = {
  id: number;
  name: string;
  category: string | null;
  entity: string | null;
  warehouse: string | null;
  scalev_product_names?: string[] | null;
};

type BusinessTarget = {
  deduct_entity: string | null;
  deduct_warehouse: string | null;
  is_active: boolean;
  notes: string | null;
};

type CatalogEntityRow = {
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

type RecommendationCandidate = {
  product: WarehouseProductLite;
  score: number;
  exactEvidenceCount: number;
  fuzzyScore: number;
  legacyMatches: Set<string>;
  aliasMatches: Set<string>;
  matchedIdentifiers: Set<string>;
  sourceBadges: Set<string>;
};

export type ScalevCatalogMappingRecommendation = {
  warehouse_product_id: number;
  warehouse_product_name: string;
  category: string | null;
  entity: string | null;
  warehouse: string | null;
  confidence: number;
  reason: string;
  source_badges: string[];
  matched_identifiers: string[];
};

export type ScalevCatalogMappingRow = {
  entity_type: 'product' | 'variant';
  entity_key: string;
  scalev_product_id: number;
  scalev_variant_id: number | null;
  label: string;
  secondary_label: string | null;
  sku: string | null;
  item_type: string | null;
  identifiers_count: number;
  identifiers_preview: string[];
  mapping_id: number | null;
  warehouse_product_id: number | null;
  warehouse_product: WarehouseProductLite | null;
  mapping_source: string | null;
  notes: string | null;
  status: 'mapped' | 'recommended' | 'unmapped';
  recommendation: ScalevCatalogMappingRecommendation | null;
};

export type ScalevCatalogMappingPayload = {
  business_id: number;
  business_code: string;
  business_target: BusinessTarget | null;
  rows: ScalevCatalogMappingRow[];
};

function normalizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeIdentifier(value)
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function formatWarehouseProductLabel(product: WarehouseProductLite | null | undefined) {
  if (!product?.id) return null;
  return `${product.name} [${product.warehouse || '-'}-${product.entity || '-'}]`;
}

function pickWarehouseProduct(value: any): WarehouseProductLite | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row?.id) return null;
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category || null,
    entity: row.entity || null,
    warehouse: row.warehouse || null,
  };
}

function scoreNameSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = tokenize(left || '');
  const rightTokens = tokenize(right || '');
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  let matches = 0;
  for (const leftToken of leftTokens) {
    if (rightTokens.some((rightToken) => rightToken.includes(leftToken) || leftToken.includes(rightToken))) {
      matches += 1;
    }
  }

  return matches / Math.max(leftTokens.length, rightTokens.length);
}

async function requireScalevCatalogMappingAccess(label = 'Product Mapping Scalev') {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:mapping', label);
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getMissingMappingSchemaMessage() {
  return 'Tabel product mapping Scalev belum tersedia. Jalankan migration 107 terlebih dahulu.';
}

function getBusinessTargetBoost(product: WarehouseProductLite, target: BusinessTarget | null): number {
  if (!target?.is_active) return 0;

  let boost = 0;
  if (target.deduct_entity && product.entity === target.deduct_entity) boost += 1.25;
  if (target.deduct_warehouse && product.warehouse === target.deduct_warehouse) boost += 0.5;
  return boost;
}

function buildRecommendationSummary(
  candidate: RecommendationCandidate,
  runnerUp: RecommendationCandidate | null,
  target: BusinessTarget | null,
): ScalevCatalogMappingRecommendation | null {
  const hasStructuredEvidence = candidate.exactEvidenceCount > 0;
  const margin = candidate.score - (runnerUp?.score || 0);

  let confidence = 0;
  if (hasStructuredEvidence) {
    confidence = Math.round(
      Math.min(
        98,
        58
          + candidate.exactEvidenceCount * 9
          + Math.min(candidate.legacyMatches.size + candidate.aliasMatches.size, 4) * 4
          + Math.max(0, Math.min(margin, 3)) * 5,
      ),
    );
  } else {
    confidence = Math.round(Math.min(84, Math.max(0, candidate.fuzzyScore) * 100));
  }

  if (runnerUp && margin < 0.65) {
    confidence = Math.max(0, confidence - 14);
  }

  if (hasStructuredEvidence && candidate.score < 5.25 && candidate.exactEvidenceCount < 2) {
    return null;
  }

  if (!hasStructuredEvidence && candidate.fuzzyScore < 0.46) {
    return null;
  }

  if (confidence < 56) {
    return null;
  }

  const reasons: string[] = [];
  if (candidate.legacyMatches.size > 0) {
    reasons.push(`legacy ${candidate.legacyMatches.size}x`);
  }
  if (candidate.aliasMatches.size > 0) {
    reasons.push(`alias gudang ${candidate.aliasMatches.size}x`);
  }
  if (!hasStructuredEvidence && candidate.fuzzyScore > 0) {
    reasons.push(`nama mirip ${Math.round(candidate.fuzzyScore * 100)}%`);
  }
  if (target?.is_active && target.deduct_entity && candidate.product.entity === target.deduct_entity) {
    reasons.push(`entity ${target.deduct_entity}`);
  }

  return {
    warehouse_product_id: candidate.product.id,
    warehouse_product_name: candidate.product.name,
    category: candidate.product.category,
    entity: candidate.product.entity,
    warehouse: candidate.product.warehouse,
    confidence,
    reason: reasons.join(' • ') || 'Rekomendasi otomatis',
    source_badges: Array.from(candidate.sourceBadges).slice(0, 3),
    matched_identifiers: Array.from(candidate.matchedIdentifiers).slice(0, 4),
  };
}

function buildRecommendationForEntity(input: {
  entity: CatalogEntityRow;
  businessTarget: BusinessTarget | null;
  legacyByNormalized: Map<string, Array<{ scalev_product_name: string; warehouse_product: WarehouseProductLite | null }>>;
  aliasByNormalized: Map<string, WarehouseProductLite[]>;
  warehouseProducts: WarehouseProductLite[];
  frequencyByNormalized: Map<string, number>;
}): ScalevCatalogMappingRecommendation | null {
  const candidates = new Map<number, RecommendationCandidate>();

  const touchCandidate = (
    product: WarehouseProductLite | null | undefined,
    mutation: {
      score: number;
      exactEvidence?: string | null;
      aliasEvidence?: string | null;
      matchedIdentifier?: string | null;
      badge?: string | null;
      fuzzyScore?: number;
    },
  ) => {
    if (!product?.id) return;

    if (!candidates.has(product.id)) {
      candidates.set(product.id, {
        product,
        score: 0,
        exactEvidenceCount: 0,
        fuzzyScore: 0,
        legacyMatches: new Set<string>(),
        aliasMatches: new Set<string>(),
        matchedIdentifiers: new Set<string>(),
        sourceBadges: new Set<string>(),
      });
    }

    const candidate = candidates.get(product.id)!;
    candidate.score += mutation.score + getBusinessTargetBoost(product, input.businessTarget);
    if (mutation.exactEvidence) {
      candidate.legacyMatches.add(mutation.exactEvidence);
      candidate.exactEvidenceCount += 1;
    }
    if (mutation.aliasEvidence) {
      candidate.aliasMatches.add(mutation.aliasEvidence);
      candidate.exactEvidenceCount += 1;
    }
    if (mutation.matchedIdentifier) {
      candidate.matchedIdentifiers.add(mutation.matchedIdentifier);
    }
    if (mutation.badge) {
      candidate.sourceBadges.add(mutation.badge);
    }
    if (mutation.fuzzyScore && mutation.fuzzyScore > candidate.fuzzyScore) {
      candidate.fuzzyScore = mutation.fuzzyScore;
    }
  };

  for (const identifier of input.entity.identifiers) {
    const normalized = normalizeIdentifier(identifier);
    if (!normalized) continue;

    for (const legacy of input.legacyByNormalized.get(normalized) || []) {
      const frequency = input.frequencyByNormalized.get(normalized) || 0;
      touchCandidate(legacy.warehouse_product, {
        score: 4.9 + Math.min(2.1, Math.log10(frequency + 1)),
        exactEvidence: legacy.scalev_product_name,
        matchedIdentifier: identifier,
        badge: 'Legacy map',
      });
    }

    for (const aliasProduct of input.aliasByNormalized.get(normalized) || []) {
      touchCandidate(aliasProduct, {
        score: 4.25,
        aliasEvidence: identifier,
        matchedIdentifier: identifier,
        badge: 'Alias gudang',
      });
    }
  }

  const fuzzyTargets = [input.entity.label, input.entity.secondary_label].filter(Boolean) as string[];
  for (const warehouseProduct of input.warehouseProducts) {
    const fuzzyScore = Math.max(
      ...fuzzyTargets.map((target) => scoreNameSimilarity(target, warehouseProduct.name)),
      0,
    );
    if (fuzzyScore < 0.46) continue;

    touchCandidate(warehouseProduct, {
      score: fuzzyScore * 3.2,
      matchedIdentifier: input.entity.label,
      badge: 'Nama mirip',
      fuzzyScore,
    });
  }

  const ranked = Array.from(candidates.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.exactEvidenceCount !== left.exactEvidenceCount) return right.exactEvidenceCount - left.exactEvidenceCount;
    return left.product.name.localeCompare(right.product.name);
  });

  if (ranked.length === 0) return null;

  return buildRecommendationSummary(ranked[0], ranked[1] || null, input.businessTarget);
}

function dedupeIdentifiers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = String(value || '').trim();
    if (!cleaned) continue;
    const normalized = normalizeIdentifier(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(cleaned);
  }
  return result;
}

async function getCatalogEntityRows(businessId: number): Promise<{ businessCode: string; rows: CatalogEntityRow[] }> {
  const svc = createServiceSupabase();
  const [{ data: products, error: productError }, { data: variants, error: variantError }] = await Promise.all([
    svc
      .from('scalev_catalog_products')
      .select('business_id, business_code, scalev_product_id, name, public_name, display, slug, item_type, variants_count')
      .eq('business_id', businessId)
      .order('name', { ascending: true }),
    svc
      .from('scalev_catalog_variants')
      .select('business_id, business_code, scalev_product_id, scalev_variant_id, name, product_name, sku, scalev_variant_unique_id, scalev_variant_uuid, item_type')
      .eq('business_id', businessId)
      .order('product_name', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (productError) throw productError;
  if (variantError) throw variantError;

  const rows: CatalogEntityRow[] = [];
  let businessCode = '';

  for (const variant of (variants || []) as any[]) {
    businessCode = businessCode || variant.business_code || '';
    rows.push({
      business_id: Number(variant.business_id),
      business_code: variant.business_code,
      entity_type: 'variant',
      entity_key: `variant:${variant.scalev_variant_id}`,
      scalev_product_id: Number(variant.scalev_product_id),
      scalev_variant_id: Number(variant.scalev_variant_id),
      label: variant.name,
      secondary_label: variant.product_name || null,
      sku: variant.sku || null,
      item_type: variant.item_type || null,
      identifiers: dedupeIdentifiers([
        variant.name,
        variant.product_name,
        variant.sku,
        variant.scalev_variant_unique_id,
        variant.scalev_variant_uuid,
      ]),
    });
  }

  for (const product of (products || []) as any[]) {
    businessCode = businessCode || product.business_code || '';
    if (Number(product.variants_count || 0) > 0) continue;

    const label = product.display || product.public_name || product.name;
    rows.push({
      business_id: Number(product.business_id),
      business_code: product.business_code,
      entity_type: 'product',
      entity_key: `product:${product.scalev_product_id}`,
      scalev_product_id: Number(product.scalev_product_id),
      scalev_variant_id: null,
      label,
      secondary_label: product.display && product.display !== product.name ? product.name : product.public_name || null,
      sku: null,
      item_type: product.item_type || null,
      identifiers: dedupeIdentifiers([
        product.name,
        product.public_name,
        product.display,
        product.slug,
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

export async function getScalevCatalogProductMappings(businessId: number): Promise<ScalevCatalogMappingPayload> {
  await requireScalevCatalogMappingAccess();
  const svc = createServiceSupabase();

  const { businessCode, rows } = await getCatalogEntityRows(businessId);

  const [{ data: identifiers, error: identifierError }, { data: mappings, error: mappingError }, { data: businessTargetRow, error: targetError }, { data: legacyMappings, error: legacyError }, { data: warehouseProducts, error: productError }, { data: frequencies }] = await Promise.all([
    svc
      .from('scalev_catalog_identifiers')
      .select('entity_key, identifier, identifier_normalized')
      .eq('business_id', businessId),
    svc
      .from('warehouse_scalev_catalog_mapping')
      .select(`
        id,
        business_id,
        scalev_entity_type,
        scalev_entity_key,
        scalev_product_id,
        scalev_variant_id,
        scalev_entity_label,
        warehouse_product_id,
        mapping_source,
        notes,
        warehouse_products(id, name, category, entity, warehouse)
      `)
      .eq('business_id', businessId),
    businessCode
      ? svc
          .from('warehouse_business_mapping')
          .select('deduct_entity, deduct_warehouse, is_active, notes')
          .eq('business_code', businessCode)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    svc
      .from('warehouse_scalev_mapping')
      .select(`
        scalev_product_name,
        warehouse_product_id,
        warehouse_products(id, name, category, entity, warehouse)
      `)
      .not('warehouse_product_id', 'is', null)
      .eq('is_ignored', false),
    svc
      .from('warehouse_products')
      .select('id, name, category, entity, warehouse, scalev_product_names')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true }),
    svc.rpc('warehouse_scalev_mapping_frequencies'),
  ]);

  if (identifierError) throw identifierError;
  if (mappingError) {
    if (isMissingTableError(mappingError)) {
      throw new Error(getMissingMappingSchemaMessage());
    }
    throw mappingError;
  }
  if (targetError) throw targetError;
  if (legacyError) throw legacyError;
  if (productError) throw productError;

  const businessTarget: BusinessTarget | null = businessTargetRow
    ? {
        deduct_entity: businessTargetRow.deduct_entity || null,
        deduct_warehouse: businessTargetRow.deduct_warehouse || null,
        is_active: Boolean(businessTargetRow.is_active),
        notes: businessTargetRow.notes || null,
      }
    : null;

  const identifiersByEntityKey = new Map<string, string[]>();
  for (const row of (identifiers || []) as any[]) {
    const key = String(row.entity_key || '');
    if (!identifiersByEntityKey.has(key)) identifiersByEntityKey.set(key, []);
    identifiersByEntityKey.get(key)!.push(row.identifier);
  }

  const mappingByEntityKey = new Map<string, any>();
  for (const row of (mappings || []) as any[]) {
    mappingByEntityKey.set(row.scalev_entity_key, row);
  }

  const legacyByNormalized = new Map<string, Array<{ scalev_product_name: string; warehouse_product: WarehouseProductLite | null }>>();
  for (const row of (legacyMappings || []) as any[]) {
    const normalized = normalizeIdentifier(row.scalev_product_name);
    if (!normalized) continue;
    if (!legacyByNormalized.has(normalized)) legacyByNormalized.set(normalized, []);
    legacyByNormalized.get(normalized)!.push({
      scalev_product_name: row.scalev_product_name,
      warehouse_product: row.warehouse_products
        ? {
            id: Number(row.warehouse_products.id),
            name: row.warehouse_products.name,
            category: row.warehouse_products.category || null,
            entity: row.warehouse_products.entity || null,
            warehouse: row.warehouse_products.warehouse || null,
          }
        : null,
    });
  }

  const normalizedAliasMap = new Map<string, WarehouseProductLite[]>();
  for (const product of (warehouseProducts || []) as any[]) {
    const normalizedAliases = dedupeIdentifiers(product.scalev_product_names || []);
    for (const alias of normalizedAliases) {
      const normalized = normalizeIdentifier(alias);
      if (!normalizedAliasMap.has(normalized)) normalizedAliasMap.set(normalized, []);
      normalizedAliasMap.get(normalized)!.push({
        id: Number(product.id),
        name: product.name,
        category: product.category || null,
        entity: product.entity || null,
        warehouse: product.warehouse || null,
      });
    }
  }

  const frequencyByNormalized = new Map<string, number>();
  for (const row of (frequencies || []) as any[]) {
    frequencyByNormalized.set(normalizeIdentifier(row.product_name), Number(row.cnt || 0));
  }

  const warehouseProductRows = (warehouseProducts || []).map((product: any) => ({
    id: Number(product.id),
    name: product.name,
    category: product.category || null,
    entity: product.entity || null,
    warehouse: product.warehouse || null,
    scalev_product_names: Array.isArray(product.scalev_product_names) ? product.scalev_product_names : [],
  })) as WarehouseProductLite[];

  const finalRows: ScalevCatalogMappingRow[] = rows.map((entity) => {
    const identifierValues = dedupeIdentifiers([
      ...entity.identifiers,
      ...(identifiersByEntityKey.get(entity.entity_key) || []),
    ]);
    const existingMapping = mappingByEntityKey.get(entity.entity_key) || null;
    const recommendation = buildRecommendationForEntity({
      entity: {
        ...entity,
        identifiers: identifierValues,
      },
      businessTarget,
      legacyByNormalized,
      aliasByNormalized: normalizedAliasMap,
      warehouseProducts: warehouseProductRows,
      frequencyByNormalized,
    });

    const warehouseProduct = existingMapping?.warehouse_products
      ? {
          id: Number(existingMapping.warehouse_products.id),
          name: existingMapping.warehouse_products.name,
          category: existingMapping.warehouse_products.category || null,
          entity: existingMapping.warehouse_products.entity || null,
          warehouse: existingMapping.warehouse_products.warehouse || null,
        }
      : null;

    return {
      entity_type: entity.entity_type,
      entity_key: entity.entity_key,
      scalev_product_id: entity.scalev_product_id,
      scalev_variant_id: entity.scalev_variant_id,
      label: entity.label,
      secondary_label: entity.secondary_label,
      sku: entity.sku,
      item_type: entity.item_type,
      identifiers_count: identifierValues.length,
      identifiers_preview: identifierValues.slice(0, 4),
      mapping_id: existingMapping?.id ? Number(existingMapping.id) : null,
      warehouse_product_id: existingMapping?.warehouse_product_id != null ? Number(existingMapping.warehouse_product_id) : null,
      warehouse_product: warehouseProduct,
      mapping_source: existingMapping?.mapping_source || null,
      notes: existingMapping?.notes || null,
      status: existingMapping?.warehouse_product_id
        ? 'mapped'
        : recommendation
          ? 'recommended'
          : 'unmapped',
      recommendation: existingMapping?.warehouse_product_id ? null : recommendation,
    };
  });

  return {
    business_id: businessId,
    business_code: businessCode,
    business_target: businessTarget,
    rows: finalRows,
  };
}

export async function saveScalevCatalogProductMapping(input: {
  businessId: number;
  entityKey: string;
  warehouseProductId: number | null;
  notes?: string | null;
}) {
  await requireScalevCatalogMappingAccess();
  const svc = createServiceSupabase();

  const entityKey = String(input.entityKey || '').trim();
  if (!entityKey) {
    throw new Error('Entity Scalev tidak valid.');
  }

  const notes = String(input.notes || '').trim() || null;

  const [entityType, rawId] = entityKey.split(':');
  const entityId = Number(rawId || 0);
  if (!entityType || !Number.isFinite(entityId) || entityId <= 0) {
    throw new Error('Entity Scalev tidak valid.');
  }

  let entityRow: any = null;
  if (entityType === 'variant') {
    const { data, error } = await svc
      .from('scalev_catalog_variants')
      .select('business_id, business_code, scalev_product_id, scalev_variant_id, name, product_name')
      .eq('business_id', input.businessId)
      .eq('scalev_variant_id', entityId)
      .maybeSingle();
    if (error) throw error;
    entityRow = data;
  } else if (entityType === 'product') {
    const { data, error } = await svc
      .from('scalev_catalog_products')
      .select('business_id, business_code, scalev_product_id, name, public_name, display')
      .eq('business_id', input.businessId)
      .eq('scalev_product_id', entityId)
      .maybeSingle();
    if (error) throw error;
    entityRow = data;
  } else {
    throw new Error('Tipe entity Scalev tidak didukung.');
  }

  if (!entityRow) {
    throw new Error('Entity Scalev tidak ditemukan di katalog tersimpan.');
  }

  const scalevEntityLabel = entityType === 'variant'
    ? (entityRow.name || entityRow.product_name || `Variant ${entityId}`)
    : (entityRow.display || entityRow.public_name || entityRow.name || `Product ${entityId}`);

  const { data: beforeMapping, error: beforeMappingError } = await svc
    .from('warehouse_scalev_catalog_mapping')
    .select(`
      id,
      business_id,
      business_code,
      scalev_entity_type,
      scalev_entity_key,
      scalev_entity_label,
      warehouse_product_id,
      mapping_source,
      notes,
      warehouse_products(id, name, category, entity, warehouse)
    `)
    .eq('business_id', input.businessId)
    .eq('scalev_entity_key', entityKey)
    .maybeSingle();
  if (beforeMappingError) {
    if (isMissingTableError(beforeMappingError)) throw new Error(getMissingMappingSchemaMessage());
    throw beforeMappingError;
  }

  if (input.warehouseProductId == null && !notes) {
    const { error } = await svc
      .from('warehouse_scalev_catalog_mapping')
      .delete()
      .eq('business_id', input.businessId)
      .eq('scalev_entity_key', entityKey);
    if (error) {
      if (isMissingTableError(error)) throw new Error(getMissingMappingSchemaMessage());
      throw error;
    }

    if (beforeMapping) {
      const beforeState = {
        business_code: beforeMapping.business_code || entityRow.business_code,
        scalev_entity_type: beforeMapping.scalev_entity_type || entityType,
        scalev_entity_key: beforeMapping.scalev_entity_key,
        scalev_entity_label: beforeMapping.scalev_entity_label || null,
        warehouse_product_id: beforeMapping.warehouse_product_id ?? null,
        warehouse_product_label: formatWarehouseProductLabel(pickWarehouseProduct(beforeMapping.warehouse_products)),
        mapping_source: beforeMapping.mapping_source || null,
        notes: beforeMapping.notes || null,
      };
      await recordWarehouseActivityLog({
        scope: 'scalev_catalog_product_mapping',
        action: 'clear',
        screen: 'Product Mapping Scalev',
        summary: `Menghapus mapping ${scalevEntityLabel}`,
        targetType: entityType,
        targetId: entityKey,
        targetLabel: scalevEntityLabel,
        businessCode: entityRow.business_code,
        changedFields: ['warehouse_product_id', 'notes'],
        beforeState,
        afterState: {
          business_code: entityRow.business_code,
          scalev_entity_type: entityType,
          scalev_entity_key: entityKey,
          scalev_entity_label: scalevEntityLabel,
          warehouse_product_id: null,
          warehouse_product_label: null,
          mapping_source: null,
          notes: null,
        },
        context: {},
      });
    }

    return { success: true, action: 'cleared' as const };
  }

  const payload = {
    business_id: Number(entityRow.business_id),
    business_code: entityRow.business_code,
    scalev_entity_type: entityType,
    scalev_entity_key: entityKey,
    scalev_product_id: Number(entityRow.scalev_product_id),
    scalev_variant_id: entityType === 'variant' ? Number(entityRow.scalev_variant_id) : null,
    scalev_entity_label: scalevEntityLabel,
    warehouse_product_id: input.warehouseProductId,
    mapping_source: 'manual',
    notes,
  };

  const { error } = await svc
    .from('warehouse_scalev_catalog_mapping')
    .upsert(payload, { onConflict: 'business_id,scalev_entity_key' });
  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingMappingSchemaMessage());
    throw error;
  }

  const { data: afterMapping, error: afterMappingError } = await svc
    .from('warehouse_scalev_catalog_mapping')
    .select(`
      id,
      business_id,
      business_code,
      scalev_entity_type,
      scalev_entity_key,
      scalev_entity_label,
      warehouse_product_id,
      mapping_source,
      notes,
      warehouse_products(id, name, category, entity, warehouse)
    `)
    .eq('business_id', input.businessId)
    .eq('scalev_entity_key', entityKey)
    .maybeSingle();
  if (afterMappingError) {
    if (isMissingTableError(afterMappingError)) throw new Error(getMissingMappingSchemaMessage());
    throw afterMappingError;
  }

  const beforeState = {
    business_code: beforeMapping?.business_code || entityRow.business_code,
    scalev_entity_type: beforeMapping?.scalev_entity_type || entityType,
    scalev_entity_key: entityKey,
    scalev_entity_label: beforeMapping?.scalev_entity_label || scalevEntityLabel,
    warehouse_product_id: beforeMapping?.warehouse_product_id ?? null,
    warehouse_product_label: formatWarehouseProductLabel(pickWarehouseProduct(beforeMapping?.warehouse_products)),
    mapping_source: beforeMapping?.mapping_source || null,
    notes: beforeMapping?.notes || null,
  };
  const afterState = {
    business_code: afterMapping?.business_code || entityRow.business_code,
    scalev_entity_type: afterMapping?.scalev_entity_type || entityType,
    scalev_entity_key: entityKey,
    scalev_entity_label: afterMapping?.scalev_entity_label || scalevEntityLabel,
    warehouse_product_id: afterMapping?.warehouse_product_id ?? null,
    warehouse_product_label: formatWarehouseProductLabel(pickWarehouseProduct(afterMapping?.warehouse_products)),
    mapping_source: afterMapping?.mapping_source || 'manual',
    notes: afterMapping?.notes || null,
  };
  const changedFields = getWarehouseActivityLogChangedFields(beforeState, afterState, [
    'warehouse_product_id',
    'notes',
    'mapping_source',
  ]);

  if (changedFields.length > 0) {
    let action = 'update';
    let summary = `Memperbarui mapping ${scalevEntityLabel}`;

    if (!beforeState.warehouse_product_id && afterState.warehouse_product_id) {
      action = 'map';
      summary = `Memetakan ${scalevEntityLabel} ke ${afterState.warehouse_product_label}`;
    } else if (
      beforeState.warehouse_product_id
      && afterState.warehouse_product_id
      && beforeState.warehouse_product_id !== afterState.warehouse_product_id
    ) {
      action = 'remap';
      summary = `Mengubah mapping ${scalevEntityLabel} dari ${beforeState.warehouse_product_label} ke ${afterState.warehouse_product_label}`;
    } else if (beforeState.warehouse_product_id && !afterState.warehouse_product_id) {
      action = 'unmap';
      summary = `Melepas mapping ${scalevEntityLabel} dari ${beforeState.warehouse_product_label}`;
    } else if (beforeState.notes !== afterState.notes) {
      action = 'update_notes';
      summary = `Memperbarui catatan untuk ${scalevEntityLabel}`;
    }

    await recordWarehouseActivityLog({
      scope: 'scalev_catalog_product_mapping',
      action,
      screen: 'Product Mapping Scalev',
      summary,
      targetType: entityType,
      targetId: entityKey,
      targetLabel: scalevEntityLabel,
      businessCode: entityRow.business_code,
      changedFields,
      beforeState,
      afterState,
      context: {
        business_id: Number(entityRow.business_id),
        scalev_product_id: Number(entityRow.scalev_product_id),
        scalev_variant_id: entityType === 'variant' ? Number(entityRow.scalev_variant_id) : null,
      },
    });
  }

  return { success: true, action: input.warehouseProductId == null ? 'noted' : 'mapped' };
}
