'use client';

import MetaAdMappings from '@/components/MetaAdMappings';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import MetaAdsNav from '@/components/MetaAdsNav';
import styles from '../page.module.css';

export default function MetaAdMappingPage() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  return <div className={styles.page}>
    <MetaAdsNav />
    <MetaAdMappings key={activeWorkspace.id} workspaceId={activeWorkspace.id} canManage={can('admin:meta')} />
  </div>;
}
