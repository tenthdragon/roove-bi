'use client';

import styles from '@/app/dashboard/meta-funnels/page.module.css';

export type MetaAdCreativeData = { thumbnail_url: string | null; body: string | null; ad_id: string; account_id: string; creative_id: string | null; video_id: string | null };

export default function MetaAdCreative({ creative }: { creative: MetaAdCreativeData }) {
  return <a className={styles.creative} target="_blank" rel="noopener noreferrer" title={creative.body || `Ad ${creative.ad_id}`} href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${creative.account_id.replace('act_', '')}&selected_ad_ids=${creative.ad_id}`}>
    {/* Signed Meta thumbnails are served directly, without a server image proxy. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {creative.thumbnail_url && <img src={creative.thumbnail_url} alt={`Creative ad ${creative.ad_id}`} onError={e => { e.currentTarget.style.display = 'none'; }} />}
    <span>{creative.video_id ? 'Video' : 'Creative'} · {creative.ad_id}</span>
  </a>;
}
