import { createMetaOverviewCache } from './meta-overview-cache';
import { createMetaReportRequests } from './meta-report-requests';

/** Inventory is independent of dates, search, paging and filters. */
export function createMetaWorklistCache<I extends { ready: boolean }, A extends { ready: boolean }>() {
  const inventory = createMetaOverviewCache<I>(300_000, 4);
  const activity = createMetaOverviewCache<A>(300_000, 12);
  // Independent sources overlap on first load; each still admits only one miss
  // at a time across workspaces, with duplicate requests sharing one promise.
  const inventoryRequests = createMetaReportRequests(1);
  const activityRequests = createMetaReportRequests(1);
  function read<T extends { ready: boolean }>(cache: ReturnType<typeof createMetaOverviewCache<T>>, requests: ReturnType<typeof createMetaReportRequests>, key: string, load: () => Promise<T>) {
    const hit = cache.get(key); if (hit) return Promise.resolve(hit);
    return requests.run(key, async () => { const value = await load(); if (value.ready) cache.set(key, value); return value; });
  }
  return {
    inventory: (workspaceId: string, revision: string, load: () => Promise<I>) => read(inventory, inventoryRequests, JSON.stringify(['inventory', workspaceId, revision]), load),
    activity: (workspaceId: string, revision: string, from: string, to: string, load: () => Promise<A>) => read(activity, activityRequests, JSON.stringify(['activity', workspaceId, revision, from, to]), load),
  };
}
