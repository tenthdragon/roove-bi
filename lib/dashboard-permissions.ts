// Meta Ads can be granted independently of its Marketing Channel parent.
// Keep existing Marketing Channel grants working for current users.
export function dashboardTabPermissionKeys(tabId: string): string[] {
  return tabId === 'meta-funnels'
    ? ['tab:meta-funnels', 'tab:marketing']
    : [`tab:${tabId}`];
}
