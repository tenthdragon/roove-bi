import { unstable_cache } from 'next/cache';
import { createServiceSupabase } from './service-supabase';
import { createMetaReportRequests, MetaReportUnavailableError } from './meta-report-requests';
import type { RawMetaReport, ReportQuery } from './meta-ad-report';

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
      const result = await createServiceSupabase().rpc('get_meta_ad_report', {
        p_workspace_id: workspaceId, p_from: query.from, p_to: query.to, p_config: query.config,
        p_filters: { ...query.filters, ...(query.channel ? { channel: query.channel } : {}) }, p_brand: query.brand, p_group_by: query.groupBy,
        p_view: query.view, p_period: query.period, p_group_key: query.groupKey,
      });
      if (result.error) {
        console.error('[meta-ad-report] RPC failed', { code: result.error.code, message: result.error.message });
        throw new MetaReportUnavailableError(result.error.code === '57014');
      }
      return result.data as RawMetaReport;
  }),
  ['meta-ad-report-v5-brand-taxonomy'],
  { revalidate: 300 },
);
