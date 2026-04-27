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
): Promise<ResolvedWarehouseOrderContext> {
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(svc as any),
    fetchWarehouseOriginRegistryRows(svc as any),
  ]);

  return resolveWarehouseOrderContextFromLookups({
    data,
    businessCode,
    businessDirectoryRows,
    originRegistryRows,
  });
}
