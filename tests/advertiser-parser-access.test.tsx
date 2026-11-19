import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, JsxEmit, ModuleKind, ScriptTarget } from 'typescript';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
function load(file: string, imports: Record<string, unknown>): any {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, { compilerOptions: {
    module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022,
  } });
  const exports = {};
  new Function('require', 'exports', outputText)((name: string) => {
    assert.ok(name in imports, name);
    return imports[name];
  }, exports);
  return exports;
}

test('parser access management requires owner, active advertiser and the verified workspace', async () => {
  let owner = true;
  let member = { role: 'advertiser', status: 'active' };
  let rpcError: any = null;
  const calls: any[] = [];
  const query: any = {
    select() { return query; },
    eq(key: string, value: string) {
      assert.equal(value, key === 'workspace_id' ? 'workspace-a' : 'user-a'); return query;
    },
    maybeSingle: async () => ({ data: member }),
  };
  const actions = load('lib/advertiser-parser-access-actions.ts', {
    './dashboard-access': { requireDashboardRoles: async (roles: string[]) => {
      assert.deepEqual(roles, ['owner']); if (!owner) throw Error('Owner only');
      return { workspaceId: 'workspace-a' };
    } },
    './service-supabase': { createServiceSupabase: () => ({ from: (table: string) => {
      assert.equal(table, 'workspace_memberships'); return query;
    } }) },
    './supabase-server': { createServerSupabase: () => ({ rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return { data: args.p_enabled, error: rpcError };
    } }) },
    './advertiser-parser-access': { loadAdvertiserParserAccess: async (_client: any, workspace: string, user: string) => {
      assert.equal(workspace, 'workspace-a'); assert.equal(user, 'user-a'); return false;
    } },
  });
  assert.deepEqual(await actions.getAdvertiserParserAccess('user-a', 'workspace-a'), { workspaceId: 'workspace-a', enabled: false });
  for (const enabled of [true, false]) {
    assert.deepEqual(await actions.saveAdvertiserParserAccess('user-a', enabled, 'workspace-a'), { workspaceId: 'workspace-a', enabled });
    assert.deepEqual(calls.at(-1), { name: 'set_workspace_advertiser_parser_access', args: { p_workspace_id: 'workspace-a', p_user_id: 'user-a', p_enabled: enabled } });
  }
  await assert.rejects(actions.getAdvertiserParserAccess('user-a', 'workspace-b'), /Workspace berubah/);
  await assert.rejects(actions.saveAdvertiserParserAccess('user-a', true, 'workspace-b'), /Workspace berubah/);
  await assert.rejects(actions.saveAdvertiserParserAccess('user-a', 'true', 'workspace-a'), /tidak valid/);
  member = { role: 'advertiser', status: 'suspended' };
  await assert.rejects(actions.getAdvertiserParserAccess('user-a', 'workspace-a'), /tidak aktif/);
  member = { role: 'admin', status: 'active' };
  await assert.rejects(actions.getAdvertiserParserAccess('user-a', 'workspace-a'), /tidak aktif/);
  owner = false;
  await assert.rejects(actions.getAdvertiserParserAccess('user-a', 'workspace-a'), /Owner only/);
  await assert.rejects(actions.saveAdvertiserParserAccess('user-a', true, 'workspace-a'), /Owner only/);
  assert.equal(calls.length, 2);
  owner = true; rpcError = { message: 'Advertiser tidak aktif' };
  await assert.rejects(actions.saveAdvertiserParserAccess('user-a', true, 'workspace-a'), /tidak aktif/);
});

function mountComponent(actions: any) {
  const Component = load('components/AdvertiserParserAccess.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/advertiser-parser-access-actions': actions,
  }).default;
  return { Component, element: (workspaceId = 'a') => React.createElement(Component, { userId: 'u', workspaceId }) };
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('advertiser parser checkbox starts off, saves both values and allows retry after load/save errors', async () => {
  let loadFails = true, saveFails = false;
  const saves: any[] = [];
  const { element } = mountComponent({
    getAdvertiserParserAccess: async () => {
      if (loadFails) throw Error('Load failed'); return { workspaceId: 'a', enabled: false };
    },
    saveAdvertiserParserAccess: async (...args: any[]) => {
      saves.push(args); if (saveFails) throw Error('Save failed'); return { workspaceId: 'a', enabled: args[1] };
    },
  });
  let root: any;
  await act(async () => { root = create(element()); });
  assert.equal(root.root.findByProps({ role: 'alert' }).children.join(''), 'Load failed');
  assert.equal(root.root.findAllByType('input').length, 0);
  loadFails = false;
  await act(async () => root.root.findByType('button').props.onClick());
  const input = () => root.root.findByType('input');
  assert.equal(input().props.checked, false);
  await act(async () => input().props.onChange({ target: { checked: true } }));
  saveFails = true;
  await act(async () => root.root.findByType('button').props.onClick());
  assert.equal(input().props.checked, true);
  assert.equal(root.root.findByProps({ role: 'alert' }).children.join(''), 'Save failed');
  saveFails = false;
  await act(async () => root.root.findByType('button').props.onClick());
  assert.match(root.root.findByProps({ role: 'status' }).children.join(''), /Akses tersimpan/);
  await act(async () => input().props.onChange({ target: { checked: false } }));
  await act(async () => root.root.findByType('button').props.onClick());
  assert.deepEqual(saves, [['u', true, 'a'], ['u', true, 'a'], ['u', false, 'a']]);
  await act(async () => root.unmount());
});

test('late parser access load or save cannot overwrite another workspace', async () => {
  const firstLoad = deferred(), save = deferred();
  const { element } = mountComponent({
    getAdvertiserParserAccess: async (_user: string, workspace: string) => workspace === 'a'
      ? firstLoad.promise : { workspaceId: workspace, enabled: false },
    saveAdvertiserParserAccess: async () => save.promise,
  });
  let root: any;
  await act(async () => { root = create(element()); });
  assert.equal(root.root.findByType('fieldset').props.disabled, true);
  await act(async () => root.update(element('b')));
  await act(async () => firstLoad.resolve({ workspaceId: 'a', enabled: true }));
  assert.equal(root.root.findByType('input').props.checked, false);
  await act(async () => root.root.findByType('input').props.onChange({ target: { checked: true } }));
  await act(async () => root.root.findByType('button').props.onClick());
  assert.equal(root.root.findByType('fieldset').props.disabled, true);
  await act(async () => root.update(element('c')));
  await act(async () => save.resolve({ workspaceId: 'b', enabled: true }));
  assert.equal(root.root.findByType('input').props.checked, false);
  assert.equal(root.root.findAllByProps({ role: 'status' }).length, 0);
  await act(async () => root.unmount());
});
