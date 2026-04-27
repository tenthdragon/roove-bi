import { createServiceSupabase } from './supabase-server';

export type WarehouseBusinessDirectoryRow = {
  id: number;
  external_name: string;
  external_name_normalized: string;
  business_id: number | null;
  business_code: string;
  is_active: boolean;
  notes: string | null;
};

export type WarehouseOriginRegistryRow = {
  id: number;
  external_origin_business_name: string;
  external_origin_business_name_normalized: string;
  external_origin_name: string;
  external_origin_name_normalized: string;
  operator_business_id: number | null;
  operator_business_code: string;
  internal_warehouse_code: string;
  is_active: boolean;
  notes: string | null;
};

export type ResolvedWarehouseBusiness = {
  business_id: number | null;
  business_code: string | null;
  external_name: string | null;
  source: 'directory' | 'fallback_code' | 'none';
};

export type ResolvedWarehouseOrigin = {
  id: number | null;
  operator_business_id: number | null;
  operator_business_code: string | null;
  internal_warehouse_code: string | null;
  external_origin_business_name: string | null;
  external_origin_name: string | null;
  source: 'registry' | 'none';
};

export function cleanWarehouseDomainText(value: unknown): string | null {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return text || null;
}

export function normalizeWarehouseDomainText(value: unknown): string {
  return String(cleanWarehouseDomainText(value) || '')
    .toLowerCase()
    .trim();
}

export function extractScalevOrderBusinessNameRaw(rawData: any, fallbackBusinessCode?: string | null) {
  return cleanWarehouseDomainText(
    rawData?.business_name
    ?? rawData?.business?.name
    ?? rawData?.business?.username
    ?? fallbackBusinessCode
    ?? null,
  );
}

export function extractScalevOrderOriginBusinessNameRaw(rawData: any) {
  return cleanWarehouseDomainText(
    rawData?.origin_business_name
    ?? rawData?.warehouse?.business_name
    ?? rawData?.warehouse?.business?.name
    ?? rawData?.origin_address?.business_name
    ?? null,
  );
}

export function extractScalevOrderOriginRaw(rawData: any) {
  return cleanWarehouseDomainText(
    rawData?.origin
    ?? rawData?.warehouse?.name
    ?? rawData?.origin_address?.name
    ?? rawData?.origin_address?.label
    ?? null,
  );
}

