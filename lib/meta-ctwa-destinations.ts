import { normalizeWhatsAppNumber } from './meta-ad-contact-identity';

export type CtwaDestination = {
  kind: 'ctwa'; key: string; brand_id: string; phone_number: string | null;
  status: 'known' | 'missing' | 'multiple'; page_id: string | null;
};
const brandPattern = '(?:[1-9][0-9]*|__unmapped__)';
export const CTWA_KEY_PATTERN = new RegExp(`^ctwa:${brandPattern}:(?:phone:\\+[1-9][0-9]{6,14}|missing:act_[0-9]+:(?:page|ad):[1-9][0-9]*|multiple:act_[0-9]+:ad:[1-9][0-9]*)$`);

/** Explicit WhatsApp destinations only. A website that leads to WA is still a website. */
export function whatsappDestinationUrl(url: string): { whatsapp: boolean; number: string | null } {
  const send = url.match(/^https?:\/\/(?:api|web)\.whatsapp\.com\/send\/?(?:\?([^#]*))?(?:#.*)?$/i);
  const short = url.match(/^https?:\/\/wa\.me\/([0-9]+)\/?(?:[?#].*)?$/i);
  const phone = send?.[1]?.match(/(?:^|&)phone=((?:%2b|\+)?[0-9]+)(?:&|$)/i)?.[1]?.replace(/^%2b/i, '+');
  return { whatsapp: !!send || !!short, number: normalizeWhatsAppNumber(phone || short?.[1]) };
}

/** Mirrors meta_ctwa_destination in migration 213; never fans one ad into multiple numbers. */
export function ctwaDestination(input: {
  brandId: string; accountId: string; adId: string; urls: string[];
  metadata?: Record<string, any> | null;
}): CtwaDestination | null {
  const { brandId, accountId, adId, metadata } = input;
  const urls = input.urls.map(whatsappDestinationUrl);
  const identity = metadata?.contact_identity;
  const numbers = [...new Set([
    ...(Array.isArray(identity?.whatsapp_phone_numbers) ? identity.whatsapp_phone_numbers : []),
    ...urls.map(u => u.number),
  ].map(normalizeWhatsAppNumber).filter((n): n is string => !!n))].sort();
  if (metadata?.destination_type !== 'WHATSAPP' && !urls.some(u => u.whatsapp) && !numbers.length) return null;
  const page = typeof identity?.page_id === 'string' && /^[1-9][0-9]*$/.test(identity.page_id) ? identity.page_id : null;
  const status = numbers.length === 1 ? 'known' : numbers.length > 1 ? 'multiple' : 'missing';
  const suffix = status === 'known' ? `phone:${numbers[0]}` : status === 'multiple'
    ? `multiple:${accountId}:ad:${adId}` : `missing:${accountId}:${page ? `page:${page}` : `ad:${adId}`}`;
  return { kind: 'ctwa', key: `ctwa:${brandId}:${suffix}`, brand_id: brandId,
    phone_number: status === 'known' ? numbers[0] : null, status, page_id: status === 'missing' ? page : null };
}

export function ctwaLabel(destination: CtwaDestination, brandName?: string): string {
  return ['WhatsApp', brandName, destination.phone_number || (destination.status === 'multiple' ? 'Beberapa nomor · perlu verifikasi' : 'Nomor belum tersedia')].filter(Boolean).join(' · ');
}

export function templateDestinationRule(group: { key: string; landing_page_urls: string[]; destination?: CtwaDestination | null }) {
  return group.destination ? { match_kind: 'ctwa' as const, pattern: group.destination.key }
    : { match_kind: 'exact' as const, pattern: group.landing_page_urls[0] };
}
