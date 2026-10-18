import { requireDashboardTabAccess } from './dashboard-access';
import { createServerSupabase } from './supabase-server';
import { UUID } from './growth-case-domain';

export async function growthCaseContext(caseId?: string) {
  const access = await requireDashboardTabAccess('growth-work', 'Growth Execution');
  const db = createServerSupabase();
  if (caseId) {
    if (!UUID.test(caseId)) throw new Error('Kasus tidak ditemukan.');
    const { data, error } = await db.from('growth_cases').select('*').eq('workspace_id', access.workspaceId).eq('owner_id',access.profile.id).eq('id',caseId).single();
    if (error || !data) throw new Error('Kasus tidak ditemukan atau akses tidak tersedia.');
    return { access, db, record:data };
  }
  return { access, db, record:null };
}
