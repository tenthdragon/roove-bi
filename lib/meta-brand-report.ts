import { emptyTotals } from './meta-funnel-domain';
import type { RawMetaReport } from './meta-ad-report';

/** Only fields used by the brand summary cross the database boundary. */
export type MetaBrandReport = {
  reports: { brand: string; channel: 'non_cpas' | 'cpas'; report: RawMetaReport }[];
  cepSpend: { brand: string; cep: string; spend: number }[];
  facets: RawMetaReport['facets'];
  facetTotals: RawMetaReport['facetTotals'];
  cepLabels: Record<string, string>;
};

export function emptyMetaBrandReport(): RawMetaReport {
  return { currencies: [], summary: emptyTotals(), previous: emptyTotals(), groups: [], coverage: [], facets: [], facetTotals: {}, brandCounts: {},
    matchingAds: 0, objectiveUnknownAds: 0, destinations: { urls: 0, missing_ads: 0, multi_ads: 0, missing: [] }, history: [], historyComplete: false, creatives: [] };
}
