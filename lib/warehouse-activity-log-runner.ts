import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';
import { requireWorkspaceAccess } from '@/lib/workspace-access';
import { requireExplicitWorkspaceId } from '@/lib/workspace-scope';

export type WarehouseActivityLogInput = {
  scope: string;
  action: string;
  screen: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | number | null;
  targetLabel?: string | null;
  businessCode?: string | null;
  changedFields?: string[] | null;
  beforeState?: Record<string, any> | null;
  afterState?: Record<string, any> | null;
  context?: Record<string, any> | null;
  createdAt?: string | null;
  workspaceId?: string | null;
};

function isMissingActivityLogTableError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function sanitizeRecord(value: Record<string, any> | null | undefined) {
  if (!value || typeof value !== 'object') return {};

  return JSON.parse(JSON.stringify(value, (_key, currentValue) => {
    if (currentValue === undefined) return null;
    return currentValue;
  }));
}

async function getCurrentActivityActor() {
  try {
    const supabase = createServerSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { id: null, name: 'System' };
    }

    const svc = createServiceSupabase();
    const { data: profile } = await svc
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    return {
      id: profile?.id || user.id,
      name: profile?.full_name || profile?.email || user.email || 'Unknown',
    };
  } catch {
    return { id: null, name: 'System' };
  }
}

export async function recordWarehouseActivityLog(input: WarehouseActivityLogInput) {
  try {
    const actor = await getCurrentActivityActor();
    const svc = createServiceSupabase();
    const workspaceId = input.workspaceId
      ? requireExplicitWorkspaceId(input.workspaceId, 'Warehouse activity log')
      : (await requireWorkspaceAccess()).workspaceId;

    const { error } = await svc
      .from('warehouse_activity_log')
      .insert({
        workspace_id: workspaceId,
        scope: input.scope,
        action: input.action,
        screen: input.screen,
        summary: input.summary,
        target_type: input.targetType || null,
        target_id: input.targetId == null ? null : String(input.targetId),
        target_label: input.targetLabel || null,
        business_code: input.businessCode || null,
        changed_fields: Array.isArray(input.changedFields) ? Array.from(new Set(input.changedFields.filter(Boolean))) : [],
        before_state: sanitizeRecord(input.beforeState),
        after_state: sanitizeRecord(input.afterState),
        context: sanitizeRecord(input.context),
        acted_by: actor.id,
        acted_by_name: actor.name,
        created_at: input.createdAt || new Date().toISOString(),
      });

    if (error) {
      if (isMissingActivityLogTableError(error)) return;
      console.warn('[warehouse-activity-log] insert failed:', error.message || error);
    }
  } catch (error: any) {
    console.warn('[warehouse-activity-log] unexpected failure:', error?.message || error);
  }
}
