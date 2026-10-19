import { createServerSupabase } from './supabase-server';
import type { Profile } from './utils';

export type WorkspaceUser = Profile & { access_request_scope: 'workspace' | 'unassigned' };

export async function listWorkspaceUsers(workspaceId: string): Promise<WorkspaceUser[]> {
  const { data, error } = await createServerSupabase().rpc('list_workspace_users', {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(error.message);
  return (data || []) as WorkspaceUser[];
}
