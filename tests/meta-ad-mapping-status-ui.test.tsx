import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { MetaSyncJob } from '../lib/meta-funnel-sync-status';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const mock = (path: string, exports: any) => { require.cache[require.resolve(path)] = { exports: { __esModule: true, ...exports } } as any; };
let scope = 'user-a:workspace-a', workspaceId = 'workspace-a', queueCalls = 0, statusFails = false, worklistFails = false;
let jobs: MetaSyncJob[] = [], pending = 0;
const rootId = '00000000-0000-4000-8000-000000000001';
const makeJob = (id: string, status: string): MetaSyncJob => ({ id, status, mode: 'ad_mapping', error_message: status === 'failed' ? 'Meta timeout' : null, created_at: '2026-10-20T14:08:00Z', started_at: null, completed_at: null, payload: { ad_mapping_only: true } });
const fixture = () => ({ ready: true, workspaceId, reportVersion: '1', rows: [], tiles: [], state: [], jobs: [], pendingJobs: pending,
  intentions: [], catalog: [], accounts: [], total: 0, scopeAds: 0, scopeSpend: 0, inactiveAds: 0, page: 1, pageSize: 50, activityReady: true,
  range: { from: '2026-10-01', to: '2026-10-19' } });
mock('../lib/meta-ad-mapping-actions', {
  getMetaAdWorklist: async () => { if (worklistFails) throw new Error('Worklist unavailable'); return fixture(); },
  getMetaAdMappingStatus: async (ids?: string[]) => { if (statusFails) throw new Error('Status unavailable'); return { ...fixture(), trackedJobs: ids ? jobs : null }; },
  queueMetaAdMappingSync: async () => { queueCalls++; jobs = [makeJob(rootId, 'queued')]; pending = 1; return { jobs: [rootId] }; },
});
mock('../lib/meta-funnel-actions', {});
mock('../lib/DateRangeContext', { useDateRange: () => ({ dateRange: { from: '2026-10-01', to: '2026-10-19' } }) });
// Use the real worklist cache hook; isolate only viewer identity and unrelated navigation/UI.
const cached = require('../lib/useMetaCachedLoad');
mock('../lib/useMetaCachedLoad', { ...cached, useMetaReportSession: () => ({ key: scope, error: '' }) });
const params = new URLSearchParams(); const router = { replace() {} };
mock('next/navigation', { useRouter: () => router, usePathname: () => '/dashboard/meta-funnels/mappings', useSearchParams: () => params });
mock('next/link', { default: ({ children }: any) => <span>{children}</span> });
mock('../components/MetaAdsNav', { default: ({ actions }: any) => <nav>{actions}</nav> });
mock('../components/MetaCepPicker', { default: () => null });
mock('../components/MetaAdDimensionFilters', { default: () => null });
const Page = require('../components/MetaAdMappings').default;
const tick = () => new Promise<void>(r => setImmediate(r));
const text = (root: any) => JSON.stringify(root.toJSON());
const syncButton = (root: any) => root.root.findAllByType('button').find((b: any) => b.children.includes('Sync pemetaan'));

test('page follows queue → children → success, retains early failures, retries status outages and clears scope', async () => {
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<number, () => void>(); let sequence = 0;
  globalThis.setTimeout = ((fn: () => void, ms: number, ...args: any[]) => ms === 15000 ? (timers.set(++sequence, fn), sequence) : originalSetTimeout(fn, ms, ...args)) as any;
  globalThis.clearTimeout = ((id: any) => { if (timers.delete(id)) return; originalClearTimeout(id); }) as any;
  let root: any;
  const poll = async () => { const callbacks = [...timers.values()]; timers.clear(); assert.ok(callbacks.length); await act(async () => { callbacks.forEach(fn => fn()); await tick(); }); };
  try {
    await act(async () => { root = create(<Page workspaceId={workspaceId} canManage canSync />); await tick(); });
    await act(async () => { syncButton(root).props.onClick(); await tick(); });
    assert.equal(queueCalls, 1); assert.match(text(root), /Sync pemetaan berjalan/); assert.equal(syncButton(root).props.disabled, true);
    jobs = [makeJob(rootId, 'success'), makeJob('child', 'running')]; pending = 0;
    await poll(); assert.doesNotMatch(text(root), /Sync selesai/); assert.equal(timers.size, 1);
    statusFails = true; await poll(); assert.match(text(root), /Status unavailable/); assert.equal(timers.size, 1);
    statusFails = false; jobs[1] = makeJob('child', 'success');
    await poll(); assert.match(text(root), /Sync selesai\. Semua batch/); assert.equal(syncButton(root).props.disabled, false); assert.equal(timers.size, 0);
    await act(async () => { syncButton(root).props.onClick(); await tick(); });
    jobs = [makeJob(rootId, 'failed'), ...Array.from({ length: 15 }, (_, n) => makeJob(`child-${n}`, 'success'))]; pending = 0;
    await poll(); assert.match(text(root), /Sync selesai dengan kendala/); assert.match(text(root), /Meta timeout/);
    assert.equal(root.root.findAllByProps({ role: 'alert' }).length, 1);
    // A stale cached report must not prevent status polling after a worklist failure.
    scope = 'user-b:workspace-b'; workspaceId = 'workspace-b'; worklistFails = true;
    await act(async () => { root.update(<Page workspaceId={workspaceId} canManage canSync />); await tick(); });
    assert.doesNotMatch(text(root), /Meta timeout|Sync selesai/);
  } finally {
    await act(async () => root?.unmount());
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
  }
});
