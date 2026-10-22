import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

type DB = SupabaseClient<any, any, any>;
export const scopeShape = {
  workspace_id: z.string().uuid().optional().describe('Optional assertion of the token-bound workspace, never a tenant switch.'),
  brand_id: z.string().regex(/^[1-9]\d*$/).optional().describe('Canonical brands.id from meta_ad_funnel_catalog, not a store label.'),
  business_code: z.string().min(1).max(100).optional().describe('Exact business_code from catalog. Spend uses recorded attribution, NOT brand ownership/seller roles.'),
  store_id: z.number().int().positive().optional().describe('Operational scalev_store_channels.id from catalog. Store-level spend is unsupported; never substitute brand totals.'),
  store: z.string().optional().describe('Legacy ambiguous parameter: rejected. Use brand_id or operational store_id instead.'),
};

export function assertWorkspace(workspaceId: string, requested?: string) {
  if (requested && requested !== workspaceId) throw new Error('Workspace does not match this MCP token; cross-workspace access is unavailable.');
}

// Count + bounded pagination detects PostgREST row caps rather than silently
// treating the first page as the total. A cap/error/change fails closed.
export async function readAll(query: () => any, key = 'id', max = 50000): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<unknown>();
  let expected: number | undefined;
  for (;;) {
    const result = await query().order(key).range(rows.length, rows.length + 999);
    if (result.error) throw new Error(result.error.message);
    if (!Number.isInteger(result.count) || result.count < 0) throw new Error('Exact row count unavailable; refusing incomplete totals.');
    if (expected !== undefined && result.count !== expected) throw new Error('Dataset changed during pagination; retry.');
    expected = result.count;
    if (result.count > max) throw new Error('Result exceeds safe row limit; narrow the date range. No partial totals returned.');
    const page = result.data || [];
    if (!page.length && rows.length < result.count) throw new Error('Incomplete dataset page; no totals returned.');
    for (const row of page) {
      if (row[key] == null || seen.has(row[key])) throw new Error('Unstable dataset pagination; retry.');
      seen.add(row[key]); rows.push(row);
    }
    if (rows.length > result.count) throw new Error('Dataset count mismatch; retry.');
    if (rows.length === result.count) return rows;
  }
}

export async function readDimensionCatalog(db: DB, workspaceId: string) {
  const get = (table: string, columns: string) => readAll(() => db.from(table).select(columns, { count: 'exact' }).eq('workspace_id', workspaceId), 'id', 10000);
  const [workspaces, brands, businesses, stores, roles, aliases] = await Promise.all([
    readAll(() => db.from('workspaces').select('id,slug,name', { count: 'exact' }).eq('id', workspaceId), 'id', 1),
    get('brands', 'id,name,is_active'),
    get('scalev_webhook_businesses', 'id,business_code,business_name,is_active'),
    get('scalev_store_channels', 'id,business_id,store_name,is_active'),
    get('business_brand_roles', 'id,brand_id,business_id,role,is_active'),
    get('brand_aliases', 'id,brand_id,provider,alias_type,alias,alias_normalized,is_active'),
  ]);
  if (workspaces.length !== 1) throw new Error('Workspace catalog unavailable for this token.');
  return {
    schema_version: 2,
    workspace: workspaces[0], brands, businesses, stores,
    business_brand_roles: roles, brand_aliases: aliases,
    semantics: {
      workspace: 'Tenant boundary. Workspace name Roove is not the same entity as brand Roove or business RTI.',
      business_brand: 'Many-to-many via owner/seller/operator roles. At most one active owner per brand; roles do not attribute ad spend.',
      store: 'Operational store belongs to business_id, not directly to brand_id. Store names may repeat across businesses.',
      aliases: 'Provider/type-scoped labels resolve canonical brands only when unambiguous. A store-type brand alias is NOT a store FK.',
      spend_brand: 'daily_ads_spend.brand_id frozen at ingestion; never infer historical brand from current account defaults or legacy store labels.',
      spend_business: 'Exact daily_ads_spend.business_code only. Missing attribution is unknown, not zero.',
      spend_store: 'Unsupported: daily_ads_spend has no operational store_id. Its store column is a legacy marketing label.',
      funnel_brand: 'Current Meta account default_brand_id, unlike frozen spend attribution. Business/store filters unsupported.',
    },
  };
}
