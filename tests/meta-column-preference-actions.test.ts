import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultFunnel } from '../lib/meta-funnel-domain';
const require = createRequire(import.meta.url);
const templateA = '00000000-0000-4000-8000-000000000001', templateB = '00000000-0000-4000-8000-000000000002';
const config = defaultFunnel();
let viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null as string[] | null };
const rows = new Map<string, any>();
let failWrite = false;
const templates = new Map([[templateA, { workspace_id: 'workspace-a', config }], [templateB, { workspace_id: 'workspace-a', config }]]);
function from(table: string) {
  const filters: Record<string, any> = {}; let operation = 'read', value: any;
  const query: any = {
    select() { return query; }, eq(key: string, val: any) { filters[key] = val; return query; },
    upsert(row: any) { operation = 'write'; value = row; return query; }, delete() { operation = 'delete'; return query; },
    maybeSingle() { return query; },
    then(resolve: (v: any) => void) {
      if (table === 'meta_ad_funnels') {
        const t = templates.get(filters.id); return resolve({ data: t?.workspace_id === filters.workspace_id ? t : null, error: null });
      }
      assert.equal(table, 'meta_funnel_column_preferences');
      if (operation === 'write') {
        if (failWrite) return resolve({ error: { code: 'ERROR' } });
        rows.set(`${value.user_id}:${value.funnel_id}`, value); return resolve({ error: null });
      }
      if (operation === 'delete') { rows.delete(`${filters.user_id}:${filters.funnel_id}`); return resolve({ error: null }); }
      return resolve({ data: [...rows.values()].filter(r => r.user_id === filters.user_id && templates.get(r.funnel_id)?.workspace_id === filters['meta_ad_funnels.workspace_id']), error: null });
    },
  }; return query;
}
require.cache[require.resolve('../lib/meta-report-context')] = { exports: { reportingAccess: async () => viewer, uuid: (value: string) => { assert.match(value, /^[0-9a-f-]{36}$/); return value; } } } as any;
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
const { getMetaColumnPreferences, saveMetaColumnPreference } = require('../lib/meta-column-preference-actions') as typeof import('../lib/meta-column-preference-actions');
const input = () => ({ workspaceId: viewer.workspaceId, userId: viewer.profile.id });
const choice = { order: ['funnel', 'metric:spent'], hidden: ['metric:spent'] };

test('preferences persist independently by verified user and template; reset only removes that selection', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  await saveMetaColumnPreference({ ...input(), funnelId: templateB, preference: choice });
  viewer.profile.id = 'user-b';
  assert.deepEqual((await getMetaColumnPreferences(input())).preferences, {});
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: { order: ['metric:cpm', 'metric:spent'], hidden: [] } });
  viewer.profile.id = 'user-a';
  assert.equal(Object.keys((await getMetaColumnPreferences(input())).preferences).length, 2);
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: null });
  assert.deepEqual(Object.keys((await getMetaColumnPreferences(input())).preferences), [templateB]);
  assert.equal(rows.has('user-b:' + templateA), true, 'Reset must not delete another user’s override');
});

test('stale sessions, foreign workspaces and disallowed advertiser template scopes cannot save', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  await assert.rejects(saveMetaColumnPreference({ ...input(), userId: 'user-b', funnelId: templateA, preference: choice }), /Sesi atau workspace/);
  await assert.rejects(getMetaColumnPreferences({ ...input(), workspaceId: 'workspace-b' }), /Sesi atau workspace/);
  viewer.workspaceId = 'workspace-b';
  await assert.rejects(saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice }), /Template tidak tersedia/);
  viewer.workspaceId = 'workspace-a'; viewer.accountIds = [];
  await assert.rejects(saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice }), /akses Anda/);
  assert.equal(rows.size, 0);
  viewer.accountIds = ['act_1'];
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  assert.equal(rows.has('user-a:' + templateA), true, 'Advertisers may save personal display settings');
});

test('a failed save leaves existing preferences intact and never changes template configuration', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  const beforeConfig = JSON.stringify(config);
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  const before = JSON.stringify([...rows]); failWrite = true;
  try { await assert.rejects(saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: { ...choice, hidden: ['funnel'] } }), /gagal disimpan/); }
  finally { failWrite = false; }
  assert.equal(JSON.stringify([...rows]), before); assert.equal(JSON.stringify(config), beforeConfig);
});
