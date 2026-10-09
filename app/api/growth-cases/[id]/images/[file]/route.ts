import { NextRequest, NextResponse } from 'next/server';
import { growthCaseContext } from '@/lib/growth-case-server';

export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string;file:string}}) {
  try {
    if(!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/i.test(params.file)) throw new Error('Invalid image');
    const {db,access}=await growthCaseContext(params.id);
    const {data,error}=await db.storage.from('growth-case-images').download(`${access.workspaceId}/${access.profile.id}/${params.id}/${params.file}`);
    if(error || !data) throw new Error('Missing image');
    return new NextResponse(data,{headers:{'Content-Type':data.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch {return NextResponse.json({error:'Gambar tidak ditemukan.'},{status:404});}
}
