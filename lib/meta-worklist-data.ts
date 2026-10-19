import { createServiceSupabase } from './service-supabase';
import { readAll, loadVerifiedDestinations } from './meta-funnel-store';
import { loadTaxonomy } from './meta-taxonomy-store';
import { createMetaWorklistCache } from './meta-worklist-cache';
import { classifyWorklistInventory } from './meta-worklist-inventory';
import { MetaReportUnavailableError } from './meta-report-requests';
import type { AdMapping } from './meta-ad-mapping';
import type { AdActivity, DestinationHint } from './meta-ad-worklist';

const MISSING = ['42P01', 'PGRST205', '42883', 'PGRST202'];
const fields = 'account_id,ad_id,ad_name,creative_id,effective_status,landing_page_urls,auto_mapping,overrides,source,first_seen_at,last_seen_at,revision,ad_channel,ad_channel_reason';
async function loadInventory(workspaceId: string) {
  const svc = createServiceSupabase();
  const schema = await svc.from('meta_ad_classifications').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error && MISSING.includes(schema.error.code)) return { ready: false as const };
  if (schema.error) throw schema.error;
  const [mappings, verified, hints, taxonomy, accounts] = await Promise.all([
    readAll<AdMapping>(svc, 'meta_ad_mapping_channels', fields + ',campaign_id,campaign_name,campaign_objective', workspaceId).catch(e => {
      if (/campaign/.test(String(e?.message))) return readAll<AdMapping>(svc, 'meta_ad_mapping_channels', fields, workspaceId);
      throw e;
    }),
    loadVerifiedDestinations(svc, workspaceId),
    readAll<{ account_id: string; ad_id: string; creative_id: string | null; classification: string | null; destination_type: string | null; urls: string[] | null }>(svc,
      'meta_ad_destination_metadata', 'account_id,ad_id,creative_id,classification,destination_type:metadata->>destination_type,urls:metadata->urls', workspaceId)
      .catch(e => { if (/meta_ad_destination_metadata/.test(String(e?.message))) return []; throw e; }),
    loadTaxonomy(workspaceId),
    svc.from('meta_ad_accounts').select('account_id,account_name,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name'),
  ]);
  if (accounts.error) throw accounts.error;
  const ids = new Set((accounts.data || []).map(a => a.account_id));
  const destinations: DestinationHint[] = hints.filter(h => ids.has(h.account_id)).map(h => ({ account_id: h.account_id, ad_id: h.ad_id, creative_id: h.creative_id,
    classification: h.classification, metadata: { destination_type: h.destination_type, urls: Array.isArray(h.urls) ? h.urls : [] } }));
  const classified = classifyWorklistInventory(mappings, accounts.data || [], taxonomy.catalog, taxonomy.rules);
  return { ready: true as const, mappings: classified, verified: verified.rows, destinations, taxonomy, accounts: accounts.data || [] };
}
type Inventory = Awaited<ReturnType<typeof loadInventory>>;
type Activity = { ready: boolean; rows: AdActivity[] };
// A workspace inventory can exceed Next's 2 MiB entry limit. Retain a bounded
// process-local copy, shared across route bundles, rather than duplicating it per
// filter/page or serializing the entire dictionary into each disk cache entry.
const state = globalThis as typeof globalThis & { metaWorklistData?: ReturnType<typeof createMetaWorklistCache<Inventory, Activity>> };
const cache = state.metaWorklistData ??= createMetaWorklistCache<Inventory, Activity>();

/** Callers must authorize the active workspace before reading either cache. */
export async function getMetaWorklistInventory(workspaceId: string, revision: string): Promise<Inventory> {
  return cache.inventory(workspaceId, revision, async () => {
    try {
      const result = await loadInventory(workspaceId);
      return result;
    } catch (error) {
      console.error('[meta-worklist] Inventory failed', error);
      throw new MetaReportUnavailableError(false);
    }
  });
}
export async function getMetaWorklistActivity(workspaceId: string, revision: string, from: string, to: string): Promise<Activity> {
  return cache.activity(workspaceId, revision, from, to, async () => {
    const result = await createServiceSupabase().rpc('get_meta_ad_activity', { p_workspace_id: workspaceId, p_from: from, p_to: to, p_account_id: null });
    if (result.error && MISSING.includes(result.error.code)) return { ready: false, rows: [] };
    if (result.error) { console.error('[meta-worklist] Activity failed', result.error); throw new MetaReportUnavailableError(result.error.code === '57014'); }
    const data = { ready: true, rows: (Array.isArray(result.data) ? result.data : []).map((r: any) => ({ account_id: String(r.account_id), ad_id: String(r.ad_id), spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, last_active: r.last_active || null })) };
    return data;
  });
}
