import { createServiceSupabase } from './service-supabase';
import { resolveWorkspaceCredential } from './workspace-integration-server';
import { fetchAdInventory, fetchCreativeBatch, normalizeCreativeMetadata } from './meta-ad-insights';
import { normalizeLandingPages } from './meta-ad-destinations';
import { parseAdMapping } from './meta-ad-mapping';
import { requireExplicitWorkspaceId } from './workspace-scope';
import { enqueueMetaAdMappingCreatives } from './meta-ad-mapping-queue';

const defaultDependencies = { createServiceSupabase, resolveWorkspaceCredential, fetchAdInventory, fetchCreativeBatch, enqueueMetaAdMappingCreatives };
export async function runMetaAdMappingSync(options: { workspaceId: string; accountId?: string; creativeAdIds?: string[] }, dependencies = defaultDependencies) {
  const workspaceId = requireExplicitWorkspaceId(options.workspaceId, 'Meta ad mapping sync');
  if (options.creativeAdIds && (!options.accountId || !options.creativeAdIds.length || options.creativeAdIds.length > 100 || options.creativeAdIds.some(id => !/^\d+$/.test(id)))) throw new Error('Batch creative harus memiliki satu akun dan 1–100 ad ID.');
  const svc = dependencies.createServiceSupabase();
  const schema = await svc.from('meta_ad_mappings').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error) {
    if (['42P01', 'PGRST205'].includes(schema.error.code)) return { status: 'success' as const, rows_inserted: 0, errors: [], warnings: [], message: 'Migration 201 belum terpasang; pemetaan dilewati.' };
    throw new Error(schema.error.message);
  }
  let query = svc.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId).eq('is_active', true);
  if (options.accountId) query = query.eq('account_id', options.accountId);
  const accounts = await query;
  if (accounts.error) throw new Error(accounts.error.message);
  if (options.accountId && !accounts.data?.length) throw new Error('Akun Meta tidak aktif atau tidak tersedia dalam workspace.');
  const token = await dependencies.resolveWorkspaceCredential({ supabase: svc, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
  const errors: string[] = []; const warnings: string[] = []; let count = 0; let synced = 0; let creativeJobs = 0;
  for (const account of accounts.data || []) {
    const observedAt = new Date().toISOString();
    try {
      if (options.creativeAdIds) {
        const scope = await svc.from('meta_ad_mappings').select('ad_id,ad_name,effective_status').eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', options.creativeAdIds);
        if (scope.error) throw new Error(scope.error.message);
        const owned = new Map((scope.data || []).map(a => [a.ad_id, a]));
        if (options.creativeAdIds.some(id => !owned.has(id))) throw new Error('Creative batch memuat ad di luar pemetaan akun/workspace.');
        for (let offset = 0; offset < options.creativeAdIds.length; offset += 50) {
          const ids = options.creativeAdIds.slice(offset, offset + 50);
          const metadata = await dependencies.fetchCreativeBatch(ids, token);
          const successes = metadata.filter((m): m is ReturnType<typeof normalizeCreativeMetadata> => !('error' in m) && !!m.creative_id);
          if (successes.length) {
            const saved = await svc.from('meta_ad_creatives').upsert(successes.map(m => ({ ...m, workspace_id: workspaceId, account_id: account.account_id, updated_at: observedAt })), { onConflict: 'workspace_id,account_id,ad_id' });
            if (saved.error) throw new Error(saved.error.message);
            const rows = successes.map(m => ({ ad_id: m.ad_id, ad_name: m.name || owned.get(m.ad_id)!.ad_name, creative_id: m.creative_id,
              effective_status: owned.get(m.ad_id)!.effective_status, landing_page_urls: normalizeLandingPages(m.landing_page_urls), auto_mapping: parseAdMapping(m.name || owned.get(m.ad_id)!.ad_name) }));
            const result = await svc.rpc('upsert_meta_ad_mappings', { p_workspace_id: workspaceId, p_account_id: account.account_id, p_rows: rows, p_source: 'inventory', p_observed_at: observedAt });
            if (result.error) throw new Error(result.error.message); count += Number(result.data || 0);
          }
          if (successes.length !== ids.length) warnings.push(`${account.account_name}: ${ids.length - successes.length} creative belum terbaca; pemetaan nama tetap disimpan.`);
        }
        synced++; continue;
      }
      // Finish every inventory page before touching mapping state. No delivery or
      // spend filter: new and paused ads can exist before they have insights.
      const inventory = await dependencies.fetchAdInventory(account.account_id, token);
      const dimensionSchema = await svc.from('meta_ad_mappings').select('campaign_objective').eq('workspace_id', workspaceId).limit(1);
      const dimensionsReady = !dimensionSchema.error;
      if (dimensionSchema.error && !['42703','PGRST204'].includes(dimensionSchema.error.code)) throw new Error(dimensionSchema.error.message);
      for (let offset = 0; offset < inventory.length; offset += 50) {
        const ads = inventory.slice(offset, offset + 50);
        const cache = await svc.from('meta_ad_creatives').select('ad_id,creative_id,landing_page_urls')
          .eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ads.map(a => a.id));
        if (cache.error) throw new Error(cache.error.message);
        const cached = new Map((cache.data || []).map(c => [c.ad_id, c]));
        const destinations = new Map(ads.map(a => [a.id, a.creative?.id && a.creative.id === cached.get(a.id)?.creative_id ? normalizeLandingPages(cached.get(a.id)?.landing_page_urls) : []]));
        const creativeIds = new Map(ads.map(a => [a.id, a.creative?.id || null]));
        if (ads.some(ad => !ad.creative?.id)) warnings.push(`${account.account_name}: identitas beberapa creative belum terbaca; pemetaan nama tetap disimpan.`);
        const rows = ads.map(ad => ({ ad_id: ad.id, ad_name: ad.name, creative_id: creativeIds.get(ad.id), effective_status: ad.effective_status || null,
          landing_page_urls: destinations.get(ad.id) || [], auto_mapping: parseAdMapping(ad.name) }));
        const saved = await svc.rpc('upsert_meta_ad_mappings', { p_workspace_id: workspaceId, p_account_id: account.account_id, p_rows: rows, p_source: 'inventory', p_observed_at: observedAt });
        if (saved.error) throw new Error(saved.error.message);
        count += Number(saved.data || 0);
        if (dimensionsReady) {
          const campaigns = await svc.rpc('set_meta_ad_campaign_dimensions', { p_workspace_id: workspaceId, p_account_id: account.account_id,
            p_rows: ads.filter(ad=>ad.campaign?.id || ad.campaign_id).map(ad => ({ ad_id: ad.id, campaign_id: ad.campaign?.id || ad.campaign_id || null, campaign_name: ad.campaign?.name || null, campaign_objective: ad.campaign?.objective || null })), p_observed_at: observedAt });
          if (campaigns.error) throw new Error(campaigns.error.message);
        }
      }
      // Read rich destinations separately: expanding every creative on /ads can
      // hit Meta's response-size limit; one huge worker job can also time out.
      creativeJobs += (await dependencies.enqueueMetaAdMappingCreatives(workspaceId, account.account_id, inventory.map(a => a.id))).length;
      const state = await svc.from('meta_ad_mapping_sync_state').upsert({ workspace_id: workspaceId, account_id: account.account_id, last_inventory_at: observedAt, ads_count: inventory.length }, { onConflict: 'workspace_id,account_id' });
      if (state.error) throw new Error(state.error.message);
      synced++;
    } catch (e) { errors.push(`${account.account_name}: ${e instanceof Error ? e.message : 'Pemetaan ad gagal'}`); }
  }
  return { status: errors.length ? synced ? 'partial' as const : 'failed' as const : 'success' as const, rows_inserted: count, accounts_synced: synced, accounts_total: accounts.data?.length || 0, creative_jobs_queued: creativeJobs, errors, warnings };
}
