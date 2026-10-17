'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMetaFunnelNotificationCount } from '@/lib/meta-funnel-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

const items = [
  { href: '/dashboard/meta-funnels', label: 'Ringkasan brand', match: (p: string) => p === '/dashboard/meta-funnels' || p.startsWith('/dashboard/meta-funnels/brand') },
  { href: '/dashboard/meta-funnels/mapping', label: 'Pemetaan Ads', match: (p: string) => p.startsWith('/dashboard/meta-funnels/mapping') },
  { href: '/dashboard/meta-funnels/notifications', label: 'Notifikasi', match: (p: string) => p.startsWith('/dashboard/meta-funnels/notifications') },
  { href: '/dashboard/meta-funnels/templates', label: 'Template funnel', match: (p: string) => p.startsWith('/dashboard/meta-funnels/templates') },
];

/** Sub-navigation shared by every Meta Ads page. */
export default function MetaAdsNav({ title, subtitle, actions }: { title?: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const { activeWorkspace } = useWorkspace();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const n = await getMetaFunnelNotificationCount(); if (active) setUnread(n); } catch { /* The bell stays quiet on access errors. */ } };
    void refresh();
    window.addEventListener('meta-funnel-notifications-changed', refresh);
    return () => { active = false; window.removeEventListener('meta-funnel-notifications-changed', refresh); };
  }, [activeWorkspace.id]);
  return <div className={styles.subnavArea}>
    <nav aria-label="Menu Meta Ads" className={styles.subnav}>
      {items.map(item => { const active = item.match(pathname); return <Link key={item.href} href={item.href} className={active ? styles.subnavActive : ''} aria-current={active ? 'page' : undefined}>
        {item.label}{item.label === 'Notifikasi' && unread > 0 && <span className={styles.subnavBadge} aria-label={`${unread} belum dibaca`}>{unread > 99 ? '99+' : unread}</span>}
      </Link>; })}
    </nav>
    {(title || actions) && <div className={styles.header}>
      <div>{title && <h1>{title}</h1>}{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>}
  </div>;
}
