'use client';

import Link from 'next/link';
import MetaAdMappings from '@/components/MetaAdMappings';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import styles from '../page.module.css';

export default function MetaAdMappingPage() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  return <div className={styles.page}>
    <Link className={styles.backLink} href="/dashboard/meta-funnels">← Kembali ke performa</Link>
    <MetaAdMappings key={activeWorkspace.id} workspaceId={activeWorkspace.id} canManage={can('admin:meta')} />
  </div>;
}
