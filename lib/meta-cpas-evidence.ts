import { canonicalLandingPage } from './meta-ad-destinations';

const SHOPEE_APP_ID = '957549474255294';
const SHOPEE_ANDROID_PACKAGE = 'com.shopee.id';
const SHOPEE_IOS_APP_ID = '959841443';
const SHOPEE_HOSTS = ['shopee.co.id', 'shp.ee'];
const NON_WEBSITE_TRANSIT_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'play.google.com', 'itunes.apple.com', 'apps.apple.com'];

export type MetaCpasMetadata = {
  urls: string[];
  application_ids: string[];
  android_packages: string[];
  ios_app_ids: string[];
  product_set_ids: string[];
  destination_type: string | null;
};

export type MetaCpasEvidence = { type: string; value: string };

function exactMatch(values: unknown, expected: string): string | null {
  if (!Array.isArray(values)) return null;
  for (const value of values) {
    if (typeof value === 'string' && value.trim() === expected) return expected;
  }
  return null;
}

function isShopeeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return SHOPEE_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function isNonWebsiteTransitHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return NON_WEBSITE_TRANSIT_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** Classifies an ad as CPAS only when its supplied metadata contains explicit Shopee evidence. */
export function classifyMetaCpas(
  metadata: MetaCpasMetadata,
  verifiedProductSetIds: string[] = [],
): { classification: 'cpas' | 'unknown'; evidence: MetaCpasEvidence[] } {
  const evidence: MetaCpasEvidence[] = [];
  let strongShopeeIdentity = false;

  const appId = exactMatch(metadata?.application_ids, SHOPEE_APP_ID);
  if (appId) { evidence.push({ type: 'application_id', value: appId }); strongShopeeIdentity = true; }

  const androidPackage = exactMatch(metadata?.android_packages, SHOPEE_ANDROID_PACKAGE);
  if (androidPackage) { evidence.push({ type: 'android_package', value: androidPackage }); strongShopeeIdentity = true; }

  const iosAppId = exactMatch(metadata?.ios_app_ids, SHOPEE_IOS_APP_ID);
  if (iosAppId) { evidence.push({ type: 'ios_app_id', value: iosAppId }); strongShopeeIdentity = true; }

  const verified = new Set(Array.isArray(verifiedProductSetIds) ? verifiedProductSetIds : []);
  let hasVerifiedProductSet = false;
  if (Array.isArray(metadata?.product_set_ids)) {
    for (const id of [...new Set(metadata.product_set_ids)]) {
      if (typeof id === 'string' && verified.has(id)) {
        evidence.push({ type: 'verified_product_set_id', value: id });
        hasVerifiedProductSet = true;
      }
    }
  }

  let hasShopeeUrl = false;
  const externalWebsites: string[] = [];
  if (Array.isArray(metadata?.urls)) {
    for (const input of [...new Set(metadata.urls)]) {
      const canonical = canonicalLandingPage(input);
      if (!canonical) continue;
      try {
        const host = new URL(canonical).hostname;
        if (isShopeeHost(host)) {
          evidence.push({ type: 'shopee_url', value: canonical });
          hasShopeeUrl = true;
        } else if (!isNonWebsiteTransitHost(host)) externalWebsites.push(canonical);
      } catch { /* canonicalLandingPage already validates URLs; keep classification fail-closed. */ }
    }
  }

  if (!strongShopeeIdentity && !hasShopeeUrl && hasVerifiedProductSet && externalWebsites.length) {
    for (const url of [...new Set(externalWebsites)]) evidence.push({ type: 'conflicting_website_url', value: url });
    return { classification: 'unknown', evidence };
  }
  return { classification: strongShopeeIdentity || hasShopeeUrl || hasVerifiedProductSet ? 'cpas' : 'unknown', evidence };
}
