import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCreativeBatch } from '../lib/meta-ad-insights';
import { classifyCreativeMedia } from '../lib/meta-creative-format';
const item = (body: object, code = 200) => ({ code, body: JSON.stringify(body) });
test('explicit Instagram media formats include carousel albums', () => {
  for (const [media_type, type] of [['IMAGE','image'],['VIDEO','video'],['CAROUSEL_ALBUM','carousel'],['UNKNOWN','unknown']]) assert.equal(classifyCreativeMedia({ media_type }), type);
});
test('creative media reads are bounded, deduplicated and preserve partial successes', async () => {
  const calls: string[][] = [], original = globalThis.fetch;
  const responses = [
    [item({ id:'1',creative:{ id:'11',effective_instagram_media_id:'101' } }), item({ id:'2',creative:{ id:'12',effective_instagram_media_id:'101' } }),
      item({ id:'3',creative:{ id:'13',effective_instagram_media_id:'102',source_instagram_media_id:'103' } }),item({id:'4',creative:{id:'14',video_id:'900'}}),item({error:{code:100}},400)],
    [item({ id:'101',media_type:'CAROUSEL_ALBUM' }),item({error:{code:100}},400)],
    [item({id:'103',media_type:'VIDEO'})],
  ];
  globalThis.fetch = (async (_url, init) => { const batch = JSON.parse((init!.body as URLSearchParams).get('batch')!); calls.push(batch.map((b: any) => b.relative_url)); return Response.json(responses.shift()); }) as typeof fetch;
  try {
    const rows = await fetchCreativeBatch(['1','2','3','4','5'],'secret');
    assert.deepEqual(rows.map(r => 'error' in r ? 'error' : r.creative_format), ['carousel','carousel','video','video','error']);
    assert.equal(calls.length,3);assert.equal(calls[1].length,2);assert.equal(calls[2].length,1);
    assert.ok(calls.flat().every(p=>!p.includes('secret')));
  } finally { globalThis.fetch = original; }
});
test('failed media requests never guess image; valid creative metadata survives', async () => {
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++; if(calls===1)return Response.json([item({id:'1',creative:{id:'11',thumbnail_url:'cover',effective_instagram_media_id:'101'}})]);throw Error('unavailable');}) as typeof fetch;
  try { const [row]=await fetchCreativeBatch(['1'],'secret');assert.ok(!('error' in row));if(!('error' in row)){assert.equal(row.creative_id,'11');assert.equal(row.creative_format,'unknown');} }
  finally {globalThis.fetch=original;}
});
