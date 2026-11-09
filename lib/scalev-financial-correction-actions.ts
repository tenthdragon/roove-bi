'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { createServerSupabase } from './supabase-server';
import { withScalevLineRetry } from './scalev-line-persistence';

type FinancialChange = {
  entity: 'order' | 'line';
  line_key?: string;
  field: string;
  amount?: number;
  active?: boolean;
};

export async function getScalevFinancialCorrections(orderId: number) {
  const { workspaceId } = await requireDashboardRoles(['owner', 'admin'], 'Koreksi nominal order');
  if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error('Order tidak valid.');
  const svc = createServiceSupabase();
  const order = await svc.from('scalev_orders').select('id,order_id')
    .eq('workspace_id', workspaceId).eq('id', orderId).single();
  if (order.error) throw new Error('Order tidak tersedia di workspace ini.');
  const [version, fields, history] = await Promise.all([
    svc.from('scalev_financial_correction_versions').select('version')
      .eq('workspace_id', workspaceId).eq('scalev_order_id', orderId).maybeSingle(),
    svc.from('scalev_financial_corrections').select('*')
      .eq('workspace_id', workspaceId).eq('scalev_order_id', orderId)
      .order('entity').order('line_key').order('field'),
    svc.from('scalev_financial_correction_audit').select('*')
      .eq('workspace_id', workspaceId).eq('scalev_order_id', orderId)
      .order('version', { ascending: false }).limit(100),
  ]);
  for (const result of [version, fields, history]) if (result.error) throw new Error(result.error.message);
  return { workspaceId, order: order.data, version: Number(version.data?.version || 0),
    fields: fields.data || [], history: history.data || [] };
}

export async function saveScalevFinancialCorrections(input: {
  workspaceId: string;
  orderId: number;
  changes: FinancialChange[];
  reason: string;
  expectedVersion: number;
}) {
  const { workspaceId } = await requireDashboardRoles(['owner', 'admin'], 'Koreksi nominal order');
  if (workspaceId !== input.workspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menyimpan.');
  if (!Number.isSafeInteger(input.orderId) || input.orderId <= 0
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 1000
    || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 1000) {
    throw new Error('Permintaan koreksi tidak valid.');
  }
  // Database validates the field allowlist, precision, tenancy, actor and version.
  // One RPC transaction covers all fields, projection, summary triggers and audit.
  const version = await withScalevLineRetry(async () => {
    const { data, error } = await createServerSupabase().rpc('set_scalev_financial_corrections', {
      p_workspace_id: workspaceId, p_order_id: input.orderId, p_changes: input.changes,
      p_reason: input.reason.trim(), p_expected_version: input.expectedVersion,
    });
    if (error) throw error;
    return Number(data);
  });
  revalidateTag('overview-cm3-history');
  revalidateTag('overview-cm3-history-active');
  revalidateTag('shipping-fee-range');
  revalidatePath('/dashboard', 'layout');
  return { version };
}
