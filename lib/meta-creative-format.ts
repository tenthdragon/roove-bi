/** Mutually exclusive creative formats from provider metadata, never ad names. */
export const CREATIVE_FORMAT_LABELS = { image: 'Image', video: 'Video', carousel: 'Carousel', mixed: 'Campuran / flexible', unknown: 'Belum diketahui' } as const;
export type CreativeFormat = keyof typeof CREATIVE_FORMAT_LABELS;
export const CREATIVE_FORMAT_ORDER = Object.keys(CREATIVE_FORMAT_LABELS) as CreativeFormat[];
const present = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
export function classifyCreativeFormat(creative: Record<string, any>): CreativeFormat {
  const story = creative.object_story_spec || {}, feed = creative.asset_feed_spec || {};
  const formats = list(feed.ad_formats).filter((v): v is string => typeof v === 'string');
  const carousel = list(story.link_data?.child_attachments).length > 0 || formats.includes('CAROUSEL');
  const video = creative.object_type === 'VIDEO' || present(creative.video_id) || present(story.video_data?.video_id) || list(feed.videos).some(v => present(v?.video_id));
  // Video cover images and thumbnails are not image creatives.
  const image = creative.object_type === 'PHOTO' || present(creative.image_hash) || present(creative.image_url)
    || present(story.link_data?.image_hash) || present(story.link_data?.picture)
    || present(story.photo_data?.image_hash) || present(story.photo_data?.url)
    || list(feed.images).some(v => present(v?.hash) || present(v?.url));
  if (formats.includes('AUTOMATIC_FORMAT') || (formats.includes('CAROUSEL') && formats.some(v => v !== 'CAROUSEL'))) return 'mixed';
  if (carousel) return 'carousel';
  if (video && list(feed.images).some(v => present(v?.hash) || present(v?.url))) return 'mixed';
  if (video) return 'video';
  if (image) return 'image';
  return 'unknown';
}

/** Explicit media type from the creative's linked Instagram media. */
export function classifyCreativeMedia(media: Record<string, any>): CreativeFormat {
  switch (media.media_type) {
    case 'IMAGE': return 'image';
    case 'VIDEO': return 'video';
    case 'CAROUSEL_ALBUM': return 'carousel';
    default: return 'unknown';
  }
}
