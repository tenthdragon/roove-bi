'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { validateMetaAdChannel } from '@/lib/meta-ad-channels';
import MetaAdMappings from '@/components/MetaAdMappings';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import styles from '../page.module.css';

export default function MetaAdMappingPage() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  const params = useSearchParams();
  let channel = 'non_cpas';
  try { channel = validateMetaAdChannel(params.get('channel') ?? undefined); } catch { /* Invalid links open the default group. */ }
  return <div className={styles.page}>
    <Link className={styles.backLink} href={`/dashboard/meta-funnels?channel=${channel}`}>← Kembali ke performa</Link>
    <MetaAdMappings key={activeWorkspace.id} workspaceId={activeWorkspace.id} canManage={can('admin:meta')} />
  </div>;
}
