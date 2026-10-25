'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { getMetaFunnelNotificationCount } from '@/lib/meta-funnel-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';

export default function MetaFunnelNotifications() {
  const { activeWorkspace } = useWorkspace();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const value = await getMetaFunnelNotificationCount(); if (active) setCount(value); }
      catch { /* Page surfaces configuration/access errors; bell stays unobtrusive. */ }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    window.addEventListener('meta-funnel-notifications-changed', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('meta-funnel-notifications-changed', refresh); };
  }, [activeWorkspace.id]);
  return <Link className="meta-funnel-notifications" href="/dashboard/meta-funnels/notifications" title={`${count} notifikasi funnel belum dibaca`} aria-label={`${count} notifikasi funnel belum dibaca`}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: count ? 'var(--red)' : 'var(--dim)', fontSize: 11 }}>
    <Bell size={14} aria-hidden="true" />{count > 0 && <span className="meta-funnel-notifications-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
  </Link>;
}
