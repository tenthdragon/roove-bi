import { classifyCreativeFormat, classifyCreativeMedia } from './meta-creative-format';
import { emptyTotals, type Totals } from './meta-funnel-domain';
import { selectPurchaseMetric, type MetaActionMetric } from './meta-marketing';
import { creativeLandingPages } from './meta-ad-destinations';

const BASE = 'https://graph.facebook.com/v21.0';
export const AD_INSIGHT_FIELDS = 'ad_id,ad_name,campaign_id,campaign_name,objective,adset_id,adset_name,spend,impressions,reach,frequency,clicks,inline_link_clicks,outbound_clicks,instagram_profile_visits,actions,action_values,purchase_roas,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions';
export type RawAdInsight = {
  ad_id: string; ad_name: string; date_start: string; date_stop: string;
  [key: string]: unknown;
};
export type MetaInventoryAd = { id: string; name: string; effective_status?: string; creative?: { id: string; [key: string]: any }; campaign_id?: string; campaign?: { id: string; name?: string; objective?: string }; adset_id?: string; adset?: { id: string; updated_time?: string; optimization_goal?: string; destination_type?: string; promoted_object?: Record<string, unknown> }; updated_time?: string };

export async function fetchAdInventory(accountId: string, token: string): Promise<MetaInventoryAd[]> {
  let page = await metaGraph(`${accountId}/ads`, token, {
    fields: 'id,name,effective_status,creative{id},campaign_id,campaign{id,name,objective},adset_id,updated_time,adset{id,updated_time,optimization_goal,destination_type,promoted_object}', limit: '500',
  });
  const ads = new Map<string, MetaInventoryAd>(); const seen = new Set<string>();
  while (true) {
    if (!Array.isArray(page.data)) throw new Error('Meta returned an invalid ad inventory');
    for (const ad of page.data) {
      if (!/^\d+$/.test(ad.id) || typeof ad.name !== 'string') throw new Error('Meta returned an invalid inventory ad');
      ads.set(ad.id, ad);
    }
    if (ads.size > 50000) throw new Error('Inventori akun terlalu besar untuk satu sync pemetaan.');
    if (!page.paging?.next) break;
    if (seen.has(page.paging.next)) throw new Error('Meta repeated an inventory pagination cursor');
    seen.add(page.paging.next);
    page = await metaGraphUrl(page.paging.next, token);
  }
  return [...ads.values()];
}

