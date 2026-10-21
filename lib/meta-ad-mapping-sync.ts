import { createServiceSupabase } from './service-supabase';
import { resolveWorkspaceCredential } from './workspace-integration-server';
import { fetchAdInventory, fetchCreativeBatch, normalizeCreativeMetadata } from './meta-ad-insights';
import { normalizeLandingPages } from './meta-ad-destinations';
import { parseAdMapping } from './meta-ad-mapping';
import { metaMetadataSource, metadataRefreshDecision, type MetadataState } from './meta-ad-metadata-state';
import { requireExplicitWorkspaceId } from './workspace-scope';
import { enqueueMetaAdMappingCreatives } from './meta-ad-mapping-queue';
import { enqueueNewMetaProductSets } from './meta-product-set-queue';
import { refreshMetaAdDestinations } from './meta-ad-destination-metadata';
import { shiftDay } from './meta-funnel-domain';
import { optimizationInventoryRows } from './meta-ad-optimization';
import { getTodayWIB } from './sync-schedule';

const RECENT_DELIVERY_DAYS = 30;
/** Ads with impressions in the last 30 days; null until migration 217 is installed (then every ad counts as recent). */
async function recentlyDeliveredAds(svc: ReturnType<typeof createServiceSupabase>, workspaceId: string, accountId: string): Promise<Set<string> | null> {
  const today = getTodayWIB();
  const result = await svc.rpc('get_meta_ad_activity', { p_workspace_id: workspaceId, p_from: shiftDay(today, -(RECENT_DELIVERY_DAYS - 1)), p_to: today, p_account_id: accountId });
  if (result.error) { if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(result.error.code)) return null; throw new Error(result.error.message); }
  return new Set((Array.isArray(result.data) ? result.data : []).map((r: any) => String(r.ad_id)));
}

