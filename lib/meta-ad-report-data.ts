import { unstable_cache } from 'next/cache';
import { createServiceSupabase } from './service-supabase';
import type { RawMetaReport, ReportQuery } from './meta-ad-report';

// Auth is checked by the Server Action before every call, including cache hits.
// The database revision changes atomically with successful sync/metadata writes.
// This also invalidates results when a CLI worker writes outside Next.js.
export const getCachedMetaAdReport = unstable_cache(
  async (workspaceId: string, _revision: string, query: ReportQuery): Promise<RawMetaReport> => {
    const result = await createServiceSupabase().rpc('get_meta_ad_report', {
      p_workspace_id: workspaceId, p_from: query.from, p_to: query.to, p_config: query.config,
      p_filters: { ...query.filters, ...(query.channel ? { channel: query.channel } : {}) }, p_brand: query.brand, p_group_by: query.groupBy,
      p_view: query.view, p_period: query.period, p_group_key: query.groupKey,
    });
    if (result.error) throw new Error(`Gagal memuat performa Meta: ${result.error.message}`);
    return result.data as RawMetaReport;
  },
  ['meta-ad-report-v3-ctwa'],
  { revalidate: 300 },
);