export async function metaGraph(path: string, token: string, params: Record<string, string> = {}, options: { signal?: AbortSignal } = {}) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return metaGraphUrl(url.toString(), token, options.signal);
}
async function metaGraphUrl(url: string, token: string, signal?: AbortSignal) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://graph.facebook.com') throw new Error('Invalid Meta pagination host');
  // Pagination URLs may embed credentials; never log them or their values.
  parsed.searchParams.delete('access_token');
  const timeout = AbortSignal.timeout(60000);
  const response = await fetch(parsed, { headers: { Authorization: `Bearer ${token}` }, signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(`Meta API (${body.error?.code || response.status}): ${String(body.error?.message || response.statusText).split(token).join('[redacted]')}`);
  return body;
}
export async function fetchAdInsights(accountId: string, from: string, to: string, token: string): Promise<RawAdInsight[]> {
  let page = await metaGraph(`${accountId}/insights`, token, {
    fields: AD_INSIGHT_FIELDS, level: 'ad', time_increment: '1', limit: '500',
    time_range: JSON.stringify({ since: from, until: to }),
    // Same attribution basis for every snapshot; use each adset's configured window.
    use_unified_attribution_setting: 'true', action_report_time: 'impression',
  });
  const rows: RawAdInsight[] = [];
  const seen = new Set<string>();
  while (true) {
    if (!Array.isArray(page.data)) throw new Error('Meta returned an invalid ad report');
    rows.push(...page.data);
    if (!page.paging?.next) break;
    if (seen.has(page.paging.next)) throw new Error('Meta repeated a pagination cursor');
    seen.add(page.paging.next);
    page = await metaGraphUrl(page.paging.next, token);
  }
  return rows;
}
const value = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
function action(raw: unknown, types: string[]) {
  const actions = Array.isArray(raw) ? raw as MetaActionMetric[] : [];
  // Meta reports overlapping aliases; select one rather than summing them.
  for (const type of types) { const found = actions.find(a => a.action_type === type); if (found) return value(found.value); }
  return 0;
}
export function normalizeInstagramProfileVisits(raw: unknown): number | null {
  if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function normalizeAdInsight(raw: RawAdInsight): Totals {
  const total = emptyTotals();
  total.spend = value(raw.spend); total.impressions = value(raw.impressions); total.clicks = value(raw.clicks);
  total.link_clicks = value(raw.inline_link_clicks); total.outbound_clicks = action(raw.outbound_clicks, ['outbound_click']);
  total.lpv = action(raw.actions, ['omni_landing_page_view', 'landing_page_view']);
  total.view_content = action(raw.actions, ['omni_view_content', 'view_content', 'offsite_conversion.fb_pixel_view_content']);
  total.atc = action(raw.actions, ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']);
  total.checkout = action(raw.actions, ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']);
  total.purchases = selectPurchaseMetric(raw.actions as MetaActionMetric[])?.value || 0;
  const purchaseValue = selectPurchaseMetric(raw.action_values as MetaActionMetric[]);
  const roas = selectPurchaseMetric(raw.purchase_roas as MetaActionMetric[]);
  total.purchase_value = purchaseValue?.value ?? (roas ? roas.value * total.spend : 0);
  total.video_plays = action(raw.video_play_actions, ['video_view']); total.video_3s = action(raw.actions, ['video_view']);
  total.thruplay = action(raw.video_thruplay_watched_actions, ['video_view']);
  for (const percent of [25, 50, 75, 100] as const) total[`video_${percent}`] = action(raw[`video_p${percent}_watched_actions`], ['video_view']);
  total.leads = action(raw.actions, ['lead', 'onsite_conversion.lead_grouped', 'onsite_conversion.lead']);
  total.conversations = action(raw.actions, ['onsite_conversion.messaging_conversation_started_7d']);
  total.instagram_profile_visits = normalizeInstagramProfileVisits(raw.instagram_profile_visits);
  total.replies = action(raw.actions, ['onsite_conversion.messaging_first_reply']);
  return total;
}

export async function fetchCreativeBatch(ids: string[], token: string) {
  // Two bounded media passes at most; never download media or infer from a name.
  if (!ids.length || ids.length > 50 || ids.some(id => !/^\d+$/.test(id))) throw new Error('Invalid creative batch');
  const fields = 'id,name,thumbnail_url,video_id,image_hash,image_url,object_type,call_to_action,object_story_spec,asset_feed_spec,link_url,object_url,effective_instagram_media_id,source_instagram_media_id';
  async function readBatch(paths: string[]) {
    const response = await fetch(BASE, { method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: new URLSearchParams({ batch: JSON.stringify(paths.map(relative_url => ({ method: 'GET', relative_url }))) }), signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data) || data.length !== paths.length) throw new Error('Gagal mengambil metadata creative Meta.');
    return data.map((item: { code: number; body: string }) => {
      try { const body = JSON.parse(item.body || '{}'); return item.code === 200 && !body.error ? body : null; }
      catch { return null; }
    });
  }
  const bodies = await readBatch(ids.map(id => `${id}?fields=id,name,creative{${fields}}`));
  const rows = bodies.map((body, i) => body ? normalizeCreativeMetadata(ids[i], body.name || '', body.creative || {}) : { ad_id: ids[i], error: true as const });
  const resolved = new Map<string, ReturnType<typeof classifyCreativeMedia>>();
  for (const field of ['effective_instagram_media_id', 'source_instagram_media_id']) {
    const pending = rows.flatMap((row, i) => {
      const mediaId = bodies[i]?.creative?.[field];
      return !('error' in row) && row.creative_format === 'unknown' && typeof mediaId === 'string' && /^\d+$/.test(mediaId) ? [{ i, mediaId }] : [];
    });
    const mediaIds = [...new Set(pending.map(p => p.mediaId))].filter(id => !resolved.has(id));
    try {
      if (mediaIds.length) {
        const media = await readBatch(mediaIds.map(id => `${id}?fields=id,media_type`));
        mediaIds.forEach((id, i) => resolved.set(id, media[i]?.id === id ? classifyCreativeMedia(media[i]) : 'unknown'));
      }
    } catch { mediaIds.forEach(id => resolved.set(id, 'unknown')); }
    // Preserve a successful creative even if its linked media is unavailable.
    for (const { i, mediaId } of pending) {
      const row = rows[i], format = resolved.get(mediaId);
      if (!('error' in row) && format && format !== 'unknown') row.creative_format = format;
    }
  }
  return rows;
}

export function normalizeCreativeMetadata(adId: string, name: string, creative: Record<string, any>) {
  const story = creative.object_story_spec || {};
  return { ad_id: adId, creative_id: creative.id || null, name,
    thumbnail_url: creative.thumbnail_url || null, video_id: creative.video_id || story.video_data?.video_id || null,
    creative_format: classifyCreativeFormat(creative),
    landing_page_urls: creativeLandingPages(creative),
    body: story.video_data?.message || story.link_data?.message || story.photo_data?.message || null };
}
