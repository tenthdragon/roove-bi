import { createServiceSupabase } from './service-supabase';

/** The database rechecks membership, permission and current brand assignments in the write transaction. */
export async function mutateMeta(ctx: { workspaceId: string; profile: { id: string } }, operation: string, input: Record<string, unknown>) {
  const { data, error } = await createServiceSupabase().rpc('mutate_meta_brand_configuration', {
    p_workspace_id: ctx.workspaceId, p_user_id: ctx.profile.id, p_operation: operation, p_input: input,
  });
  if (error) throw new Error('Perubahan belum tersimpan. Periksa izin, brand dan versi data, lalu muat ulang.');
  return data;
}
