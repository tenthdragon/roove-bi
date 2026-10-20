import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultFunnel } from '../lib/meta-funnel-domain';
const require = createRequire(import.meta.url);
const templateA = '00000000-0000-4000-8000-000000000001', templateB = '00000000-0000-4000-8000-000000000002';
const config = defaultFunnel();
let viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null as string[] | null };
const rows = new Map<string, any>();
let failWrite = false, schemaError: string | null = null;
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
      if (schemaError) return resolve({ error: { code: schemaError } });
      if (operation === 'write') {
        if (failWrite) return resolve({ error: { code: 'ERROR' } });
        rows.set(`${value.user_id}:${value.funnel_id}`, value); return resolve({ error: null });
      }
      if (operation === 'delete') { rows.delete(`${filters.user_id}:${filters.funnel_id}`); return resolve({ error: null }); }
      return resolve({ data: [...rows.values()].filter(r => r.user_id === filters.user_id && templates.get(r.funnel_id)?.workspace_id === filters['meta_ad_funnels.workspace_id']), error: null });
    },
  }; return query;
}
async function rpc(name: string, args: any) {
  assert.equal(name, 'save_meta_funnel_table_preference');
  if (failWrite || schemaError) return { error: { code: schemaError || 'ERROR' } };
  const key = `${args.p_user_id}:${args.p_funnel_id}`;
  const row = { user_id: args.p_user_id, funnel_id: args.p_funnel_id, column_order: [], hidden_columns: [], sort_config: null, ...rows.get(key) };
  if (args.p_kind === 'columns') {
    row.column_order = args.p_columns?.order || []; row.hidden_columns = args.p_columns?.hidden || [];
    if (row.hidden_columns.includes(row.sort_config?.key)) row.sort_config = null;
  } else row.sort_config = row.hidden_columns.includes(args.p_sort?.key) ? null : args.p_sort;
  rows.set(key, row);
  return { data: row, error: null };
}
require.cache[require.resolve('../lib/meta-report-context')] = { exports: { reportingAccess: async () => viewer, uuid: (value: string) => { assert.match(value, /^[0-9a-f-]{36}$/); return value; } } } as any;
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from, rpc }) } } as any;
const { getMetaColumnPreferences, saveMetaColumnPreference, saveMetaTableSort } = require('../lib/meta-column-preference-actions') as typeof import('../lib/meta-column-preference-actions');
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


test('sort survives reload per user/template, and independent resets preserve the other settings', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  const sort = { key: 'metric:cpm', direction: 'ascending' } as const;
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  await saveMetaTableSort({ ...input(), funnelId: templateA, sort });
  await saveMetaTableSort({ ...input(), funnelId: templateB, sort: { key: 'funnel', stage: 'purchases', direction: 'descending' } });
  let loaded = await getMetaColumnPreferences(input());
  assert.deepEqual(loaded.preferences[templateA].sort, sort);
  assert.equal(loaded.preferences[templateA].order[0], 'funnel');
  viewer.profile.id = 'user-b';
  assert.deepEqual((await getMetaColumnPreferences(input())).preferences, {});
  await saveMetaTableSort({ ...input(), funnelId: templateA, sort: { key: 'name', direction: 'descending' } });
  viewer.profile.id = 'user-a';
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: null });
  loaded = await getMetaColumnPreferences(input());
  assert.deepEqual(loaded.preferences[templateA], { order: [], hidden: [], sort });
  await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  await saveMetaTableSort({ ...input(), funnelId: templateA, sort: null });
  loaded = await getMetaColumnPreferences(input());
  assert.equal(loaded.preferences[templateA].order[0], 'funnel');
  assert.equal(loaded.preferences[templateA].sort, null);
  assert.equal(loaded.preferences[templateB].sort?.key, 'funnel');
  assert.equal(rows.get('user-b:' + templateA).sort_config.key, 'name');
});

test('sort validates viewer, template metrics, stages, direction and malformed input; failed writes preserve saved order', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  const base = { ...input(), funnelId: templateA, sort: { key: 'name', direction: 'ascending' } as const };
  await assert.rejects(saveMetaTableSort({ ...base, userId: 'user-b' }), /Sesi atau workspace/);
  await assert.rejects(saveMetaTableSort({ ...base, workspaceId: 'workspace-b' }), /Sesi atau workspace/);
  viewer.accountIds = []; await assert.rejects(saveMetaTableSort(base), /akses Anda/); viewer.accountIds = null;
  for (const sort of [{ key: 'metric:missing', direction: 'ascending' }, { key: 'name', direction: 'sideways' },
    { key: 'funnel', stage: 'messaging_conversations', direction: 'ascending' }, { key: 'funnel', stage: 'spend', direction: 'descending' },
    { key: 'funnel', stage: 'constructor', direction: 'ascending' }, { key: 'name', stage: 'purchases', direction: 'ascending' }, {}]) {
    await assert.rejects(saveMetaTableSort({ ...base, sort: sort as any }), /tidak valid|tidak tersedia/);
  }
  await saveMetaTableSort(base); const before = JSON.stringify([...rows]);
  failWrite = true;
  try { await assert.rejects(saveMetaTableSort({ ...base, sort: null }), /gagal disimpan/); } finally { failWrite = false; }
  assert.equal(JSON.stringify([...rows]), before);
});

test('hiding the active sort clears it and stale sorts cannot reintroduce hidden-column sorting', async () => {
  rows.clear(); viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  const sort = { key: 'metric:spent', direction: 'descending' } as const;
  await saveMetaTableSort({ ...input(), funnelId: templateA, sort });
  const hidden = await saveMetaColumnPreference({ ...input(), funnelId: templateA, preference: choice });
  assert.equal(hidden?.sort, null);
  assert.equal((await saveMetaTableSort({ ...input(), funnelId: templateA, sort }))?.sort, null);
});

test('an unapplied migration disables settings safely, including missing sort column/RPC', async () => {
  viewer = { workspaceId: 'workspace-a', profile: { id: 'user-a' }, accountIds: null };
  try {
    for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) {
      schemaError = code;
      assert.deepEqual(await getMetaColumnPreferences(input()), { ready: false, preferences: {} });
    }
    schemaError = 'PGRST202';
    await assert.rejects(saveMetaTableSort({ ...input(), funnelId: templateA, sort: null }), /belum tersedia/);
  } finally { schemaError = null; }
});
