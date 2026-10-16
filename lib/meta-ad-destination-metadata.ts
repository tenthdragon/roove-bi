import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLandingPages } from './meta-ad-destinations';
import { classifyMetaCpas } from './meta-cpas-evidence';
import { metaGraph } from './meta-ad-insights';
import { enqueueNewMetaProductSets } from './meta-product-set-queue';

const BASE = 'https://graph.facebook.com/v21.0';
export const META_DESTINATION_FIELDS = 'id,account_id,adset{id,destination_type,promoted_object},creative{id,object_story_spec,asset_feed_spec,link_url,object_url,product_set_id,omnichannel_link_spec,object_store_url,link_deep_link_url}';
export type MetaDestinationMetadata = {
  version: 1; urls: string[]; application_ids: string[]; android_packages: string[];
  ios_app_ids: string[]; product_set_ids: string[]; destination_type: string | null;
};
const unique = (values: string[]) => [...new Set(values)].sort();

/** Retain destination configuration only, never creative copy or signed media URLs. */
export function normalizeMetaDestination(raw: Record<string, any>): MetaDestinationMetadata {
  const urls: string[] = [], apps: string[] = [], packages: string[] = [], ios: string[] = [], sets: string[] = [];
  const urlKeys = new Set(['link', 'link_url', 'object_url', 'website_url', 'url', 'object_store_url', 'object_store_urls', 'link_deep_link_url', 'deeplink_url']);
  const excluded = new Set(['message', 'body', 'title', 'name', 'image_url', 'thumbnail_url', 'image_hash']);
  function visit(value: unknown, key = '') {
    if (typeof value === 'string') {
      if (urlKeys.has(key)) urls.push(value);
      if (['application', 'application_id'].includes(key) && /^\d+$/.test(value)) apps.push(value);
      if (key === 'package_name') packages.push(value);
      if (key === 'app_store_id' && /^\d+$/.test(value)) ios.push(value);
      if (key === 'product_set_id' && /^\d+$/.test(value)) sets.push(value);
    } else if (Array.isArray(value)) value.forEach(v => visit(v, key));
    else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) if (!excluded.has(childKey)) visit(child, childKey);
    }
  }
  visit(raw.creative || {}); visit(raw.adset?.promoted_object || {});
  const normalizedUrls = normalizeLandingPages(urls);
  for (const value of normalizedUrls) {
    const url = new URL(value);
    if (url.hostname === 'play.google.com' && url.pathname === '/store/apps/details') {
      const id = url.searchParams.get('id'); if (id) packages.push(id);
    }
    if (['itunes.apple.com', 'apps.apple.com'].includes(url.hostname)) {
      const id = url.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1]; if (id) ios.push(id);
    }
  }
  return { version: 1, urls: normalizedUrls, application_ids: unique(apps), android_packages: unique(packages),
    ios_app_ids: unique(ios), product_set_ids: unique(sets), destination_type: raw.adset?.destination_type || null };
}

export type DestinationRead = { ad_id: string; account_id: string; creative_id: string | null; adset_id: string | null; metadata: MetaDestinationMetadata };
export type DestinationFailure = { ad_id: string; error: string; code?: number };
export async function fetchAdDestinationBatch(ids: string[], token: string): Promise<{ rows: DestinationRead[]; failures: DestinationFailure[] }> {
  if (!ids.length || ids.length > 50 || ids.some(id => !/^\d+$/.test(id))) throw new Error('Destination batch requires 1–50 numeric ad IDs.');
  const response = await fetch(BASE, { method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ batch: JSON.stringify(ids.map(id => ({ method: 'GET', relative_url: `${id}?fields=${META_DESTINATION_FIELDS}` }))) }),
    signal: AbortSignal.timeout(60000) });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data) || data.length !== ids.length) throw new Error(`Meta destination batch failed (${response.status}).`);
  const rows: DestinationRead[] = [], failures: DestinationFailure[] = [];
  for (let i = 0; i < ids.length; i++) {
    let raw: Record<string, any>;
    try { raw = JSON.parse(data[i].body || '{}'); } catch { failures.push({ ad_id: ids[i], error: 'Invalid JSON response' }); continue; }
    if (data[i].code !== 200 || raw.error || raw.id !== ids[i] || !/^\d+$/.test(raw.account_id || '')) {
      failures.push({ ad_id: ids[i], code: raw.error?.code, error: String(raw.error?.message || 'Missing ad identity').split(token).join('[redacted]').slice(0, 600) }); continue;
    }
    // An opaque creative must not erase previously observed Shopee evidence.
    if (!raw.creative?.id) { failures.push({ ad_id: ids[i], error: 'Creative identity unavailable' }); continue; }
    if (!raw.adset?.id) { failures.push({ ad_id: ids[i], error: 'Ad set identity unavailable' }); continue; }
    rows.push({ ad_id: ids[i], account_id: `act_${raw.account_id}`, creative_id: raw.creative.id,
      adset_id: raw.adset?.id || null, metadata: normalizeMetaDestination(raw) });
  }
  return { rows, failures };
}

