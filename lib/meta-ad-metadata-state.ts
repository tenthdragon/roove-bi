import { createHash } from 'node:crypto';

export type MetadataSource = { creative_id: string | null; adset_id: string | null; source_fingerprint: string; source_updated_at: string | null; adset_updated_at: string | null };
export type MetadataState = MetadataSource & { ad_id: string; observed_at: string };
export type MetadataCreativeCache = { ad_id: string; creative_id: string | null; updated_at?: string };
export type MetadataDestinationCache = { ad_id: string; creative_id: string | null; adset_id: string | null; observed_at: string; metadata?: { contact_identity_checked?: boolean; contact_identity?: { version?: number } } };
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
/** Includes ad-set changes even when Meta keeps the same creative ID. */
export function metaMetadataSource(ad: Record<string, any>): MetadataSource {
  const creative_id = ad.creative?.id || null, adset_id = ad.adset?.id || ad.adset_id || null;
  const source_updated_at = timestamp(ad.updated_time), adset_updated_at = timestamp(ad.adset?.updated_time);
  const identity = { version: 1, creative_id, adset_id, source_updated_at, adset_updated_at,
    destination_type: ad.adset?.destination_type || null, promoted_object: ad.adset?.promoted_object || null };
  return { creative_id, adset_id, source_updated_at, adset_updated_at,
    source_fingerprint: createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex') };
}
export function metadataRefreshDecision(source: MetadataSource, state: MetadataState | undefined,
  creative: MetadataCreativeCache | undefined, destination: MetadataDestinationCache | undefined): 'refresh' | 'cached' | 'adopt' {
  if (!source.creative_id || !source.adset_id || !source.source_updated_at || !source.adset_updated_at
    || !creative || creative.creative_id !== source.creative_id || !destination || destination.creative_id !== source.creative_id
    || destination.adset_id !== source.adset_id || !(destination.metadata?.contact_identity?.version === 1 || destination.metadata?.contact_identity_checked)) return 'refresh';
  if (state) return state.source_fingerprint === source.source_fingerprint ? 'cached' : 'refresh';
  // Adopt successful pre-migration observations without another provider read.
  // Missing/older timestamps cannot certify a cache hit.
  const observed = Math.min(Date.parse(creative.updated_at || ''), Date.parse(destination.observed_at));
  return observed >= Math.max(Date.parse(source.source_updated_at), Date.parse(source.adset_updated_at)) ? 'adopt' : 'refresh';
}
