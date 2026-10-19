import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModuleKind, transpileModule } from 'typescript';

function harness() {
  let allow = true;
  let rpcError: { message: string } | null = null;
  const calls: unknown[] = [];
  const imports: Record<string, unknown> = {
    './supabase-server': { createServerSupabase: () => ({ rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: { success: true, approved: true }, error: rpcError };
    } }), createServiceSupabase: () => { throw new Error('Unexpected service-role bypass'); } },
    './dashboard-access': { requireDashboardRoles: async (roles: string[]) => {
      assert.deepEqual(roles, ['owner']);
      if (!allow) throw new Error('Owner only');
      return { workspaceId: 'verified-workspace' };
    } },
    './excel-parser': {},
    './workspace-user-access': { listWorkspaceUsers: async (workspaceId: string) => [{ workspaceId }] },
  };
  const source = readFileSync(new URL('../lib/actions.ts', import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } });
  const actions: any = {};
  new Function('require', 'exports', outputText)((name: string) => {
    assert.ok(name in imports, name);
    return imports[name];
  }, actions);
  return { actions, calls, deny: () => { allow = false; }, fail: () => { rpcError = { message: 'Request already rejected' }; } };
}

test('user management pins approval/rejection/listing to the verified workspace and authenticated RPC', async () => {
  const { actions, calls } = harness();
  assert.deepEqual(await actions.fetchAllUsers(), [{ workspaceId: 'verified-workspace' }]);
  assert.deepEqual(await actions.updateUserRole('pending-user', 'owner', [], []), { success: true, approved: true });
  await actions.rejectUserAccessRequest('another-pending-user');
  assert.deepEqual(calls, [
    { name: 'manage_workspace_user_access', args: { p_workspace_id: 'verified-workspace', p_user_id: 'pending-user', p_action: 'set_role', p_role: 'workspace_owner' } },
    { name: 'manage_workspace_user_access', args: { p_workspace_id: 'verified-workspace', p_user_id: 'another-pending-user', p_action: 'reject' } },
  ]);
});

test('a non-owner cannot list, approve or reject requests through server actions', async () => {
  const { actions, calls, deny } = harness();
  deny();
  await assert.rejects(actions.fetchAllUsers(), /Owner only/);
  await assert.rejects(actions.updateUserRole('target', 'advertiser', [], []), /Owner only/);
  await assert.rejects(actions.rejectUserAccessRequest('target'), /Owner only/);
  assert.deepEqual(calls, []);
});

test('stale or failed database operations surface an error instead of returning success', async () => {
  const { actions, fail } = harness();
  fail();
  await assert.rejects(actions.updateUserRole('target', 'advertiser', [], []), /already rejected/);
  await assert.rejects(actions.rejectUserAccessRequest('target'), /already rejected/);
});
