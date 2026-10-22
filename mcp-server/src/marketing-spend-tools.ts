import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertWorkspace, readAll, readDimensionCatalog, scopeShape } from './marketing-dimensions.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}, 'Invalid date');
export const spendSchema = z.object({
  from: date, to: date, ...scopeShape,
  source: z.string().min(1).max(200).optional().describe('Exact channel label (e.g. Facebook Ads). Omit for all channels; Meta-only tool includes every meta_api source.'),
  ad_account: z.string().min(1).max(500).optional().describe('Exact historical ad_account label, not a fuzzy name search.'),
  include_daily: z.boolean().default(false),
}).strict();
const round = (n: number) => Math.round(n * 100) / 100;
const content = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
function totals(rows: any[]) {
  const spent = rows.reduce((s, r) => s + Math.abs(Number(r.spent ?? 0)), 0);
  const impressions = rows.reduce((s, r) => s + Number(r.impressions ?? 0), 0);
  return { spent: round(spent), impressions, avg_cpm: impressions > 0 ? round(spent / impressions * 1000) : null, rows: rows.length };
}
function grouped(rows: any[], key: string): Array<Record<string, any>> {
  const groups = new Map<unknown, any[]>();
  for (const row of rows) { const value = row[key] ?? null; const items = groups.get(value) || []; items.push(row); groups.set(value, items); }
  return [...groups].map(([value, items]) => ({ [key]: value, ...totals(items) })).sort((a, b) => b.spent - a.spent);
}

export async function readSpend(db: SupabaseClient<any, any, any>, workspaceId: string, args: z.input<typeof spendSchema>, metaOnly = false) {
  const input = spendSchema.parse(args);
  assertWorkspace(workspaceId, input.workspace_id);
  if (input.from > input.to || (Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 92) throw new Error('Choose an ordered range of at most 93 days.');
  if (input.store !== undefined) throw new Error('Ambiguous legacy store filter rejected. Resolve brand_id or operational store_id with meta_ad_funnel_catalog.');
  const catalog = await readDimensionCatalog(db, workspaceId);
  const brand = input.brand_id ? catalog.brands.find(b => String(b.id) === input.brand_id) : null;
  const business = input.business_code ? catalog.businesses.find(b => b.business_code === input.business_code) : null;
  const store = input.store_id ? catalog.stores.find(s => s.id === input.store_id) : null;
  if (input.brand_id && !brand) throw new Error('Brand not found in this workspace.');
  if (input.business_code && !business) throw new Error('Business not found in this workspace.');
  if (input.store_id && !store) throw new Error('Store not found in this workspace.');
  if (store && business && store.business_id !== business.id) throw new Error('Store belongs to a different business.');
  const scope = { workspace: catalog.workspace, brand, business, store };
  const filters = { workspace_id: workspaceId, brand_id: input.brand_id ?? null, business_code: input.business_code ?? null,
    store_id: input.store_id ?? null, source: input.source ?? null, ad_account: input.ad_account ?? null, data_source: metaOnly ? 'meta_api' : null };
  const base = { schema_version: 2, period: { from: input.from, to: input.to }, filters, scope };
  if (store) return { ...base, status: 'unsupported_dimension', totals: null, accounts: [],
    warnings: ['Store-level spend unavailable: daily_ads_spend has no operational store_id. A brand alias or shared business is not store attribution. Do not substitute brand/business totals.'] };

  // Fetch all channel/date rows inside the tenant, then apply canonical entity
  // filters deterministically here (never in the LLM). Keep unknown attribution
  // counts so an empty business selection cannot be mistaken for zero spend.
  const rows = await readAll(() => {
    let q = db.from('daily_ads_spend').select('id,date,source,store,ad_account,spent,data_source,impressions,brand_id,business_code', { count: 'exact' })
      .eq('workspace_id', workspaceId).gte('date', input.from).lte('date', input.to);
    if (metaOnly) q = q.eq('data_source', 'meta_api');
    if (input.source) q = q.eq('source', input.source);
    if (input.ad_account) q = q.eq('ad_account', input.ad_account);
    return q;
  });
  const knownBrand = (r: any) => catalog.brands.some(b => b.id === r.brand_id);
  const knownBusiness = (r: any) => catalog.businesses.some(b => b.business_code === r.business_code);
  const matchesBrand = (r: any) => !input.brand_id || String(r.brand_id) === input.brand_id;
  const matchesBusiness = (r: any) => !input.business_code || r.business_code === input.business_code;
  const selected = rows.filter(r => matchesBrand(r) && matchesBusiness(r));
  const unknown = rows.filter(r => (!input.brand_id || matchesBrand(r) || !knownBrand(r))
    && (!input.business_code || matchesBusiness(r) || !knownBusiness(r))
    && ((!!input.brand_id && !knownBrand(r)) || (!!input.business_code && !knownBusiness(r))));
  const status = unknown.length ? (selected.length ? 'partial_attribution' : 'unavailable_attribution') : selected.length ? 'ok' : 'no_rows';
  const warnings = ['Ingestion completeness is not verified by spend tools; no rows is not proof of zero activity.'];
  if (unknown.length) warnings.push('Some potentially relevant rows lack canonical attribution. Totals cover only explicitly attributed rows, not the full requested entity.');
  const result = { ...base, status, attribution: { unknown_rows: unknown.length, basis: { brand: 'frozen spend.brand_id', business: 'spend.business_code', store: 'unsupported' } },
    totals: selected.length ? totals(selected) : null, warnings };
  if (!metaOnly) return { ...result, by_source: grouped(selected, 'source'), by_brand_id: grouped(selected, 'brand_id'),
    by_business_code: grouped(selected, 'business_code'), by_legacy_store_label: grouped(selected, 'store'), by_data_source: grouped(selected, 'data_source') };
  // Group by historical account label. daily_ads_spend has no Meta account FK;
  // do not imply identity from a possibly duplicated or renamed current name.
  const names = [...new Set(selected.map(r => r.ad_account))];
  return { ...result, accounts: names.map(name => {
    const items = selected.filter(r => r.ad_account === name);
    return { ad_account: name, ...totals(items), brand_ids: [...new Set(items.map(r => r.brand_id))],
      legacy_store_labels: [...new Set(items.map(r => r.store))], business_codes: [...new Set(items.map(r => r.business_code))],
      daily: input.include_daily ? grouped(items, 'date').sort((a, b) => String(a.date).localeCompare(String(b.date))) : undefined };
  }).sort((a, b) => b.spent - a.spent) };
}

export function registerMarketingSpendTools(server: McpServer, db: SupabaseClient<any, any, any>, workspaceId: string): Record<string, RegisteredTool> {
  return {
    marketing_spend_summary: server.tool('marketing_spend_summary', 'Marketing spend across channels with canonical brand_id and exact business_code filters. Read dimension catalog first. Legacy store labels are not operational stores; store_id is explicitly unsupported. Missing attribution returns a status, never invented zero. Max 93 days.', spendSchema.shape, async args => content(await readSpend(db, workspaceId, args))),
    meta_ads_spend_by_account: server.tool('meta_ads_spend_by_account', 'Meta-only (data_source=meta_api) spend by historical account label. Canonical brand_id and business_code filters are applied before totals/CPM; store_id is unsupported. Read dimension catalog first. No manual filtering using current account defaults or store labels. Max 93 days.', spendSchema.shape, async args => content(await readSpend(db, workspaceId, args, true))),
  };
}
