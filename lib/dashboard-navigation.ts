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
  if (tab.id === 'manual-ad-spend' && !['owner', 'admin', 'brand_manager', 'sales_manager', 'advertiser'].includes(role)) return false;
  if (tab.id === 'admin') return hasAdminAreaAccess(role, permissions);
  if (tab.ownerOnly && role !== 'owner') return false;
  return canAccessTab(role, tab.id, permissions);
}

export function getOrderedAccessibleTabIds(role: string, permissions: Set<string>) {
  const ids: string[] = [];

  for (const tab of buildVisibleTabs(role, permissions)) {
    if (canAccessLayoutTab(role, tab, permissions)) ids.push(tab.id);
    if (tab.children) {
      for (const child of tab.children) {
        if (canAccessLayoutTab(role, child, permissions)) ids.push(child.id);
      }
    }
  }

  return [...new Set(ids)];
}

export function buildVisibleTabs(role: string, permissions: Set<string>) {
  return ALL_TABS.map(tab => {
    const parentVisible = canAccessLayoutTab(role, tab, permissions);
    const visibleChildren = tab.children?.filter(child => {
      if (!canAccessLayoutTab(role, child, permissions)) return false;
      // Shared spend links follow accessible channel pages. A spend-only user
      // still gets one entry point without gaining access to the parent report.
      if (child.id === 'manual-ad-spend' && !parentVisible) {
        return tab.id === (role === 'sales_manager' ? 'channels' : 'marketing');
      }
      return true;
    }) ?? [];

    if (tab.children) {
      if (!parentVisible && visibleChildren.length === 0) return null;
      return { ...tab, children: visibleChildren };
    }

    if (!parentVisible) return null;
    return tab;
  }).filter((tab): tab is TabDef => tab !== null);
}

export function getMobileTabs(tabs: TabDef[], role: string, permissions: Set<string>) {
  const seen = new Set<string>();
  return tabs.flatMap(tab => {
    const parent = { ...tab, children: undefined };
    const children = tab.children?.map(child => ({ ...child, group: tab.group })) ?? [];
    return canAccessLayoutTab(role, tab, permissions) ? [parent, ...children] : children;
  }).filter(tab => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

export function getActiveParentId(tabs: TabDef[], tabId: string, preferredParentId: string | null, role: string) {
  const parents = tabs.filter(tab => tab.children?.some(child => child.id === tabId));
  const preferred = parents.find(tab => tab.id === preferredParentId);
  const sales = role === 'sales_manager' ? parents.find(tab => tab.id === 'channels') : undefined;
  return (preferred ?? sales ?? parents[0])?.id;
}

