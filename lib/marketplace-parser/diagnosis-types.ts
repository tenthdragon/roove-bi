export type BundleOption = { id: number; name: string; price: string };
export type BundleFinding = {
  id: number;
  name: string;
  sku: string;
  owner: string;
  ownerBusinessId: number | null;
  availableInBusiness: boolean;
  installedStoreIds: number[];
  options: BundleOption[];
  canShare: boolean;
  optionsSynced?: boolean;
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
  storeId: number;
  mode: 'refresh' | 'attach';
  items: { sku: string; bundleId: number; optionId: number; share: boolean }[];
};
export type RepairResult = {
  items: { sku: string; stage: 'ready' | 'shared' | 'attached' | 'failed'; message: string }[];
  synced: boolean;
  message: string;
};
