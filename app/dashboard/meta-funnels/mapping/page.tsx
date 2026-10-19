'use client';

import { Suspense } from 'react';
import MetaAdMappings from '@/components/MetaAdMappings';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import styles from '../page.module.css';

export default function MetaAdMappingPage() {
  const { activeWorkspace } = useWorkspace();
  const { can, role } = usePermissions();
  return <div className={styles.page}>
    <Suspense fallback={null}><MetaAdMappings key={activeWorkspace.id} workspaceId={activeWorkspace.id} canManage={role !== 'advertiser' && can('admin:meta')} /></Suspense>
  </div>;
}
