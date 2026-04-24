'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';
import { recordWarehouseActivityLog } from '@/lib/warehouse-activity-log-actions';
import { getWarehouseActivityLogChangedFields } from '@/lib/warehouse-activity-log-utils';
import {
  buildCanonicalMappingLookupKey,
  fetchCanonicalCatalogMappingsByRequests,
  fetchVisibleDirectCatalogEntities,
  type CanonicalCatalogMappingRow,
  type ScalevVisibilityKind,
  type VisibleDirectCatalogEntityRow,
} from '@/lib/scalev-visible-entity-helpers';

type WarehouseProductLite = {
  id: number;
  name: string | null;
  category: string | null;
  entity: string | null;
  warehouse: string | null;
  scalev_product_names?: string[] | null;
};

type BusinessTarget = {
  deduct_entity: string | null;
  deduct_warehouse: string | null;
  is_active: boolean;
  is_primary?: boolean | null;
  notes: string | null;
};

type CatalogEntityRow = VisibleDirectCatalogEntityRow;

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
  viewer_business_id: number;
  viewer_business_code: string;
  visibility_kind: ScalevVisibilityKind;
  owner_business_id: number;
  owner_business_code: string;
  processor_business_id: number;
  processor_business_code: string;
  mapping_business_id: number | null;
  mapping_business_code: string | null;
  processor_business_target: BusinessTarget | null;
  processor_business_targets: BusinessTarget[];
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
  business_targets: BusinessTarget[];
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

function getOwnerBusinessBoost(
  product: WarehouseProductLite,
  ownerBusinessCode: string | null,
): number {
  const ownerCode = String(ownerBusinessCode || '').trim();
  if (!ownerCode) return 0;

  let boost = 0;
  if (product.entity === ownerCode) boost += 1.1;
  if (product.warehouse === 'BTN') boost += 0.1;
  return boost;
}

function buildRecommendationSummary(
  candidate: RecommendationCandidate,
  runnerUp: RecommendationCandidate | null,
  ownerBusinessCode: string | null,
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
  if (ownerBusinessCode && candidate.product.entity === ownerBusinessCode) {
    reasons.push(`owner ${ownerBusinessCode}`);
  }

  return {
    warehouse_product_id: candidate.product.id,
    warehouse_product_name: candidate.product.name || `Product ${candidate.product.id}`,
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
  ownerBusinessCode: string | null;
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
    candidate.score += mutation.score + getOwnerBusinessBoost(product, input.ownerBusinessCode);
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
    return String(left.product.name || '').localeCompare(String(right.product.name || ''));
  });

  if (ranked.length === 0) return null;

  return buildRecommendationSummary(ranked[0], ranked[1] || null, input.ownerBusinessCode);
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
  return fetchVisibleDirectCatalogEntities(svc, businessId);
}

