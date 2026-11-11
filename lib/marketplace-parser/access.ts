import { createServiceSupabase } from '../service-supabase';
import { requireDashboardTabAccess } from '../dashboard-access';
import { isWorkspaceModuleEnabled } from '../workspaces';
export async function parserAccess(expectedWorkspace: string) {
  const ctx=await requireDashboardTabAccess('marketplace-data-parser','Marketplace Data Parser');
  if(ctx.workspaceId!==expectedWorkspace) throw new Error('Workspace berubah. Muat ulang halaman sebelum melanjutkan.');
  if(!isWorkspaceModuleEnabled(ctx.workspace,'channels')) throw new Error('Sales Channel tidak aktif untuk workspace ini.');
  return ctx;
}

export async function parserActorName(id:string){const {data}=await createServiceSupabase().from('profiles').select('full_name,email').eq('id',id).single();return data?.full_name||data?.email||id;}
