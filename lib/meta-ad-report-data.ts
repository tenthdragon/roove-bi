import { unstable_cache } from 'next/cache';
import { createServiceSupabase } from './service-supabase';
import { createMetaReportRequests, MetaReportUnavailableError } from './meta-report-requests';
import type { RawMetaReport, ReportQuery } from './meta-ad-report';
import type { MetaBrandReport } from './meta-brand-report';
import type { AdDimensionFilters } from './meta-ad-dimensions';

async function intentionLabels(workspaceId: string, brand?: string | null) {
  let query = createServiceSupabase().from('meta_ad_intention_catalog').select('key,label').eq('workspace_id', workspaceId);
  if (brand && /^\d+$/.test(brand)) query = query.eq('brand_id', Number(brand));
  const { data, error } = await query;
  if (error) throw new MetaReportUnavailableError(false);
  // Shared canonical names stay stable on multi-brand reports.
  return Object.fromEntries((data || []).filter(c => brand || !['disc','cons','conv'].includes(c.key)).map(c => [c.key,c.label]));
}

// Next may load this module from different route bundles; share the database
// budget across them. Results live only in Next's revision-keyed cache.
const processState = globalThis as typeof globalThis & { metaReportRequests?: ReturnType<typeof createMetaReportRequests> };
const requests = processState.metaReportRequests ??= createMetaReportRequests(2);

// Auth is checked by the Server Action before every call, including cache hits.
// The database revision changes atomically with successful sync/metadata writes.
// This also invalidates results when a CLI worker writes outside Next.js.
export const getCachedMetaAdReport = unstable_cache(
  (workspaceId: string, revision: string, query: ReportQuery): Promise<RawMetaReport> => requests.run(
    JSON.stringify([workspaceId, revision, query]), async () => {
      const result = await createServiceSupabase().rpc('get_meta_ad_report_incremental', {
        p_workspace_id: workspaceId, p_from: query.from, p_to: query.to, p_config: query.config,
        p_filters: { ...query.filters, ...(query.channel ? { channel: query.channel } : {}) }, p_brand: query.brand, p_group_by: query.groupBy,
        p_view: query.view, p_period: query.period, p_group_key: query.groupKey,
      });
      if (result.error) {
        console.error('[meta-ad-report] RPC failed', { code: result.error.code, message: result.error.message });
        throw new MetaReportUnavailableError(result.error.code === '57014');
      }
      return { ...result.data, intentionLabels: await intentionLabels(workspaceId, query.brand) } as RawMetaReport;
  }),
  ['meta-ad-report-v9-optimization'],
  { revalidate: 300 },
);

export const getCachedMetaBrandDetailReport = unstable_cache(
  (workspaceId: string, revision: string, from: string, to: string, brand: string, channel: string, filters: AdDimensionFilters): Promise<{ website: RawMetaReport; cpas: RawMetaReport; cep: RawMetaReport }> => requests.run(
    JSON.stringify(['brand-detail', workspaceId, revision, from, to, brand, channel, filters]), async () => {
      const result = await createServiceSupabase().rpc('get_meta_brand_detail_report', {
        p_workspace_id: workspaceId, p_from: from, p_to: to, p_brand: brand, p_channel: channel, p_filters: filters,
      });
      if (result.error) {
        console.error('[meta-brand-detail] RPC failed', { code: result.error.code, message: result.error.message });
        throw new MetaReportUnavailableError(result.error.code === '57014');
      }
      const labels = await intentionLabels(workspaceId, brand);
      return Object.fromEntries(Object.entries(result.data).map(([key,value]) => [key,{ ...(value as object), intentionLabels: labels }])) as { website: RawMetaReport; cpas: RawMetaReport; cep: RawMetaReport };
    }),
  ['meta-brand-detail-v4-optimization'], { revalidate: 300 },
);

// One batched report shares the same database budget as detail/history reads.
// Database day projections survive Next cache expiry and workspace revisions.
export const getCachedMetaBrandOverviewReport = unstable_cache(
  (workspaceId: string, revision: string, from: string, to: string, filters: AdDimensionFilters, brandIds: number[] | null = null): Promise<MetaBrandReport> => requests.run(
    JSON.stringify(['brand-overview', workspaceId, revision, from, to, filters, brandIds]), async () => {
      const result = await createServiceSupabase().rpc(brandIds === null ? 'get_meta_brand_overview_report' : 'get_meta_brand_overview_report_scoped', {
        p_workspace_id: workspaceId, p_from: from, p_to: to, p_filters: filters, ...(brandIds === null ? {} : { p_brand_ids: brandIds }),
      });
      if (result.error) {
        console.error('[meta-brand-overview] RPC failed', { code: result.error.code, message: result.error.message });
        throw new MetaReportUnavailableError(result.error.code === '57014');
      }
      return { ...result.data, intentionLabels: await intentionLabels(workspaceId) } as MetaBrandReport;
    }),
  ['meta-brand-overview-v1-incremental'],
  { revalidate: 300 },
);
