import type { SupabaseClient } from '@supabase/supabase-js';
import type { MetaSyncJob } from './meta-funnel-sync-status';
export async function linkMetaSyncJobs(svc: SupabaseClient, workspaceId: string, parentId: string, childIds: string[]) {
  if (!childIds.length) return;
  const result = await svc.rpc('link_meta_sync_jobs', { p_workspace_id: workspaceId, p_parent_id: parentId, p_child_ids: [...new Set(childIds)] });
  if (result.error) throw new Error(result.error.message);
}
export async function loadMetaSyncJobTree(svc: SupabaseClient, workspaceId: string, roots?: string[]): Promise<MetaSyncJob[]> {
  const result = await svc.rpc('get_meta_sync_job_tree', { p_workspace_id: workspaceId, p_root_ids: roots || null });
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}