/** Verify every returned product, not the catalog name or a single sample. */
export async function verifyShopeeProductSet(productSetId: string, token: string, options: { signal?: AbortSignal } = {}) {
  if (!/^\d+$/.test(productSetId)) throw new Error('Invalid product set identity.');
  const products = new Map<string, string>(); const cursors = new Set<string>(); let after = '';
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    options.signal?.throwIfAborted();
    const page = await metaGraph(`${productSetId}/products`, token, { fields: 'id,url', limit: '500', ...(after ? { after } : {}) }, options);
    if (!Array.isArray(page.data)) throw new Error('Invalid product set products response.');
    for (const product of page.data) {
      const url = normalizeLandingPages([product.url])[0];
      if (!/^\d+$/.test(product.id || '') || !url) throw new Error('Product identity/URL unavailable; product set not verified.');
      if (classifyMetaCpas({ urls: [url], application_ids: [], android_packages: [], ios_app_ids: [], product_set_ids: [], destination_type: null }).classification !== 'cpas') {
        throw new Error('Product set contains a non-Shopee URL; product set not verified.');
      }
      products.set(product.id, url);
    }
    if (!page.paging?.next) {
      if (!products.size) throw new Error('Empty product set; Shopee ownership not verified.');
      return { method: 'meta_product_set_products', complete: true, product_count: products.size,
        samples: [...products].slice(0, 20).map(([product_id, url]) => ({ product_id, url })) };
    }
    after = page.paging.cursors?.after;
    if (!after || cursors.has(after)) throw new Error('Product set pagination incomplete; product set not verified.');
    cursors.add(after);
  }
  throw new Error('Product set exceeded verification page limit; product set not verified.');
}

/** Used only by explicitly requested/scheduled mapping workers, never page reads. */
export async function refreshMetaAdDestinations(svc: SupabaseClient, workspaceId: string, accountId: string, ids: string[], token: string,
  enqueueProductSets = enqueueNewMetaProductSets) {
  if (!workspaceId || !/^act_\d+$/.test(accountId)) throw new Error('Invalid destination workspace/account scope.');
  const schema = await svc.from('meta_ad_destination_metadata').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error) throw new Error(`Destination metadata schema unavailable: ${schema.error.message}`);
  const owned = await svc.from('meta_ad_mappings').select('ad_id').eq('workspace_id', workspaceId).eq('account_id', accountId).in('ad_id', ids);
  if (owned.error) throw new Error(owned.error.message);
  if (new Set((owned.data || []).map(r => r.ad_id)).size !== new Set(ids).size) throw new Error('Destination IDs outside workspace/account.');
  const result = await fetchAdDestinationBatch(ids, token);
  if (result.rows.some(r => r.account_id !== accountId)) throw new Error('Meta returned an ad outside its expected account.');
  const verified = await svc.from('meta_shopee_product_sets').select('product_set_id').eq('workspace_id', workspaceId).eq('account_id', accountId);
  if (verified.error) throw new Error(verified.error.message);
  let productSetJobs = 0;
  if (result.rows.length) {
    const observedAt = new Date().toISOString();
    const saved = await svc.from('meta_ad_destination_metadata').upsert(result.rows.map(r => ({
      workspace_id: workspaceId, account_id: accountId, ad_id: r.ad_id, creative_id: r.creative_id, adset_id: r.adset_id,
      destination_type: r.metadata.destination_type, metadata: r.metadata,
      ...classifyMetaCpas(r.metadata, (verified.data || []).map(v => v.product_set_id)), observed_at: observedAt,
    })), { onConflict: 'workspace_id,account_id,ad_id' });
    if (saved.error) throw new Error(saved.error.message);
    const known = new Set((verified.data || []).map(v => v.product_set_id));
    const newIds = [...new Set(result.rows.flatMap(r => r.metadata.product_set_ids))].filter(id => !known.has(id));
    if (newIds.length) productSetJobs = (await enqueueProductSets(svc, workspaceId, accountId, newIds)).length;
  }
  return { saved: result.rows.length, failures: result.failures, product_set_jobs_queued: productSetJobs };
}
