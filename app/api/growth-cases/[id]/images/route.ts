import { NextRequest, NextResponse } from 'next/server';
import { growthCaseContext } from '@/lib/growth-case-server';
import { imageExtension } from '@/lib/growth-case-domain';
import { rejectUntrustedOrigin } from '@/lib/request-hardening';

export async function POST(req:NextRequest,{params}:{params:{id:string}}) {
  const denied=rejectUntrustedOrigin(req); if(denied) return denied;
  if(Number(req.headers.get('content-length'))>5_300_000) return NextResponse.json({error:'Gambar maksimal 5 MB.'},{status:413});
  try {
    const { db,access }=await growthCaseContext(params.id);
    const file=(await req.formData()).get('file');
    if(!(file instanceof File) || !file.size || file.size>5_242_880) throw new Error('Pilih gambar PNG, JPG, WebP, atau GIF, maksimal 5 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const ext=imageExtension(bytes); if(!ext) throw new Error('Format gambar tidak didukung.');
    const filename=`${crypto.randomUUID()}.${ext}`;
    const path=`${access.workspaceId}/${access.profile.id}/${params.id}/${filename}`;
    const {error}=await db.storage.from('growth-case-images').upload(path,bytes,{contentType:ext==='jpg' ? 'image/jpeg' : `image/${ext}`,upsert:false});
    if(error) throw new Error('Gagal mengunggah gambar.');
    return NextResponse.json({src:`/api/growth-cases/${params.id}/images/${filename}`});
  } catch(error) {return NextResponse.json({error:error instanceof Error ? error.message : 'Gagal mengunggah gambar.'},{status:400});}
}
