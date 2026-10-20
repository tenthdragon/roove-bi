import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Use a valid YYYY-MM-DD date');
export const reportSchema = z.object({
  from: date, to: date,
  funnel_id: z.string().uuid().optional(),
  brand_id: z.string().regex(/^(?:[1-9]\d*|__unmapped__)$/).optional(),
  group_by: z.enum(['ad', 'landing_page']).default('landing_page'),
  view: z.enum(['overview', 'daily', 'trends', 'creatives']).default('overview'),
  period: z.enum(['week', 'month']).default('week'),
  group_key: z.string().max(50000).optional(),
  filters: z.object({ cep: z.string().max(500).optional(), intention: z.string().max(500).optional(), objective: z.string().max(500).optional() }).default({}),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});
const shift = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
export function reportRange(from: string, to: string, today: string) {
  date.parse(from); date.parse(to);
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new Error('Choose an ordered range of at most 93 days.');
  const end = to < today ? to : shift(today, -1);
  return { from: from <= end ? from : end, to: end };
}
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const content = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
export async function funnelContext(db: SupabaseClient, workspaceId: string) {
  const [funnels, accounts, brands, revision] = await Promise.all([
    db.from('meta_ad_funnels').select('id,brand_id,config,version,updated_at').eq('workspace_id', workspaceId).eq('archived', false).order('created_at'),
    db.from('meta_ad_accounts').select('account_id,account_name,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name'),
    db.from('brands').select('id,name').eq('workspace_id', workspaceId).order('name'),
    db.from('meta_ad_report_versions').select('revision,updated_at').eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  return { funnels: checked(funnels) || [], accounts: checked(accounts) || [], brands: checked(brands) || [], revision: checked(revision) };
}
export async function readFunnelReport(db: SupabaseClient, workspaceId: string, args: z.input<typeof reportSchema>, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) {
  const input = reportSchema.parse(args);
  const range = reportRange(input.from, input.to, today);
  const ctx = await funnelContext(db, workspaceId);
  const funnels = ctx.funnels.filter(f => f.config?.group_by === 'landing_page');
  const selected = input.funnel_id ? ctx.funnels.find(f => f.id === input.funnel_id) : funnels[0];
  if (input.funnel_id && !selected) throw new Error('Funnel not found in this workspace or archived.');
  if (input.brand_id && !ctx.accounts.some(a => {
    const brand = ctx.brands.some(b => b.id === a.default_brand_id) ? String(a.default_brand_id) : '__unmapped__';
    return brand === input.brand_id;
  })) throw new Error('Brand not available on active Meta accounts in this workspace.');
  // Match dashboard defaults and use its reporting RPC for all aggregation.
  const config = { ...(selected?.config || { account_ids: [], name_filter: '', match: 'contains' }) };
  if (selected?.brand_id != null) {
    if (input.brand_id && input.brand_id !== String(selected.brand_id)) throw new Error('Funnel belongs to another brand.');
    input.brand_id = String(selected.brand_id);
    const ids = ctx.accounts.filter(a => a.default_brand_id === selected.brand_id && (!config.account_ids?.length || config.account_ids.includes(a.account_id))).map(a => a.account_id);
    config.account_ids = ids.length ? ids : ['__no_authorized_meta_account__'];
  }
  const filters = { ...input.filters };
  const aliases: Record<string, Record<string, string>> = { cep: { kulit: 'skin', sendi: 'joint', tulang: 'bone', rambut: 'hair', kuku: 'nail' }, intention: { discovery: 'disc', consideration: 'cons', conversion: 'conv' } };
  for (const key of ['cep', 'intention'] as const) {
    if (filters[key]) { const value = filters[key]!.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' '); filters[key] = aliases[key][value] || value; }
  }
  if (filters.objective && filters.objective !== '__unknown__') filters.objective = filters.objective.trim().toUpperCase();
  const raw = checked(await db.rpc('get_meta_ad_report', {
    p_workspace_id: workspaceId, p_from: range.from, p_to: range.to,
    p_config: { account_ids: config.account_ids, name_filter: config.name_filter, match: config.match },
    p_filters: filters, p_brand: input.brand_id || null, p_group_by: input.group_by,
    p_view: input.view, p_period: input.period, p_group_key: input.view === 'overview' ? null : input.group_key || null,
  }));
  if (!raw || !Array.isArray(raw.currencies)) throw new Error('Invalid Meta report response.');
  if (raw.currencies.length > 1) throw new Error('Report contains multiple currencies. Select a funnel or brand with accounts using one currency.');
  const accounts = ctx.accounts.filter(a => (!config.account_ids?.length || config.account_ids.includes(a.account_id))
    && (!input.brand_id || (ctx.brands.some(b => b.id === a.default_brand_id) ? String(a.default_brand_id) : '__unmapped__') === input.brand_id));
  const available = new Set((raw.coverage || []).map((c: any) => `${c.account_id}:${c.metric_date}`));
  const duration = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  const coverage_gaps = input.view !== 'overview' ? null : accounts.flatMap(a => {
    let current_missing = 0, previous_missing = 0;
    for (let day = shift(range.from, -duration); day <= range.to; day = shift(day, 1)) {
      if (!available.has(`${a.account_id}:${day}`)) { if (day < range.from) previous_missing++; else current_missing++; }
    }
    return current_missing || previous_missing ? [{ account_id: a.account_id, current_missing, previous_missing }] : [];
  });
  const result = { ...raw };
  const pagination: Record<string, unknown> = {};
  for (const key of ['groups', 'history', 'creatives']) {
    if (!Array.isArray(result[key])) continue;
    pagination[key] = { total: result[key].length, offset: input.offset, limit: input.limit, has_more: input.offset + input.limit < result[key].length };
    result[key] = result[key].slice(input.offset, input.offset + input.limit);
  }
  return { workspace_id: workspaceId, requested_range: { from: input.from, to: input.to }, reporting_range: range,
    funnel_id: selected?.id || null, funnel_config: selected?.config || null, filters, report_revision: ctx.revision,
    currency: raw.currencies[0] || null, coverage_gaps, pagination,
    notes: ['Read-only cached Meta data; no sync is triggered.', 'Range ends before today in Asia/Jakarta, matching the dashboard.',
      'Totals are summed events, not averaged ratios. Previous is the preceding equal-length period in overview.',
      'Daily/trends history includes completion flags. Do not interpret missing coverage as zero performance.',
      'Report revision records data changes, not necessarily the last successful sync.'], report: result };
}
export function registerMetaFunnelTools(server: McpServer, db: SupabaseClient, workspaceId: string) {
  server.tool('meta_ad_funnel_catalog', 'List saved Meta Ad Funnels, configured metrics, active ad accounts, brands, and report revision in this workspace. Read this before selecting funnel_id or brand_id. Read-only.', {}, async () => content(await funnelContext(db, workspaceId)));
  server.tool('meta_ad_funnel_report', 'Read the same Meta Ad Funnel report RPC used by the dashboard: per-ad or landing-page performance, prior-period totals, CEP/intention/objective filters, daily history, trends, or creatives. Dates are WIB, max 93 days, capped at yesterday. Default funnel is the first saved landing-page funnel, as in the dashboard. Paginate groups/history/creatives with offset/limit; totals remain for the full selection. Read-only.', reportSchema.shape, async input => content(await readFunnelReport(db, workspaceId, input)));
}
