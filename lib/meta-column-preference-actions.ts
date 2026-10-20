'use server';

import { reportingAccess, uuid } from './meta-report-context';
import { createServiceSupabase } from './service-supabase';
import { validateFunnel } from './meta-funnel-domain';
import { isDefaultMetaColumns, metaResultColumns, parseMetaColumnPreference, reconcileMetaColumns, type MetaColumnPreference, type MetaTablePreference } from './meta-column-preferences';
import { parseMetaTableSort, type MetaTableSort } from './meta-table-sorting';

type Viewer = { workspaceId: string; userId: string };
export type MetaColumnPreferences = { ready: boolean; preferences: Record<string, MetaTablePreference> };
const unavailable = 'Pengaturan tabel belum tersedia. Coba lagi nanti.';
const missingSchema = (code: string) => ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code);

async function viewerAccess(input: Viewer) {
  const ctx = await reportingAccess();
  if (input.workspaceId !== ctx.workspaceId || input.userId !== ctx.profile.id) throw new Error('Sesi atau workspace berubah. Muat ulang halaman.');
  return ctx;
}

function readPreference(row: { column_order: unknown; hidden_columns: unknown; sort_config: unknown }): MetaTablePreference | null {
  const columns = parseMetaColumnPreference({ order: row.column_order, hidden: row.hidden_columns });
  const sort = parseMetaTableSort(row.sort_config ?? null);
  return columns.order.length || sort ? { ...columns, sort } : null;
}

export async function getMetaColumnPreferences(input: Viewer): Promise<MetaColumnPreferences> {
  const ctx = await viewerAccess(input);
  const { data, error } = await createServiceSupabase().from('meta_funnel_column_preferences')
    .select('funnel_id,column_order,hidden_columns,sort_config,meta_ad_funnels!inner(workspace_id,archived)')
    .eq('user_id', ctx.profile.id).eq('meta_ad_funnels.workspace_id', ctx.workspaceId).eq('meta_ad_funnels.archived', false);
  if (error && missingSchema(error.code)) return { ready: false, preferences: {} };
  if (error) throw new Error('Pengaturan tabel gagal dimuat. Silakan coba lagi.');
  const preferences: Record<string, MetaTablePreference> = {};
  for (const row of data || []) {
    const saved = readPreference(row);
    if (saved) preferences[row.funnel_id] = saved;
  }
  return { ready: true, preferences };
}

async function templateAccess(input: Viewer & { funnelId: string }) {
  const ctx = await viewerAccess(input);
  uuid(input.funnelId);
  const svc = createServiceSupabase();
  const template = await svc.from('meta_ad_funnels').select('config,brand_id').eq('id', input.funnelId)
    .eq('workspace_id', ctx.workspaceId).eq('archived', false).maybeSingle();
  if (template.error) throw new Error('Template gagal diperiksa. Silakan coba lagi.');
  if (!template.data) throw new Error('Template tidak tersedia. Muat ulang halaman.');
  if (template.data.brand_id != null && ctx.brandIds !== null && !ctx.brandIds.includes(template.data.brand_id)) throw new Error('Template tidak tersedia dalam akses Anda.');
  const config = validateFunnel(template.data.config);
  if (config.group_by !== 'landing_page' || ctx.accountIds !== null && (!ctx.accountIds.length
    || config.account_ids.length > 0 && !config.account_ids.some(id => ctx.accountIds!.includes(id)))) {
    throw new Error('Template tidak tersedia dalam akses Anda.');
  }
  return { ctx, svc, config };
}

async function patchPreference(access: Awaited<ReturnType<typeof templateAccess>>, funnelId: string,
  patch: { p_kind: 'columns'; p_columns: MetaColumnPreference | null } | { p_kind: 'sort'; p_sort: MetaTableSort | null }) {
  const { data, error } = await access.svc.rpc('save_meta_funnel_table_preference', {
    p_user_id: access.ctx.profile.id, p_funnel_id: funnelId, ...patch,
  });
  if (error) throw new Error(missingSchema(error.code) ? unavailable : 'Pengaturan tabel gagal disimpan. Silakan coba lagi.');
  return readPreference(data);
}

export async function saveMetaColumnPreference(input: Viewer & { funnelId: string; preference: MetaColumnPreference | null }): Promise<MetaTablePreference | null> {
  const access = await templateAccess(input);
  const preference = input.preference === null ? null : parseMetaColumnPreference(input.preference);
  if (preference?.order.length && preference.order.length === preference.hidden.length) throw new Error('Pilih minimal satu kolom selain Tujuan.');
  const columns = metaResultColumns(access.config.metrics);
  const normalized = preference ? reconcileMetaColumns(columns, preference) : null;
  const saved = normalized && !isDefaultMetaColumns(columns, normalized) ? normalized : null;
  return patchPreference(access, input.funnelId, { p_kind: 'columns', p_columns: saved });
}

export async function saveMetaTableSort(input: Viewer & { funnelId: string; sort: MetaTableSort | null }): Promise<MetaTablePreference | null> {
  const access = await templateAccess(input);
  const sort = parseMetaTableSort(input.sort);
  if (sort && (sort.key === 'funnel' ? !access.config.stages.includes(sort.stage)
    : sort.key !== 'name' && !access.config.metrics.some(m => `metric:${m.id}` === sort.key))) {
    throw new Error('Kolom atau tahap pengurutan tidak tersedia. Muat ulang halaman.');
  }
  return patchPreference(access, input.funnelId, { p_kind: 'sort', p_sort: sort });
}
