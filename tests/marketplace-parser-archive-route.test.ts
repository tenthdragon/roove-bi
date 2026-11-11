import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
const require=createRequire(import.meta.url);
const workspace='workspace-a',batchId='batch-a',bytes=new Uint8Array([1,2,3]);
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
let authorized=true,downloads=0,uploads:any[]=[],corrupt=false,foreignPath=false;
require.cache[require.resolve('../lib/marketplace-parser/access')]={exports:{parserAccess:async(w:string)=>{if(!authorized||w!==workspace)throw new Error('Forbidden');return {profile:{id:'actor'}};},parserActorName:async()=> 'Tester'}} as any;
require.cache[require.resolve('../lib/marketplace-parser/actions')]={exports:{getParserContext:async()=>({revision:1,migrationNotes:[],config:{}})}} as any;
require.cache[require.resolve('../lib/marketplace-parser/archive')] = { exports: {
  ARCHIVE_BUCKET:'marketplace-parser-archive', digest,
  readBatch:async(_db:any,w:string,id:string)=>{
    assert.equal(w,workspace);if(id!==batchId)throw new Error('Batch not found');
    return {id,filename:'source.xlsx',source_path:`${foreignPath?'foreign':w}/${id}/source.xlsx`,source_sha256:digest(bytes)};
  },
  archiveSource:async(input:any)=>{uploads.push(input);return {id:batchId};},
} } as any;
require.cache[require.resolve('../lib/service-supabase')] = { exports: {
  createServiceSupabase: () => ({ storage: { from: (bucket:string) => {
    assert.equal(bucket,'marketplace-parser-archive');
    return { download: async (path:string) => {
      assert.equal(path,`${workspace}/${batchId}/source.xlsx`); downloads++;
      return { data:new Blob([corrupt?new Uint8Array([9]):bytes]),error:null };
    } };
  } } }),
} } as any;
const {GET,POST}=require('../app/api/marketplace-parser/archive/route') as typeof import('../app/api/marketplace-parser/archive/route');
beforeEach(()=>{authorized=true;downloads=0;uploads=[];corrupt=false;foreignPath=false;});
const request=(query='')=>new NextRequest(`http://localhost:3130/api/marketplace-parser/archive?workspace=${workspace}&batch=${batchId}${query}`);
test('archive upload accepts the actual forwarded origin but rejects cross-origin requests before parsing',async()=>{
 const form=new FormData();form.append('file',new Blob([bytes]),'source.xlsx');form.append('account','roove');form.append('date','2026-11-11');
 const req=new NextRequest(request(),{method:'POST',headers:{origin:'http://127.0.0.1:3130','x-forwarded-host':'127.0.0.1:3130','x-forwarded-proto':'http'},body:form});
 const result=await POST(req);assert.equal(result.status,200);assert.deepEqual([...uploads[0].bytes],[1,2,3]);assert.equal(uploads[0].actorId,'actor');
 const blocked=await POST(new NextRequest(request(),{method:'POST',headers:{origin:'https://foreign.test',host:'localhost:3130','x-forwarded-proto':'http'},body:'invalid'}));assert.equal(blocked.status,403);assert.equal(uploads.length,1);
});
test('archive endpoint validates access, batch workspace, object path and original hash',async()=>{
 assert.equal((await GET(request())).status,200);assert.equal(downloads,1);
 authorized=false;assert.equal((await GET(request())).status,400);assert.equal(downloads,1);authorized=true;
 assert.equal((await GET(new NextRequest('http://localhost:3130/api/marketplace-parser/archive?workspace=foreign&batch=batch-a'))).status,400);
 foreignPath=true;assert.equal((await GET(request())).status,400);assert.equal(downloads,1);foreignPath=false;
 corrupt=true;const damaged=await GET(request());assert.equal(damaged.status,400);assert.match((await damaged.json()).error,/Integritas/);
});