const defaultDependencies = { createServiceSupabase, resolveWorkspaceCredential, fetchAdInventory, fetchCreativeBatch, enqueueMetaAdMappingCreatives, refreshMetaAdDestinations, enqueueNewMetaProductSets };
export async function runMetaAdMappingSync(options: { workspaceId: string; accountId?: string; creativeAdIds?: string[]; parentJobId?: string }, dependencies = defaultDependencies) {
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
  const errors: string[] = []; const warnings: string[] = []; let count = 0; let synced = 0; let creativeJobs = 0; let productSetJobs = 0; let metadataSkipped = 0; let metadataDeferred = 0; const childJobIds: string[] = [];
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
          try {
            const destinations = await dependencies.refreshMetaAdDestinations?.(svc, workspaceId, account.account_id, ids, token, undefined, options.parentJobId);
            productSetJobs += destinations?.product_set_jobs_queued || 0;
            childJobIds.push(...(destinations?.child_job_ids || []));
            const certified = (destinations?.refreshed_ads || []).filter(r => r.source?.creative_id && r.source.adset_id
              && r.source.source_updated_at && r.source.adset_updated_at && successes.some(c => c.ad_id === r.ad_id && c.creative_id === r.creative_id));
            if (certified.length) {
              const state = await svc.rpc('save_meta_ad_metadata_state', { p_workspace_id: workspaceId, p_account_id: account.account_id,
                p_observed_at: observedAt, p_rows: certified.map(r => ({ ad_id: r.ad_id, ...r.source })) });
              if (state.error) throw new Error(state.error.message);
            }
            if (destinations?.failures.length) warnings.push(`${account.account_name}: ${destinations.failures.length} metadata tujuan belum terbaca; bukti sebelumnya dipertahankan.`);
          } catch (e) { warnings.push(`${account.account_name}: ${e instanceof Error ? e.message : 'Metadata tujuan gagal'}`); }
        }
        synced++; continue;
      }
      // Finish every inventory page before touching mapping state. No delivery or
      // spend filter: new and paused ads can exist before they have insights.
      const inventory = await dependencies.fetchAdInventory(account.account_id, token);
      // Rich destination reads are the expensive part. Limit them to ads that
      // delivered recently or are still active; long-paused ads keep the
      // metadata they already have until they deliver again.
      const recent = inventory.length ? await recentlyDeliveredAds(svc, workspaceId, account.account_id) : null;
      const dimensionSchema = await svc.from('meta_ad_mappings').select('campaign_objective').eq('workspace_id', workspaceId).limit(1);
      const dimensionsReady = !dimensionSchema.error;
      const refreshIds: string[] = []; const cachedProductSets = new Set<string>();
      if (dimensionSchema.error && !['42703','PGRST204'].includes(dimensionSchema.error.code)) throw new Error(dimensionSchema.error.message);
      for (let offset = 0; offset < inventory.length; offset += 50) {
        const ads = inventory.slice(offset, offset + 50);
        const cache = await svc.from('meta_ad_creatives').select('ad_id,creative_id,landing_page_urls,updated_at,creative_format')
          .eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ads.map(a => a.id));
        if (cache.error) throw new Error(cache.error.message);
        const cached = new Map((cache.data || []).map(c => [c.ad_id, c]));
        const [states, destinationsCache] = await Promise.all([
          svc.from('meta_ad_metadata_sync_state').select('*').eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ads.map(a => a.id)),
          svc.from('meta_ad_destination_metadata').select('ad_id,creative_id,adset_id,observed_at,metadata').eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ads.map(a => a.id)),
        ]);
        if (states.error || destinationsCache.error) throw new Error(states.error?.message || destinationsCache.error?.message);
        const savedStates = new Map((states.data || []).map(r => [r.ad_id, r as MetadataState]));
        const savedDestinations = new Map((destinationsCache.data || []).map(r => [r.ad_id, r]));
        const adopted: Record<string, unknown>[] = []; const invalidated: string[] = [];
        for (const ad of ads) {
          const source = metaMetadataSource(ad);
          const decision = metadataRefreshDecision(source, savedStates.get(ad.id), cached.get(ad.id), savedDestinations.get(ad.id));
          if (decision === 'refresh' && recent && !recent.has(ad.id) && ad.effective_status !== 'ACTIVE') {
            metadataDeferred++;
            for (const id of savedDestinations.get(ad.id)?.metadata?.product_set_ids || []) cachedProductSets.add(id);
          } else if (decision === 'refresh') { refreshIds.push(ad.id); invalidated.push(ad.id); }
          else {
            metadataSkipped++; if (decision === 'adopt') adopted.push({ ad_id: ad.id, ...source });
            for (const id of savedDestinations.get(ad.id)?.metadata?.product_set_ids || []) cachedProductSets.add(id);
          }
        }
        if (invalidated.length) {
          const removed = await svc.from('meta_ad_metadata_sync_state').delete().eq('workspace_id', workspaceId).eq('account_id', account.account_id)
            .in('ad_id', invalidated).lte('observed_at', observedAt);
          if (removed.error) throw new Error(removed.error.message);
        }
        if (adopted.length) {
          const saved = await svc.rpc('save_meta_ad_metadata_state', { p_workspace_id: workspaceId, p_account_id: account.account_id, p_rows: adopted, p_observed_at: observedAt });
          if (saved.error) throw new Error(saved.error.message);
        }
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
      const optimizationRows = optimizationInventoryRows(inventory);
      for (let offset = 0; offset < optimizationRows.length; offset += 500) {
        const saved = await svc.rpc('save_meta_adset_optimizations', { p_workspace_id: workspaceId, p_account_id: account.account_id,
          p_rows: optimizationRows.slice(offset, offset + 500), p_observed_at: observedAt });
        if (saved.error) throw new Error(saved.error.message);
      }
      // Read rich destinations separately: expanding every creative on /ads can
      // hit Meta's response-size limit; one huge worker job can also time out.
      const children = refreshIds.length ? await dependencies.enqueueMetaAdMappingCreatives(workspaceId, account.account_id, refreshIds, undefined, options.parentJobId, svc) : [];
      creativeJobs += children.length; childJobIds.push(...children);
      if (cachedProductSets.size) {
        const catalogJobs = await dependencies.enqueueNewMetaProductSets(svc, workspaceId, account.account_id, [...cachedProductSets], undefined, undefined, options.parentJobId);
        productSetJobs += catalogJobs.length; childJobIds.push(...catalogJobs);
      }
      const state = await svc.from('meta_ad_mapping_sync_state').upsert({ workspace_id: workspaceId, account_id: account.account_id, last_inventory_at: observedAt, ads_count: inventory.length }, { onConflict: 'workspace_id,account_id' });
      if (state.error) throw new Error(state.error.message);
      synced++;
    } catch (e) { errors.push(`${account.account_name}: ${e instanceof Error ? e.message : 'Pemetaan ad gagal'}`); }
  }
  return { status: errors.length ? synced ? 'partial' as const : 'failed' as const : 'success' as const, rows_inserted: count, accounts_synced: synced, accounts_total: accounts.data?.length || 0, creative_jobs_queued: creativeJobs, product_set_jobs_queued: productSetJobs, child_job_ids: childJobIds, metadata_ads_skipped: metadataSkipped, metadata_ads_deferred: metadataDeferred, errors, warnings };
}
