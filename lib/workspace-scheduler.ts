import { createServiceSupabase } from './service-supabase';
import { requireExplicitWorkspaceId } from './workspace-scope';

export type WorkspaceScheduleSource =
  | 'all'
  | 'daily_ads'
  | 'financial'
  | 'warehouse'
  | 'meta'
  | 'whatsapp'
  | 'telegram'
  | 'scalev'
  | 'shopee';

const SOURCE_TABLES: Record<Exclude<WorkspaceScheduleSource, 'all'>, string> = {
  daily_ads: 'sheet_connections',
  financial: 'financial_sheet_connections',
  warehouse: 'warehouse_sheet_connections',
  meta: 'meta_ad_accounts',
  whatsapp: 'waba_accounts',
  telegram: 'workspace_integrations',
  scalev: 'scalev_webhook_businesses',
  shopee: 'shopee_shops',
};

export async function listScheduledWorkspaceIds(
  source: WorkspaceScheduleSource,
) {
  const service = createServiceSupabase();
  const { data: workspaces, error: workspaceError } = await service
    .from('workspaces')
    .select('id')
    .eq('status', 'active');
  if (workspaceError) throw workspaceError;

  const activeIds = new Set(
    (workspaces || []).map((workspace) => String(workspace.id)),
  );
  if (source === 'all') return Array.from(activeIds).sort();

  let sourceQuery = service
    .from(SOURCE_TABLES[source])
    .select('workspace_id')
    .eq('is_active', true);
  if (source === 'telegram') {
    sourceQuery = sourceQuery.eq('provider', 'telegram');
  }
  const { data: sourceRows, error: sourceError } = await sourceQuery;
  if (sourceError) throw sourceError;

  return Array.from(new Set(
    (sourceRows || [])
      .map((row: any) => String(row.workspace_id || ''))
      .filter((workspaceId) => activeIds.has(workspaceId)),
  )).sort();
}

export async function resolveScheduledWorkspaceIds(
  requestedWorkspaceId: string | null | undefined,
  source: WorkspaceScheduleSource,
) {
  if (requestedWorkspaceId) {
    return [requireExplicitWorkspaceId(requestedWorkspaceId, 'Scheduled job')];
  }
  return listScheduledWorkspaceIds(source);
}
