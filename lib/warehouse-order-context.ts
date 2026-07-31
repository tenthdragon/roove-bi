import { createServiceSupabase } from './service-supabase';
import {
  deriveWarehouseOriginBusinessNameFromOriginName,
  extractScalevOrderBusinessNameRaw,
  extractScalevOrderOriginBusinessNameRaw,
  extractScalevOrderOriginRaw,
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
  resolveWarehouseBusinessCode,
  resolveWarehouseOrigin,
} from './warehouse-domain-helpers';

export type ResolvedWarehouseOrderContext = {
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  businessNameRaw: string | null;
  originBusinessNameRaw: string | null;
  originRaw: string | null;
  sellerBusinessCode: string | null;
  originOperatorBusinessCode: string | null;
  originRegistryId: number | null;
};

const WAREHOUSE_LOOKUP_CACHE_TTL_MS = 60_000;
const cachedBusinessDirectory = new Map<string, {
  rows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  expiresAt: number;
}>();
const cachedBusinessDirectoryPromises = new Map<
  string,
  Promise<Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>>
>();
const cachedOriginRegistry = new Map<string, {
  rows: Awaited<ReturnType<typeof fetchWarehouseOriginRegistryRows>>;
  expiresAt: number;
}>();
const cachedOriginRegistryPromises = new Map<
  string,
  Promise<Awaited<ReturnType<typeof fetchWarehouseOriginRegistryRows>>>
>();

async function getCachedWarehouseBusinessDirectoryRows(
  svc: ReturnType<typeof createServiceSupabase>,
  workspaceId: string,
) {
  const cached = cachedBusinessDirectory.get(workspaceId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.rows;
  }
  const pending = cachedBusinessDirectoryPromises.get(workspaceId);
  if (pending) return pending;

  const request = (async () => {
    const rows = await fetchWarehouseBusinessDirectoryRows(
      svc as any,
      workspaceId,
    );
    cachedBusinessDirectory.set(workspaceId, {
      rows,
      expiresAt: Date.now() + WAREHOUSE_LOOKUP_CACHE_TTL_MS,
    });
    return rows;
  })().finally(() => {
    cachedBusinessDirectoryPromises.delete(workspaceId);
  });
  cachedBusinessDirectoryPromises.set(workspaceId, request);

  return request;
}

async function getCachedWarehouseOriginRegistryRows(
  svc: ReturnType<typeof createServiceSupabase>,
  workspaceId: string,
) {
  const cached = cachedOriginRegistry.get(workspaceId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.rows;
  }
  const pending = cachedOriginRegistryPromises.get(workspaceId);
  if (pending) return pending;

  const request = (async () => {
    const rows = await fetchWarehouseOriginRegistryRows(
      svc as any,
      workspaceId,
    );
    cachedOriginRegistry.set(workspaceId, {
      rows,
      expiresAt: Date.now() + WAREHOUSE_LOOKUP_CACHE_TTL_MS,
    });
    return rows;
  })().finally(() => {
    cachedOriginRegistryPromises.delete(workspaceId);
  });
  cachedOriginRegistryPromises.set(workspaceId, request);

  return request;
}

export function resolveWarehouseOrderContextFromLookups(args: {
  data: any,
  businessCode: string,
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>,
  originRegistryRows: Awaited<ReturnType<typeof fetchWarehouseOriginRegistryRows>>,
}): ResolvedWarehouseOrderContext {
  const businessNameRaw = extractScalevOrderBusinessNameRaw(args.data, args.businessCode);
  const extractedOriginBusinessNameRaw = extractScalevOrderOriginBusinessNameRaw(args.data);
  const originRaw = extractScalevOrderOriginRaw(args.data);
  const originBusinessNameRaw = extractedOriginBusinessNameRaw
    || deriveWarehouseOriginBusinessNameFromOriginName(originRaw)
    || null;

  const seller = resolveWarehouseBusinessCode({
    rawValue: businessNameRaw,
    fallbackBusinessCode: args.businessCode,
    directoryRows: args.businessDirectoryRows,
  });
  const originOperator = resolveWarehouseBusinessCode({
    rawValue: originBusinessNameRaw,
    fallbackBusinessCode: null,
    directoryRows: args.businessDirectoryRows,
  });
  const originRegistry = resolveWarehouseOrigin({
    rawOriginBusinessName: originBusinessNameRaw,
    rawOriginName: originRaw,
    registryRows: args.originRegistryRows,
  });

  return {
    businessDirectoryRows: args.businessDirectoryRows,
    businessNameRaw,
    originBusinessNameRaw,
    originRaw,
    sellerBusinessCode: seller.business_code || args.businessCode || null,
    originOperatorBusinessCode: originRegistry.operator_business_code || originOperator.business_code || null,
    originRegistryId: originRegistry.id || null,
  };
}

export async function resolveWarehouseOrderContext(
  svc: ReturnType<typeof createServiceSupabase>,
  data: any,
  businessCode: string,
  workspaceId: string,
): Promise<ResolvedWarehouseOrderContext> {
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    getCachedWarehouseBusinessDirectoryRows(svc, workspaceId),
    getCachedWarehouseOriginRegistryRows(svc, workspaceId),
  ]);

  return resolveWarehouseOrderContextFromLookups({
    data,
    businessCode,
    businessDirectoryRows,
    originRegistryRows,
  });
}
