const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'ttclid', '_fbp', '_fbc', 'fb_action_ids', 'fb_action_types', 'fb_source']);

export function canonicalLandingPage(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Facebook's link wrapper is not a landing page. Only unwrap its explicit target.
    if (['l.facebook.com', 'lm.facebook.com'].includes(url.hostname) && url.pathname === '/l.php') return canonicalLandingPage(url.searchParams.get('u'));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch { return null; }
}

export function normalizeLandingPages(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(canonicalLandingPage).filter((url): url is string => !!url))].sort();
}

export function creativeLandingPages(creative: Record<string, any>): string[] {
  const story = creative.object_story_spec || {};
  const link = story.link_data || {}; const template = story.template_data || {};
  const explicit = [creative.link_url, link.link, link.call_to_action?.value?.link,
    story.video_data?.call_to_action?.value?.link, template.link, template.call_to_action?.value?.link,
    ...(link.child_attachments || []).map((card: any) => card.link),
    ...(template.child_attachments || []).map((card: any) => card.link),
    ...(creative.asset_feed_spec?.link_urls || []).map((url: any) => url.website_url)];
  const urls = normalizeLandingPages(explicit);
  // object_url is a fallback: explicit destinations take precedence over a post URL.
  return urls.length ? urls : normalizeLandingPages([creative.object_url]);
}

export function landingPageGroup(values: unknown) {
  const urls = normalizeLandingPages(values);
  if (!urls.length) return { key: 'landing:unknown', name: 'URL belum terbaca', urls };
  if (urls.length > 1) return { key: `landing:multi:${JSON.stringify(urls)}`, name: `Beberapa landing page (${urls.length} URL)`, urls };
  return { key: `landing:${urls[0]}`, name: urls[0], urls };
}