export function deriveWarehouseOriginBusinessNameFromOriginName(rawOriginName?: string | null) {
  const cleaned = cleanWarehouseDomainText(rawOriginName);
  if (!cleaned) return null;

  const derived = cleanWarehouseDomainText(
    cleaned
      .replace(/'s warehouse$/i, '')
      .replace(/\s+warehouse$/i, '')
      .replace(/\s+gudang$/i, ''),
  );

  if (!derived) return null;
  return normalizeWarehouseDomainText(derived) === normalizeWarehouseDomainText(cleaned)
    ? null
    : derived;
}

export function extractScalevLineItemNameRaw(line: any) {
  return cleanWarehouseDomainText(
    line?.item_name
    ?? line?.product_name
    ?? null,
  );
}

export function extractScalevLineItemOwnerRaw(line: any) {
  return cleanWarehouseDomainText(
    line?.item_owner
    ?? line?.owner_business_name
    ?? line?.owner
    ?? null,
  );
}

export async function fetchWarehouseBusinessDirectoryRows(
  svc: ReturnType<typeof createServiceSupabase> = createServiceSupabase(),
): Promise<WarehouseBusinessDirectoryRow[]> {
  const { data, error } = await svc
    .from('warehouse_business_directory')
    .select('id, external_name, external_name_normalized, business_id, business_code, is_active, notes')
    .eq('is_active', true)
    .order('external_name', { ascending: true });

  if (error) throw error;
  return ((data || []) as any[]).map((row) => ({
    id: Number(row.id),
    external_name: String(row.external_name || ''),
    external_name_normalized: String(row.external_name_normalized || ''),
    business_id: row.business_id == null ? null : Number(row.business_id),
    business_code: String(row.business_code || ''),
    is_active: Boolean(row.is_active),
    notes: row.notes || null,
  }));
}

export async function fetchWarehouseOriginRegistryRows(
  svc: ReturnType<typeof createServiceSupabase> = createServiceSupabase(),
): Promise<WarehouseOriginRegistryRow[]> {
  const { data, error } = await svc
    .from('warehouse_origin_registry')
    .select(`
      id,
      external_origin_business_name,
      external_origin_business_name_normalized,
      external_origin_name,
      external_origin_name_normalized,
      operator_business_id,
      operator_business_code,
      internal_warehouse_code,
      is_active,
      notes
    `)
    .eq('is_active', true)
    .order('external_origin_business_name', { ascending: true })
    .order('external_origin_name', { ascending: true });

  if (error) throw error;
  return ((data || []) as any[]).map((row) => ({
    id: Number(row.id),
    external_origin_business_name: String(row.external_origin_business_name || ''),
    external_origin_business_name_normalized: String(row.external_origin_business_name_normalized || ''),
    external_origin_name: String(row.external_origin_name || ''),
    external_origin_name_normalized: String(row.external_origin_name_normalized || ''),
    operator_business_id: row.operator_business_id == null ? null : Number(row.operator_business_id),
    operator_business_code: String(row.operator_business_code || ''),
    internal_warehouse_code: String(row.internal_warehouse_code || ''),
    is_active: Boolean(row.is_active),
    notes: row.notes || null,
  }));
}

export function resolveWarehouseBusinessCode(params: {
  rawValue?: string | null;
  fallbackBusinessCode?: string | null;
  directoryRows: WarehouseBusinessDirectoryRow[];
}): ResolvedWarehouseBusiness {
  const rawValue = cleanWarehouseDomainText(params.rawValue);
  const normalized = normalizeWarehouseDomainText(rawValue);
  if (normalized) {
    const entry = params.directoryRows.find((row) => row.external_name_normalized === normalized) || null;
    if (entry) {
      return {
        business_id: entry.business_id,
        business_code: entry.business_code,
        external_name: entry.external_name,
        source: 'directory',
      };
    }
  }

  const fallbackBusinessCode = cleanWarehouseDomainText(params.fallbackBusinessCode);
  if (fallbackBusinessCode) {
    return {
      business_id: null,
      business_code: fallbackBusinessCode,
      external_name: fallbackBusinessCode,
      source: 'fallback_code',
    };
  }

  return {
    business_id: null,
    business_code: null,
    external_name: rawValue,
    source: 'none',
  };
}

export function resolveWarehouseOrigin(params: {
  rawOriginBusinessName?: string | null;
  rawOriginName?: string | null;
  registryRows: WarehouseOriginRegistryRow[];
}): ResolvedWarehouseOrigin {
  const cleanedOriginBusinessName = cleanWarehouseDomainText(params.rawOriginBusinessName);
  const cleanedOriginName = cleanWarehouseDomainText(params.rawOriginName);
  const derivedBusinessName = deriveWarehouseOriginBusinessNameFromOriginName(cleanedOriginName);

  const businessNameCandidates = Array.from(new Set(
    [
      cleanedOriginBusinessName,
      derivedBusinessName,
    ]
      .map((value) => normalizeWarehouseDomainText(value))
      .filter(Boolean),
  ));
  const originNameCandidates = Array.from(new Set(
    [
      cleanedOriginName,
      derivedBusinessName,
    ]
      .map((value) => normalizeWarehouseDomainText(value))
      .filter(Boolean),
  ));

  if (businessNameCandidates.length === 0 && originNameCandidates.length === 0) {
    return {
      id: null,
      operator_business_id: null,
      operator_business_code: null,
      internal_warehouse_code: null,
      external_origin_business_name: cleanedOriginBusinessName || derivedBusinessName,
      external_origin_name: cleanedOriginName,
      source: 'none',
    };
  }

  const exactEntry = params.registryRows.find((row) => (
    businessNameCandidates.includes(row.external_origin_business_name_normalized)
    && originNameCandidates.includes(row.external_origin_name_normalized)
  )) || null;

  const businessOnlyMatches = businessNameCandidates.length > 0
    ? params.registryRows.filter((row) => (
        businessNameCandidates.includes(row.external_origin_business_name_normalized)
        || businessNameCandidates.includes(row.external_origin_name_normalized)
      ))
    : [];
  const originOnlyMatches = originNameCandidates.length > 0
    ? params.registryRows.filter((row) => (
        originNameCandidates.includes(row.external_origin_name_normalized)
        || originNameCandidates.includes(row.external_origin_business_name_normalized)
      ))
    : [];

  const entry = exactEntry
    || (businessOnlyMatches.length === 1 ? businessOnlyMatches[0] : null)
    || (originOnlyMatches.length === 1 ? originOnlyMatches[0] : null);

  if (!entry) {
    return {
      id: null,
      operator_business_id: null,
      operator_business_code: null,
      internal_warehouse_code: null,
      external_origin_business_name: cleanedOriginBusinessName || derivedBusinessName,
      external_origin_name: cleanedOriginName,
      source: 'none',
    };
  }

  return {
    id: entry.id,
    operator_business_id: entry.operator_business_id,
    operator_business_code: entry.operator_business_code,
    internal_warehouse_code: entry.internal_warehouse_code,
    external_origin_business_name: entry.external_origin_business_name,
    external_origin_name: entry.external_origin_name,
    source: 'registry',
  };
}
