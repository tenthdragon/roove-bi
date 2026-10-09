import { NextRequest, NextResponse } from 'next/server';
import { growthCaseContext } from '@/lib/growth-case-server';
import { validateCaseInput } from '@/lib/growth-case-domain';
import { rejectUntrustedOrigin } from '@/lib/request-hardening';

export const dynamic = 'force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string}}) {
  try {
    const { record } = await growthCaseContext(params.id);
    return NextResponse.json({case:record},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Kasus tidak ditemukan.'},{status:404}); }
}
export async function PUT(req:NextRequest,{params}:{params:{id:string}}) {
  const denied=rejectUntrustedOrigin(req); if(denied) return denied;
  if(Number(req.headers.get('content-length'))>4_000_000) return NextResponse.json({error:'Log terlalu panjang.'},{status:413});
  try {
    const {db,access}=await growthCaseContext(params.id);
    const body=await req.text();
    if(body.length>4_000_000) return NextResponse.json({error:'Log terlalu panjang.'},{status:413});
    const input=validateCaseInput(JSON.parse(body),params.id);
    const {data,error}=await db.rpc('growth_case_save',{w:access.workspaceId,c:params.id,expected:input.version,t:input.title,s:input.status,p:input.problem,a:input.attempts});
    if(error) return NextResponse.json({error:error.message.includes('Conflict') ? 'Kasus sudah diubah di tab lain. Salin perubahan Anda, lalu muat ulang kasus.' : 'Gagal menyimpan log kasus.'},{status:error.message.includes('Conflict') ? 409 : 400});
    return NextResponse.json({case:data});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Gagal menyimpan kasus.'},{status:400}); }
}
