import { requireDashboardTabAccess } from '@/lib/dashboard-access';
import GrowthCaseLog from '@/components/GrowthCaseLog';

export const dynamic='force-dynamic';
export default async function GrowthPage({searchParams}:{searchParams:{case?:string}}) {
  try { await requireDashboardTabAccess('growth-work','Growth Execution'); }
  catch(error){return <div style={{padding:32}} role="alert"><h1>Growth Execution</h1><p>{error instanceof Error ? error.message : 'Akses tidak tersedia.'}</p></div>;}
  return <GrowthCaseLog initialId={searchParams.case}/>;
}