export async function getScalevCatalogProductMappings(businessId: number): Promise<ScalevCatalogMappingPayload> {
  await requireScalevCatalogMappingAccess();
  const svc = createServiceSupabase();

  const { businessCode, rows } = await getCatalogEntityRows(businessId);
  const mappingRequestsByBusinessId = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!mappingRequestsByBusinessId.has(row.owner_business_id)) {
      mappingRequestsByBusinessId.set(row.owner_business_id, new Set<string>());
    }
    mappingRequestsByBusinessId.get(row.owner_business_id)!.add(row.entity_key);
  }

  const [{ data: identifiers, error: identifierError }, mappings, { data: legacyMappings, error: legacyError }, { data: warehouseProducts, error: productError }, { data: frequencies }] = await Promise.all([
    svc
      .from('scalev_catalog_identifiers')
      .select('entity_key, identifier, identifier_normalized')
      .eq('business_id', businessId),
    fetchCanonicalCatalogMappingsByRequests(svc, mappingRequestsByBusinessId),
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
  if (legacyError) throw legacyError;
  if (productError) throw productError;

  const identifiersByEntityKey = new Map<string, string[]>();
  for (const row of (identifiers || []) as any[]) {
    const key = String(row.entity_key || '');
    if (!identifiersByEntityKey.has(key)) identifiersByEntityKey.set(key, []);
    identifiersByEntityKey.get(key)!.push(row.identifier);
  }

  const mappingByCanonicalKey = new Map<string, CanonicalCatalogMappingRow>();
  for (const row of mappings || []) {
    mappingByCanonicalKey.set(buildCanonicalMappingLookupKey(row.business_id, row.scalev_entity_key), row);
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
    const existingMapping = mappingByCanonicalKey.get(
      buildCanonicalMappingLookupKey(entity.owner_business_id, entity.entity_key),
    ) || null;
    const recommendation = buildRecommendationForEntity({
      entity: {
        ...entity,
        identifiers: identifierValues,
      },
      ownerBusinessCode: entity.owner_business_code,
      legacyByNormalized,
      aliasByNormalized: normalizedAliasMap,
      warehouseProducts: warehouseProductRows.filter((product) => (
        !entity.owner_business_code || product.entity === entity.owner_business_code
      )),
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
      viewer_business_id: entity.viewer_business_id,
      viewer_business_code: entity.viewer_business_code,
      visibility_kind: entity.visibility_kind,
      owner_business_id: entity.owner_business_id,
      owner_business_code: entity.owner_business_code,
      processor_business_id: entity.processor_business_id,
      processor_business_code: entity.processor_business_code,
      mapping_business_id: existingMapping?.business_id ?? null,
      mapping_business_code: existingMapping?.business_code || entity.owner_business_code || null,
      processor_business_target: null,
      processor_business_targets: [],
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
    business_target: null,
    business_targets: [],
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

  if (entityType !== 'variant' && entityType !== 'product') {
    throw new Error('Tipe entity Scalev tidak didukung.');
  }

  const { rows } = await fetchVisibleDirectCatalogEntities(svc, input.businessId, {
    entityKeys: [entityKey],
    includeProductsWithVariants: true,
  });
  const entityRow = rows.find((row) => row.entity_key === entityKey) || null;
  if (!entityRow) {
    throw new Error('Entity Scalev tidak ditemukan di katalog tersimpan.');
  }

  const scalevEntityLabel = entityRow.label || entityRow.secondary_label || `${entityType === 'variant' ? 'Variant' : 'Product'} ${entityId}`;
  const canonicalBusinessId = Number(entityRow.owner_business_id);
  const canonicalBusinessCode = entityRow.owner_business_code || entityRow.viewer_business_code;

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
    .eq('business_id', canonicalBusinessId)
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
      .eq('business_id', canonicalBusinessId)
      .eq('scalev_entity_key', entityKey);
    if (error) {
      if (isMissingTableError(error)) throw new Error(getMissingMappingSchemaMessage());
      throw error;
    }

    if (beforeMapping) {
      const beforeState = {
        business_code: beforeMapping.business_code || canonicalBusinessCode,
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
        businessCode: canonicalBusinessCode,
        changedFields: ['warehouse_product_id', 'notes'],
        beforeState,
        afterState: {
          business_code: canonicalBusinessCode,
          scalev_entity_type: entityType,
          scalev_entity_key: entityKey,
          scalev_entity_label: scalevEntityLabel,
          warehouse_product_id: null,
          warehouse_product_label: null,
          mapping_source: null,
          notes: null,
        },
        context: {
          viewer_business_id: entityRow.viewer_business_id,
          viewer_business_code: entityRow.viewer_business_code,
          processor_business_id: entityRow.processor_business_id,
          processor_business_code: entityRow.processor_business_code,
          visibility_kind: entityRow.visibility_kind,
        },
      });
    }

    return { success: true, action: 'cleared' as const };
  }

  const payload = {
    business_id: canonicalBusinessId,
    business_code: canonicalBusinessCode,
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
    .eq('business_id', canonicalBusinessId)
    .eq('scalev_entity_key', entityKey)
    .maybeSingle();
  if (afterMappingError) {
    if (isMissingTableError(afterMappingError)) throw new Error(getMissingMappingSchemaMessage());
    throw afterMappingError;
  }

  const beforeState = {
    business_code: beforeMapping?.business_code || canonicalBusinessCode,
    scalev_entity_type: beforeMapping?.scalev_entity_type || entityType,
    scalev_entity_key: entityKey,
    scalev_entity_label: beforeMapping?.scalev_entity_label || scalevEntityLabel,
    warehouse_product_id: beforeMapping?.warehouse_product_id ?? null,
    warehouse_product_label: formatWarehouseProductLabel(pickWarehouseProduct(beforeMapping?.warehouse_products)),
    mapping_source: beforeMapping?.mapping_source || null,
    notes: beforeMapping?.notes || null,
  };
  const afterState = {
    business_code: afterMapping?.business_code || canonicalBusinessCode,
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
      businessCode: canonicalBusinessCode,
      changedFields,
      beforeState,
      afterState,
      context: {
        business_id: canonicalBusinessId,
        viewer_business_id: Number(entityRow.viewer_business_id),
        viewer_business_code: entityRow.viewer_business_code,
        processor_business_id: Number(entityRow.processor_business_id),
        processor_business_code: entityRow.processor_business_code,
        visibility_kind: entityRow.visibility_kind,
        scalev_product_id: Number(entityRow.scalev_product_id),
        scalev_variant_id: entityType === 'variant' ? Number(entityRow.scalev_variant_id) : null,
      },
    });
  }

  return { success: true, action: input.warehouseProductId == null ? 'noted' : 'mapped' };
}
