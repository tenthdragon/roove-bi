// Both child pages also inherit their parent report's permission.
export function dashboardTabPermissionKeys(tabId: string): string[] {
  if (tabId === 'marketplace-data-parser') return ['tab:marketplace-data-parser', 'tab:channels'];
  return tabId === 'meta-funnels'
    ? ['tab:meta-funnels', 'tab:marketing']
    : [`tab:${tabId}`];
}
