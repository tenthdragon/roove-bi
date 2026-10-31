import { ALL_TABS, canAccessTab, type TabDef } from './utils';

export function getCurrentTab(path: string) {
  const seg = path.replace('/dashboard', '').replace(/^\//, '');
  return seg.startsWith('meta-funnels/') ? 'meta-funnels' : seg || 'overview';
}

export function getTabPath(tabId: string) {
  return tabId === 'overview' ? '/dashboard' : '/dashboard/' + tabId;
}

function hasAdminAreaAccess(role: string, permissions: Set<string>) {
  if (role === 'owner') return true;
  if (permissions.has('tab:admin')) return true;

  for (const permission of permissions) {
    if (permission.startsWith('admin:')) return true;
  }

  return false;
}

export function canAccessLayoutTab(role: string, tab: TabDef, permissions: Set<string>) {
  // Sales Channel Analysis inherits its parent Sales Channel permission.
  if (tab.id === 'sales-channel-analysis') return canAccessTab(role, 'channels', permissions);
  if (tab.id === 'manual-ad-spend' && !['owner', 'admin', 'brand_manager', 'advertiser'].includes(role)) return false;
  if (tab.id === 'admin') return hasAdminAreaAccess(role, permissions);
  if (tab.ownerOnly && role !== 'owner') return false;
  return canAccessTab(role, tab.id, permissions);
}

export function getOrderedAccessibleTabIds(role: string, permissions: Set<string>) {
  const ids: string[] = [];

  for (const tab of ALL_TABS) {
    if (canAccessLayoutTab(role, tab, permissions)) ids.push(tab.id);
    if (tab.children) {
      for (const child of tab.children) {
        if (canAccessLayoutTab(role, child, permissions)) ids.push(child.id);
      }
    }
  }

  return ids;
}

export function buildVisibleTabs(role: string, permissions: Set<string>) {
  return ALL_TABS.map(tab => {
    const parentVisible = canAccessLayoutTab(role, tab, permissions);
    const visibleChildren = tab.children?.filter(child => canAccessLayoutTab(role, child, permissions)) ?? [];

    if (tab.children) {
      if (!parentVisible && visibleChildren.length === 0) return null;
      return { ...tab, children: visibleChildren };
    }

    if (!parentVisible) return null;
    return tab;
  }).filter(Boolean);
}

