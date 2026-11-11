export type BundleOption = { id: number; name: string; price: string };
export type BundleFinding = {
  id: number;
  name: string;
  sku: string;
  owner: string;
  ownerBusinessId: number | null;
  availableInBusiness: boolean;
  canShare: boolean;
};
export type SkuDiagnosis = {
  sku: string;
  status: 'found' | 'missing' | 'ambiguous' | 'unavailable';
  bundles: BundleFinding[];
  message: string;
};
export type ParserDiagnosis = {
  checkedAt: string;
  catalogSyncedAt?: string | null;
  business: string;
  account: string;
  stores: { id: number; name: string }[];
  suggestedStoreId: number | null;
  items: SkuDiagnosis[];
  issues: string[];
  token: string;
};
export type DiagnosisRequest = { account: string; revision: number; skus: string[] };
export type RepairRequest = {
  token: string;
  mode: 'refresh' | 'share';
  items: { sku: string; bundleId: number }[];
};
export type RepairResult = {
  items: { sku: string; stage: 'ready' | 'shared' | 'failed'; message: string }[];
  synced: boolean;
  message: string;
};
