'use server';

import { createServiceSupabase } from '@/lib/supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';

export type WarehouseActivityLogRow = {
  id: number;
  scope: string;
  action: string;
  screen: string;
  summary: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  business_code: string | null;
  changed_fields: string[];
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  context: Record<string, any>;
  acted_by: string | null;
  acted_by_name: string | null;
  created_at: string;
};

export type WarehouseActivityLogPayload = {
  schema_ready: boolean;
  schema_message: string | null;
  rows: WarehouseActivityLogRow[];
};

function isMissingActivityLogTableError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getMissingActivityLogSchemaMessage() {
  return 'Audit log warehouse belum tersedia. Jalankan migration 109 terlebih dahulu.';
}

function sanitizeRecord(value: Record<string, any> | null | undefined) {
  if (!value || typeof value !== 'object') return {};

  return JSON.parse(JSON.stringify(value, (_key, currentValue) => {
    if (currentValue === undefined) return null;
    return currentValue;
  }));
}

export async function getWarehouseActivityLogs(input?: {
  scope?: string;
  limit?: number;
}): Promise<WarehouseActivityLogPayload> {
  const { workspaceId } = await requireDashboardTabAccess('warehouse-settings', 'Log Aktivitas Warehouse');
  await requireDashboardPermissionAccess('whs:mapping', 'Log Aktivitas Warehouse');

  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(input?.limit || 200), 1), 500);

  let query = svc
    .from('warehouse_activity_log')
    .select(`
      id,
      scope,
      action,
      screen,
      summary,
      target_type,
      target_id,
      target_label,
      business_code,
      changed_fields,
      before_state,
      after_state,
      context,
      acted_by,
      acted_by_name,
      created_at
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (input?.scope && input.scope !== 'all') {
    query = query.eq('scope', input.scope);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingActivityLogTableError(error)) {
      return {
        schema_ready: false,
        schema_message: getMissingActivityLogSchemaMessage(),
        rows: [],
      };
    }
    throw error;
  }

  return {
    schema_ready: true,
    schema_message: null,
    rows: ((data || []) as any[]).map((row) => ({
      id: Number(row.id),
      scope: row.scope,
      action: row.action,
      screen: row.screen,
      summary: row.summary,
      target_type: row.target_type || null,
      target_id: row.target_id || null,
      target_label: row.target_label || null,
      business_code: row.business_code || null,
      changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
      before_state: sanitizeRecord(row.before_state),
      after_state: sanitizeRecord(row.after_state),
      context: sanitizeRecord(row.context),
      acted_by: row.acted_by || null,
      acted_by_name: row.acted_by_name || null,
      created_at: row.created_at,
    })),
  };
}
