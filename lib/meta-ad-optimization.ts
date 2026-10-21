import { objectiveLabel } from './meta-ad-dimensions';
import type { MetaInventoryAd } from './meta-ad-insights';

export type MetaOptimization = {
  objective: string | null; optimization_goal: string | null; conversion_event: string | null; custom_conversion_id: string | null;
};
const GOALS: Record<string, string> = {
  LINK_CLICKS: 'Link clicks', LANDING_PAGE_VIEWS: 'Landing Page Views', REACH: 'Reach', IMPRESSIONS: 'Impressions',
  AD_RECALL_LIFT: 'Ad recall', THRUPLAY: 'ThruPlay', VIDEO_VIEWS: 'Video views', VALUE: 'Conversion value',
  LEAD_GENERATION: 'Leads', QUALITY_LEAD: 'Qualified leads', CONVERSATIONS: 'Conversations',
  MESSAGING_PURCHASE_CONVERSION: 'Messaging purchases', VISIT_INSTAGRAM_PROFILE: 'Instagram visits',
  PROFILE_VISIT: 'Profile visits', POST_ENGAGEMENT: 'Post engagement', PAGE_LIKES: 'Page likes', APP_INSTALLS: 'App installs',
};
const EVENTS: Record<string, string> = {
  PURCHASE: 'Purchase', INITIATED_CHECKOUT: 'Initiate Checkout', ADD_TO_CART: 'Add to Cart', VIEW_CONTENT: 'View Content',
  LEAD: 'Lead', COMPLETE_REGISTRATION: 'Complete Registration', ADD_PAYMENT_INFO: 'Add Payment Info', SEARCH: 'Search',
  CONTACT: 'Contact', SUBSCRIBE: 'Subscribe', START_TRIAL: 'Start Trial',
};
const readable = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
export function optimizationTarget(value: MetaOptimization): string {
  if (!value.optimization_goal) return 'Optimasi belum terbaca';
  if (value.optimization_goal === 'OFFSITE_CONVERSIONS') {
    if (value.custom_conversion_id) return `Custom conversion · ${value.custom_conversion_id}`;
    return value.conversion_event ? EVENTS[value.conversion_event] || readable(value.conversion_event) : 'Conversion · event belum terbaca';
  }
  if (value.optimization_goal === 'VALUE' && value.conversion_event === 'PURCHASE') return 'Purchase value';
  return GOALS[value.optimization_goal] || readable(value.optimization_goal);
}
export function optimizationLabel(value: MetaOptimization) {
  return `${value.objective ? objectiveLabel(value.objective) : 'Objective belum terbaca'} · ${optimizationTarget(value)}`;
}
export function optimizationDescription(value: MetaOptimization) {
  return [value.objective && `Objective: ${objectiveLabel(value.objective)}`, value.optimization_goal && `Optimasi: ${readable(value.optimization_goal)}`,
    value.conversion_event && `Event: ${EVENTS[value.conversion_event] || readable(value.conversion_event)}`,
    value.custom_conversion_id && `Custom conversion: ${value.custom_conversion_id}`].filter(Boolean).join(' · ');
}
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
const id = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v) ? v : null;
/** Inventory already reads these adset fields; no additional provider requests. */
export function optimizationInventoryRows(ads: MetaInventoryAd[]) {
  const rows = new Map<string, { adset_id: string; campaign_id: string; campaign_objective: string | null; optimization_goal: string | null;
    conversion_event: string | null; custom_conversion_id: string | null; source_updated_at: string | null }>();
  for (const ad of ads) {
    const adset_id = id(ad.adset?.id), campaign_id = id(ad.campaign?.id || ad.campaign_id);
    if (!adset_id || !campaign_id) continue;
    const timestamp = ad.adset?.updated_time;
    const source_updated_at = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null;
    const row = { adset_id, campaign_id, campaign_objective: text(ad.campaign?.objective), optimization_goal: text(ad.adset?.optimization_goal),
      conversion_event: text(ad.adset?.promoted_object?.custom_event_type), custom_conversion_id: id(ad.adset?.promoted_object?.custom_conversion_id), source_updated_at };
    const prior = rows.get(adset_id);
    if (prior && prior.campaign_id !== campaign_id) throw new Error('Inventori memuat campaign berbeda untuk adset yang sama.');
    if (!prior || (source_updated_at || '') >= (prior.source_updated_at || '')) rows.set(adset_id, row);
  }
  return [...rows.values()];
}
