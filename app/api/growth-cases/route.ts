import { NextRequest, NextResponse } from 'next/server';
import { growthCaseContext } from '@/lib/growth-case-server';
import { rejectUntrustedOrigin } from '@/lib/request-hardening';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const { db, access } = await growthCaseContext();
    const page=Math.floor(Math.max(0,Math.min(10000,Number(req.nextUrl.searchParams.get('page')) || 0)));
    const search=(req.nextUrl.searchParams.get('search') || '').slice(0,160).replace(/[%_\\]/g,'');
    const status=req.nextUrl.searchParams.get('status');
    let query=db.from('growth_cases').select('id,title,status,problem,updated_at,created_at,version',{count:'exact'}).eq('workspace_id',access.workspaceId).eq('owner_id',access.profile.id);
    if(search)query=query.ilike('title',`%${search}%`);
    if(status==='open' || status==='solved')query=query.eq('status',status);
    const { data, error, count } = await query.order('updated_at',{ascending:false}).order('id').range(page*50,page*50+49);
    if (error) throw new Error('Gagal memuat kasus.');
    return NextResponse.json({ cases:data,total:count },{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Akses tidak tersedia.'},{status:403}); }
}
export async function POST(req: NextRequest) {
  const denied = rejectUntrustedOrigin(req); if (denied) return denied;
  try {
    const { db, access } = await growthCaseContext();
    const { data, error } = await db.rpc('growth_case_create',{w:access.workspaceId,c:crypto.randomUUID(),a:crypto.randomUUID()});
    if (error) throw new Error('Gagal membuat kasus.');
    return NextResponse.json({case:data},{status:201});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Gagal membuat kasus.'},{status:403}); }
}
