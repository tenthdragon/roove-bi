import { mappingUnit, parseAdMapping } from './meta-ad-mapping';
import type { AdFact } from './meta-funnel-domain';

export const META_OBJECTIVES: Record<string,string> = {
  OUTCOME_SALES: 'Sales', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement', OUTCOME_LEADS: 'Leads', OUTCOME_APP_PROMOTION: 'App promotion',
  CONVERSIONS: 'Conversions (legacy)', PRODUCT_CATALOG_SALES: 'Catalog sales (legacy)',
};
export type AdDimensions = { account_id: string; ad_id: string; cep_key: string | null; intention_key: string | null; campaign_id: string | null; campaign_name: string | null; campaign_objective: string | null };
export type AdDimensionFilters = { cep?: string; objective?: string; intention?: string };
export const objectiveLabel = (key: string) => META_OBJECTIVES[key] || (key === '__unknown__' ? 'Objective belum terbaca' : key);
export function dimensionLabel(dimension: 'cep'|'intention', key: string) {
  if (key === '__unknown__') return dimension === 'cep' ? 'CEP belum terpetakan' : 'Intention belum terpetakan';
  return mappingUnit(dimension,key).label.replace(/^Kesehatan /u,'');
}
export function validateDimensionFilters(input: AdDimensionFilters = {}): AdDimensionFilters {
  const result: AdDimensionFilters = {};
  for (const dimension of ['cep','intention','objective'] as const) {
    const value = input[dimension];
    if (value !== undefined && (typeof value !== 'string' || value.length > 500)) throw new Error('Filter dimensi tidak valid.');
    if (!value) continue;
    result[dimension] = value === '__unknown__' ? value : dimension === 'objective' ? value.trim().toUpperCase() : mappingUnit(dimension,value).key;
  }
  return result;
}
export function withAdDimensions(facts: AdFact[], mappings: AdDimensions[]) {
  const ads = new Map(mappings.map(m => [`${m.account_id}:${m.ad_id}`,m]));
  const campaigns = new Map(mappings.filter(m => m.campaign_id && m.campaign_objective).map(m => [`${m.account_id}:${m.campaign_id}`,m.campaign_objective!]));
  return facts.map(row => {
    const mapping = ads.get(`${row.account_id}:${row.ad_id}`);
    const parsed = parseAdMapping(row.ad_name);
    return { ...row,
      cep_key: mapping ? mapping.cep_key : parsed.tags.find(t => t.dimension === 'cep')?.key || null,
      intention_key: mapping ? mapping.intention_key : parsed.tags.find(t => t.dimension === 'intention')?.key || null,
      // Use a report-observed objective first. A metadata fallback must match the
      // fact's actual campaign ID, not just the ad's current name or creative.
      campaign_objective: row.campaign_objective || (row.campaign_id && mapping?.campaign_id === row.campaign_id ? mapping.campaign_objective : null)
        || (row.campaign_id ? campaigns.get(`${row.account_id}:${row.campaign_id}`) : null) || null,
    };
  });
}
export function matchesAdDimensions(row: ReturnType<typeof withAdDimensions>[number], filters: AdDimensionFilters) {
  return (!filters.cep || (row.cep_key || '__unknown__') === filters.cep)
    && (!filters.intention || (row.intention_key || '__unknown__') === filters.intention)
    && (!filters.objective || (row.campaign_objective || '__unknown__') === filters.objective);
}
export function dimensionOptions(mappings: AdDimensions[], rows: ReturnType<typeof withAdDimensions> = [], filters: AdDimensionFilters = {}) {
  const valueFor = (row: Pick<AdDimensions, 'cep_key'|'intention_key'|'campaign_objective'>, dimension: keyof AdDimensionFilters) =>
    (dimension === 'objective' ? row.campaign_objective : dimension === 'cep' ? row.cep_key : row.intention_key) || '__unknown__';
  const options = (dimension: keyof AdDimensionFilters) => {
    const otherFilters = { ...filters };
    delete otherFilters[dimension];
    const values = new Set(mappings.map(m => valueFor(m, dimension)));
    const adsByValue = new Map<string, Set<string>>();
    const allAds = new Set<string>();
    // Count each ad once across reporting days. Apply the other dimensions so
    // every choice shows how many ads selecting it would return.
    for (const row of rows) {
      if (!matchesAdDimensions(row, otherFilters)) continue;
      const value = valueFor(row, dimension);
      const ad = `${row.account_id}:${row.ad_id}`;
      values.add(value);
      if (!adsByValue.has(value)) adsByValue.set(value, new Set());
      adsByValue.get(value)!.add(ad);
      allAds.add(ad);
    }
    const choices = [...values].map(value => ({ value, label: dimension === 'objective' ? objectiveLabel(value) : dimensionLabel(dimension, value), count: adsByValue.get(value)?.size || 0 }))
      .sort((a,b) => b.count - a.count || a.label.localeCompare(b.label, 'id'));
    return { choices, total: allAds.size };
  };
  const ceps = options('cep'), intentions = options('intention'), objectives = options('objective');
  return { ceps: ceps.choices, cepTotal: ceps.total, intentions: intentions.choices, intentionTotal: intentions.total, objectives: objectives.choices, objectiveTotal: objectives.total };
}
