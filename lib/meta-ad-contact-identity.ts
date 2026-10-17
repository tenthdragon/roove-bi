export type MetaAdContactIdentity = {
  version: 1; creative_id: string; adset_id: string;
  page_id: string | null; page_ids: string[];
  page_sources: Record<string, string>;
  whatsapp_phone_numbers: string[];
  whatsapp_sources: { path: string; number: string }[];
};

const numericId = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d*$/.test(v);
export function normalizeWhatsAppNumber(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/[\s().-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Never infer a country code for a local number, or treat a phone-number ID as a number.
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}

/** Keep structured destination identities, not names, copy, or signed preview content. */
export function normalizeMetaAdContactIdentity(raw: Record<string, any>): MetaAdContactIdentity | null {
  const creative = raw.creative || {}, spec = creative.object_story_spec || {}, promoted = raw.adset?.promoted_object || {};
  if (!numericId(creative.id) || !numericId(raw.adset?.id)) return null;
  const sources: Record<string, unknown> = {
    'adset.promoted_object.page_id': promoted.page_id,
    'creative.object_story_spec.page_id': spec.page_id,
    'creative.actor_id': creative.actor_id,
  };
  for (const key of ['effective_object_story_id', 'object_story_id']) {
    const id = creative[key];
    if (typeof id === 'string' && /^[1-9]\d*_[1-9]\d*$/.test(id)) sources[`creative.${key}`] = id.split('_')[0];
  }
  const page_sources = Object.fromEntries(Object.entries(sources).filter((entry): entry is [string, string] => numericId(entry[1])));
  const whatsapp_sources: MetaAdContactIdentity['whatsapp_sources'] = [];
  const add = (value: unknown, path: string) => {
    const number = normalizeWhatsAppNumber(value);
    if (number && !whatsapp_sources.some(s => s.path === path && s.number === number)) whatsapp_sources.push({ path, number });
  };
  const whatsappFields = new Set(['whats_app_business_phone_number', 'whatsapp_phone_number', 'whatsapp_number']);
  const excluded = new Set(['message', 'body', 'title', 'name', 'description', 'image_url', 'thumbnail_url']);
  const isWhatsApp = raw.adset?.destination_type === 'WHATSAPP' || creative.call_to_action?.type === 'WHATSAPP_MESSAGE'
    || spec.link_data?.call_to_action?.type === 'WHATSAPP_MESSAGE' || spec.video_data?.call_to_action?.type === 'WHATSAPP_MESSAGE';
  function visit(value: unknown, path: string, inWhatsAppField = false) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (excluded.has(key)) continue;
      const next = `${path}.${key}`, explicit = inWhatsAppField || whatsappFields.has(key);
      if (whatsappFields.has(key) || (inWhatsAppField && ['phone_number', 'display_phone_number', 'number'].includes(key))
        || (isWhatsApp && key === 'phone_number')) add(child, next);
      if (typeof child === 'string' && ['link', 'link_url', 'url', 'website_url', 'deeplink_url'].includes(key)) {
        try {
          const url = new URL(child);
          if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
            if (['api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname) && url.pathname.replace(/\/$/, '') === '/send') add(url.searchParams.get('phone'), `${next}?phone`);
            if (url.hostname === 'wa.me' && /^\/\d+\/?$/.test(url.pathname)) add(url.pathname.replace(/\//g, ''), `${next}:path`);
          }
        } catch { /* Non-URL values are not contact evidence. */ }
      }
      if (child && typeof child === 'object') visit(child, next, explicit);
    }
  }
  visit(creative, 'creative'); visit(promoted, 'adset.promoted_object');
  const page_ids = [...new Set(Object.values(page_sources))].sort();
  const whatsapp_phone_numbers = [...new Set(whatsapp_sources.map(s => s.number))].sort();
  if (!page_ids.length && !whatsapp_phone_numbers.length) return null;
  return { version: 1, creative_id: creative.id, adset_id: raw.adset.id,
    page_id: Object.values(page_sources)[0] || null, page_ids, page_sources, whatsapp_phone_numbers, whatsapp_sources };
}
