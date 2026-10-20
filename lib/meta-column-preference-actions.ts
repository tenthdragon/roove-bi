'use server';

import { reportingAccess, uuid } from './meta-report-context';
import { createServiceSupabase } from './service-supabase';
import { validateFunnel } from './meta-funnel-domain';
import { isDefaultMetaColumns, metaResultColumns, parseMetaColumnPreference, reconcileMetaColumns, type MetaColumnPreference } from './meta-column-preferences';

type Viewer = { workspaceId: string; userId: string };
export type MetaColumnPreferences = { ready: boolean; preferences: Record<string, MetaColumnPreference> };
const unavailable = 'Pengaturan kolom belum tersedia. Coba lagi nanti.';

async function viewerAccess(input: Viewer) {
  const ctx = await reportingAccess();
  if (input.workspaceId !== ctx.workspaceId || input.userId !== ctx.profile.id) throw new Error('Sesi atau workspace berubah. Muat ulang halaman.');
  return ctx;
}

export async function getMetaColumnPreferences(input: Viewer): Promise<MetaColumnPreferences> {
  const ctx = await viewerAccess(input);
  const { data, error } = await createServiceSupabase().from('meta_funnel_column_preferences')
    .select('funnel_id,column_order,hidden_columns,meta_ad_funnels!inner(workspace_id,archived)')
    .eq('user_id', ctx.profile.id).eq('meta_ad_funnels.workspace_id', ctx.workspaceId).eq('meta_ad_funnels.archived', false);
  if (error && ['42P01', 'PGRST205'].includes(error.code)) return { ready: false, preferences: {} };
  if (error) throw new Error('Pengaturan kolom gagal dimuat. Silakan coba lagi.');
  return { ready: true, preferences: Object.fromEntries((data || []).map(row => [row.funnel_id,
    parseMetaColumnPreference({ order: row.column_order, hidden: row.hidden_columns })])) };
}

export async function saveMetaColumnPreference(input: Viewer & { funnelId: string; preference: MetaColumnPreference | null }): Promise<MetaColumnPreference | null> {
  const ctx = await viewerAccess(input);
  uuid(input.funnelId);
  const preference = input.preference === null ? null : parseMetaColumnPreference(input.preference);
  if (preference?.order.length && preference.order.length === preference.hidden.length) throw new Error('Pilih minimal satu kolom selain Tujuan.');
  const svc = createServiceSupabase();
  const template = await svc.from('meta_ad_funnels').select('config').eq('id', input.funnelId)
    .eq('workspace_id', ctx.workspaceId).eq('archived', false).maybeSingle();
  if (template.error) throw new Error('Template gagal diperiksa. Silakan coba lagi.');
  if (!template.data) throw new Error('Template tidak tersedia. Muat ulang halaman.');
  const config = validateFunnel(template.data.config);
  if (config.group_by !== 'landing_page' || ctx.accountIds !== null && (!ctx.accountIds.length
    || config.account_ids.length > 0 && !config.account_ids.some(id => ctx.accountIds!.includes(id)))) {
    throw new Error('Template tidak tersedia dalam akses Anda.');
  }
  const columns = metaResultColumns(config.metrics);
  const normalized = preference ? reconcileMetaColumns(columns, preference) : null;
  if (normalized && normalized.order.every(k => normalized.hidden.includes(k))) throw new Error('Pilih minimal satu kolom selain Tujuan.');
  const saved = normalized && !isDefaultMetaColumns(columns, normalized) ? normalized : null;
  const result = saved
    ? await svc.from('meta_funnel_column_preferences').upsert({ user_id: ctx.profile.id, funnel_id: input.funnelId,
      column_order: saved.order, hidden_columns: saved.hidden, updated_at: new Date().toISOString() }, { onConflict: 'user_id,funnel_id' })
    : await svc.from('meta_funnel_column_preferences').delete().eq('user_id', ctx.profile.id).eq('funnel_id', input.funnelId);
  if (result.error) throw new Error(['42P01', 'PGRST205'].includes(result.error.code) ? unavailable : 'Pengaturan kolom gagal disimpan. Silakan coba lagi.');
  return saved;
}
