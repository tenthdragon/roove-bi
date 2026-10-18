import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDocument,validateDocument,validateCaseInput,imageExtension } from '../lib/growth-case-domain';
const id='11111111-1111-4111-8111-111111111111';
const attempt={id,hypothesis:emptyDocument(),action:emptyDocument(),result:emptyDocument()};
test('rich text keeps literal text, tables and private images',()=>{
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'<script>alert(1)</script>',marks:[{type:'bold'}]}]},{type:'image',attrs:{src:`/api/growth-cases/${id}/images/${id}.png`,alt:'Bukti'}},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:1,rowspan:1,colwidth:null},content:[{type:'paragraph'}]}]}]}]};
 assert.deepEqual(validateDocument(doc,id),doc);
});
test('rich text rejects executable URLs, cross-case images and arbitrary HTML attributes',()=>{
 for(const src of ['javascript:alert(1)','https://example.com/tracker.png',`/api/growth-cases/22222222-2222-4222-8222-222222222222/images/${id}.png`])assert.throws(()=>validateDocument({type:'doc',content:[{type:'image',attrs:{src}}]},id));
 assert.throws(()=>validateDocument({type:'doc',content:[{type:'paragraph',attrs:{onclick:'alert(1)'}}]},id));
 assert.throws(()=>validateDocument({type:'doc',content:[{type:'text',text:'link',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]},id));
});
test('default table alignment normalizes to the persisted schema without mutating the input',()=>{
 const doc={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:1,rowspan:1,colwidth:null,align:null},content:[{type:'paragraph'}]}]}]}]};
 const result=validateDocument(doc,id);
 assert.equal(result.content?.[0].content?.[0].content?.[0].attrs?.align,undefined);
 assert.equal(doc.content[0].content[0].content[0].attrs.align,null);
 assert.throws(()=>validateDocument({...doc,content:[{type:'tableCell',attrs:{align:'unsafe'}}]},id));
});
test('case validation preserves earlier attempts, allows blank results, rejects duplicate attempts',()=>{
 const data={title:'  Kasus conversion  ',status:'open',version:1,problem:emptyDocument(),attempts:[attempt,{...attempt,id:'22222222-2222-4222-8222-222222222222'}]};
 const result=validateCaseInput(data,id);assert.equal(result.title,'Kasus conversion');assert.equal(result.attempts.length,2);assert.deepEqual(result.attempts[0],attempt);
 assert.throws(()=>validateCaseInput({...data,attempts:[attempt,attempt]},id));
 assert.throws(()=>validateCaseInput({...data,title:' '},id));assert.throws(()=>validateCaseInput({...data,version:0},id));
});
test('image upload checks actual bytes instead of filename or MIME',()=>{
 assert.equal(imageExtension(Buffer.from('<svg onload="alert(1)">')),null);
 assert.equal(imageExtension(Buffer.from([137,80,78,71,13,10,26,10])), 'png');
 assert.equal(imageExtension(Buffer.from([255,216,255])), 'jpg');
 assert.equal(imageExtension(Buffer.from('GIF89a')), 'gif');
 assert.equal(imageExtension(Buffer.from('RIFFxxxxWEBP')), 'webp');
});
