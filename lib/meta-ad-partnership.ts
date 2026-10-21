export const PARTNERSHIP_ORDER = ['partnership', 'non_partnership', 'unknown'] as const;
export type PartnershipStatus = typeof PARTNERSHIP_ORDER[number];
export const PARTNERSHIP_LABELS: Record<PartnershipStatus, string> = {
  partnership: 'Partnership', non_partnership: 'Non-partnership', unknown: 'Belum diketahui',
};
export const PARTNERSHIP_DESCRIPTIONS: Record<PartnershipStatus, string> = {
  partnership: 'Penanda sponsor Facebook atau Instagram ditemukan pada metadata creative terbaru yang tersinkron.',
  non_partnership: 'Metadata berhasil diperiksa tanpa penanda sponsor atau konfigurasi branded content. Klasifikasi berdasarkan metadata Meta yang tersedia.',
  unknown: 'Metadata belum diperiksa, tidak dapat dibaca, tidak lengkap, atau identitas creative tidak cocok.',
};
// Request only these safe leaves: the full branded_content object can contain access tokens.
export const PARTNERSHIP_FIELDS = 'branded_content_sponsor_page_id,facebook_branded_content{sponsor_page_id},instagram_branded_content{sponsor_id},branded_content{ad_format}';
export type PartnershipMetadata = { version: 1; status: PartnershipStatus; facebook_sponsor_id: string | null;
  instagram_sponsor_id: string | null; legacy_sponsor_id: string | null; ad_format: number | null };
const id = (value: unknown): string | null => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : null;
const record = (v: unknown): Record<string, unknown> | null => !!v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
/** A missing field in old cached data is not a completed provider inspection. */
export function partnershipMetadata(creative: Record<string, unknown>, inspected = false): PartnershipMetadata {
  const facebook = record(creative.facebook_branded_content), instagram = record(creative.instagram_branded_content);
  const branded = record(creative.branded_content);
  const facebook_sponsor_id = id(facebook?.sponsor_page_id), instagram_sponsor_id = id(instagram?.sponsor_id);
  const legacy_sponsor_id = id(creative.branded_content_sponsor_page_id);
  const ad_format = typeof branded?.ad_format === 'number' && Number.isSafeInteger(branded.ad_format) ? branded.ad_format : null;
  // Any unfamiliar/non-empty branded configuration remains unknown, even when its sponsor is inaccessible.
  const evidence = [creative.facebook_branded_content, creative.instagram_branded_content, creative.branded_content,
    creative.branded_content_sponsor_page_id].some(v => v != null && (typeof v !== 'object' || Object.keys(v).length > 0));
  const status: PartnershipStatus = !inspected || !id(creative.id) ? 'unknown'
    : facebook_sponsor_id || instagram_sponsor_id || legacy_sponsor_id ? 'partnership' : evidence ? 'unknown' : 'non_partnership';
  return { version: 1, status, facebook_sponsor_id, instagram_sponsor_id, legacy_sponsor_id, ad_format };
}
