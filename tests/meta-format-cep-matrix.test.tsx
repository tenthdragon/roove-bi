import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { buildFormatCepMatrix, MATRIX_METRICS } from '../lib/meta-format-cep-matrix';
import { MetaReportUnavailableError } from '../lib/meta-report-requests';
import { emptyTotals, metricValue, defaultFunnel } from '../lib/meta-funnel-domain';
import type { RawMetaReport } from '../lib/meta-ad-report';
import type { CreativeFormat } from '../lib/meta-creative-format';
Object.assign(globalThis,{React});
const require=createRequire(import.meta.url);
require.extensions['.css']=(module:any)=>{module.exports={default:new Proxy({},{get:(_t,n)=>String(n)})};};
const {create,act}=require('react-test-renderer');
const Matrix=require('../components/MetaFormatCepMatrix').default;
const totals=(x:object)=>({...emptyTotals(),...x});
function ad(id:string, patch:Partial<RawMetaReport['groups'][number]>={}, event='PURCHASE', format:CreativeFormat='image', ceps=['joint']):RawMetaReport['groups'][number] {
 const current=totals({spend:100,impressions:1000,lpv:10,atc:1,checkout:1,purchases:1});
 return {key:'ad:act_1:'+id,name:'Ad',current,previous:emptyTotals(),ad_ids:[id],ad_names:[],accounts:['A'],landing_page_urls:[],verified_ad_ids:[],
   matrix_metadata:{cep_keys:ceps,creative_format:format,uses_latest_metadata:false},
   optimization_breakdown:[{objective:'OUTCOME_SALES',optimization_goal:'OFFSITE_CONVERSIONS',conversion_event:event,custom_conversion_id:null,ad_ids:[id],current,previous:emptyTotals()}],...patch};
}
const raw=(groups:RawMetaReport['groups'])=>({groups,cepLabels:{joint:'Sendi',skin:'Kulit'}});
test('matrix sums facts before dividing and never averages ad-level rates or CPP',()=>{
 const matrix=buildFormatCepMatrix(raw([ad('1'),ad('2',{current:totals({spend:900,impressions:9000,lpv:100,atc:90,checkout:30,purchases:9})})]));
 const cell=matrix.universes[0].rows[0].cells.image!;
 const values=Object.fromEntries(MATRIX_METRICS.map(m=>[m.id,metricValue(cell.current,m)]));
 assert.deepEqual(values,{spent:1000,cpm:100,atc_rate:91/110,ic_rate:31/91,purchase_rate:10/31,cpp:100});
 assert.equal(cell.ads,2);assert.equal(matrix.current.spend,1000);
});
test('optimization universes keep objective, goal, event and custom conversion distinct',()=>{
 const groups=[ad('1'),ad('2',{},'INITIATED_CHECKOUT'),ad('3')];
 groups[2].optimization_breakdown![0]={...groups[2].optimization_breakdown![0],custom_conversion_id:'123'};
 const matrix=buildFormatCepMatrix(raw(groups));assert.equal(matrix.universes.length,3);assert.equal(matrix.ads,3);
 assert.deepEqual(new Set(matrix.universes.map(u=>u.label)),new Set(['Sales · Purchase','Sales · Initiate Checkout','Sales · Custom conversion · 123']));
 assert.equal(matrix.universes.reduce((n,u)=>n+u.current.spend,0),matrix.current.spend);
});
test('multi-CEP ads overlap in rows but count once in universe totals; account identity remains distinct',()=>{
 const a=ad('1',{},'PURCHASE','video',['joint','skin','joint']);
 const b=ad('1',{key:'ad:act_2:1'},'PURCHASE','video',['joint']);
 const matrix=buildFormatCepMatrix(raw([a,b])),u=matrix.universes[0];
 assert.equal(u.ads,2);assert.equal(u.overlapAds,1);assert.equal(u.current.spend,200);
 assert.equal(u.rows.find(r=>r.cep==='joint')?.cells.video?.ads,2);
 assert.equal(u.rows.find(r=>r.cep==='skin')?.cells.video?.ads,1);
 assert.equal(u.rows.reduce((n,r)=>n+r.current.spend,0),300);
});
test('unmapped CEP, unknown optimization and mixed/unknown formats stay visible without inventing metadata',()=>{
 const a=ad('1',{},'PURCHASE','mixed',[]),b=ad('2',{},'PURCHASE','unknown',['skin']);
 a.optimization_breakdown![0]={...a.optimization_breakdown![0],objective:null,optimization_goal:null,conversion_event:null};
 a.matrix_metadata!.uses_latest_metadata=true;
 const matrix=buildFormatCepMatrix(raw([a,b]));assert.equal(matrix.current.spend,200);
 const unknown=matrix.universes.find(u=>!u.optimization.optimization_goal)!;
 assert.equal(unknown.label,'Objective belum terbaca · Optimasi belum terbaca');assert.equal(unknown.rows[0].label,'Belum terpetakan');
 assert.equal(unknown.rows[0].cells.mixed?.latestFormatAds,1);assert.equal(unknown.latestFormatAds,1);
 assert.deepEqual(unknown.columns,['image','video','carousel','mixed']);
 assert.ok(matrix.universes.find(u=>u.optimization.optimization_goal)?.columns.includes('unknown'));
});
test('zero denominators stay absent and incomplete or duplicated report metadata fails closed',()=>{
 const a=ad('1',{current:totals({spend:100})});const matrix=buildFormatCepMatrix(raw([a]));
 assert.ok(MATRIX_METRICS.filter(m=>m.denominator).every(m=>metricValue(matrix.current,m)===null));
 assert.throws(()=>buildFormatCepMatrix(raw([ad('1',{matrix_metadata:undefined})])),/Metadata/);
 assert.throws(()=>buildFormatCepMatrix(raw([ad('1'),ad('1')])),/Duplikat/);
 assert.deepEqual(buildFormatCepMatrix(raw([])),{universes:[],current:emptyTotals(),ads:0});
});
test('matrix switches optimization universe, renders all six values and recovers when the selected universe disappears',async()=>{
 const matrix=buildFormatCepMatrix(raw([ad('1'),ad('2',{current:totals({spend:2000})},'INITIATED_CHECKOUT','video',['skin'])]));
 let root:any;await act(async()=>{root=create(<Matrix matrix={matrix} currency="IDR"/>);});
 const text=()=>JSON.stringify(root.toJSON());assert.match(text(),/Kulit/);assert.doesNotMatch(text(),/Sendi/);
 assert.equal(root.root.findAllByType('dt').length,6);assert.match(text(),/ATC rate/);assert.match(text(),/Purchase rate/);
 const purchase=matrix.universes.find(u=>u.optimization.conversion_event==='PURCHASE')!;
 await act(async()=>root.root.findByType('select').props.onChange({target:{value:purchase.key}}));
 assert.match(text(),/Sendi/);assert.doesNotMatch(text(),/Kulit/);
 await act(async()=>root.update(<Matrix matrix={buildFormatCepMatrix(raw([ad('2',{},'INITIATED_CHECKOUT','video',['skin'])]))} currency="IDR"/>));
 assert.match(text(),/Kulit/);assert.doesNotMatch(text(),/Sendi/);
 assert.equal(root.root.findByType('select').props.value,matrix.universes.find(u=>u.optimization.conversion_event==='INITIATED_CHECKOUT')!.key);
 await act(async()=>root.unmount());
});
function actionHarness(){
 const calls:any[]=[],ctx:any={schemaReady:true,workspaceId:'w',reportVersion:'9',reportRange:{from:'2026-10-01',to:'2026-10-20'},input:{from:'2026-10-01',to:'2026-10-20',filters:{cep:'joint'}},config:defaultFunnel(),scopedAccountIds:['act_2']};
 let denied=false;const report:any={groups:[ad('1')],currencies:['IDR'],cepLabels:{joint:'Sendi'}};
 const stubs:any={'./meta-report-context':{reportContext:async(input:any)=>{if(denied)throw Error('Brand tidak diizinkan');calls.push({context:input});return ctx;}},
 './meta-ad-report-data':{getCachedMetaFormatCepMatrix:async(...args:any[])=>{calls.push({report:args});
  const reportingError=report.currencies.length>1?'Mixed currencies':null;
  try{return {matrix:buildFormatCepMatrix(reportingError?{groups:[],cepLabels:{}}:report),reportingError,currency:report.currencies[0]};}
  catch{throw new MetaReportUnavailableError(false);}
 } }};
 const file=new URL('../lib/meta-brand-actions.ts',import.meta.url),req=createRequire(file),api:any={};
 const source=transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',source)((name:string)=>stubs[name]||req(name),api);
 return {ctx,report,calls,deny(){denied=true;},read:(patch:object={})=>api.getMetaFormatCepMatrix({from:'2026-10-01',to:'2026-10-20',brandId:'1',world:'website',workspaceId:'w',filters:{cep:'joint'},...patch})};
}
test('matrix action checks authorization before cached reads and scopes date, brand, filters and channel',async()=>{
 const h=actionHarness();const result=await h.read();assert.equal(result.matrix.ads,1);
 const [workspace,revision,q]=h.calls.find(c=>c.report).report;
 assert.equal(workspace,'w');assert.equal(revision,'9');assert.equal(q.brand,'1');assert.equal(q.channel,'non_cpas');assert.equal(q.groupBy,'ad');
 assert.deepEqual(q.config.account_ids,['act_2']);assert.equal(q.config.include_matrix,true);assert.equal(q.config.include_optimization,true);
 assert.equal(q.filters.cep,'joint');assert.equal(q.from,'2026-10-01');assert.equal(q.to,'2026-10-20');
 const before=h.calls.length;h.deny();await assert.rejects(h.read(),/Brand tidak diizinkan/);assert.equal(h.calls.length,before);
 const changed=actionHarness();await assert.rejects(changed.read({workspaceId:'other'}),/Workspace berubah/);assert.ok(!changed.calls.some(c=>c.report));
});
test('matrix action rejects mixed currency totals, supports CPAS scope and returns a recoverable missing-metadata error',async()=>{
 const h=actionHarness();h.report.currencies=['IDR','USD'];const mixed=await h.read();assert.ok(mixed.reportingError);assert.equal(mixed.matrix.ads,0);
 h.report.currencies=['IDR'];h.report.groups[0].matrix_metadata=undefined;assert.match((await h.read()).reportError,/belum berhasil/);
 const cpas=actionHarness();await cpas.read({world:'cpas'});assert.equal(cpas.calls.find(c=>c.report).report[2].channel,'cpas');
});
function cacheHarness(report:any){
 const calls:any[]=[],response:any={data:report,error:null};
 const stubs:any={'next/cache':{unstable_cache:(fn:any)=>fn},'./service-supabase':{createServiceSupabase:()=>({rpc:async(name:string,args:any)=>{calls.push({name,args});return response;}})}};
 const file=new URL('../lib/meta-ad-report-data.ts',import.meta.url),req=createRequire(file),api:any={};
 const source=transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',source)((name:string)=>stubs[name]||req(name),api);
 const query={from:'2026-10-01',to:'2026-10-20',brand:'1',channel:'non_cpas',groupBy:'ad',view:'overview',period:'week',groupKey:null,filters:{cep:'joint'},config:{account_ids:['act_1'],include_matrix:true,include_optimization:true}};
 return {calls,response,read:()=>api.getCachedMetaFormatCepMatrix('w','9',query)};
}
test('matrix cache stores a compact cohort summary for 5,000 ads and uses one scoped RPC',async()=>{
 const report={...raw(Array.from({length:5000},(_,i)=>ad(String(i)))),currencies:['IDR']};
 assert.ok(JSON.stringify(report).length>2*1024*1024);
 const h=cacheHarness(report),result=await h.read();
 assert.equal(result.matrix.ads,5000);assert.equal(result.matrix.universes[0].rows[0].cells.image.ads,5000);
 assert.ok(JSON.stringify(result).length<20_000,'Cache entry must contain aggregated cells, not per-ad payloads');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'get_meta_ad_report_incremental');
 assert.equal(h.calls[0].args.p_workspace_id,'w');assert.equal(h.calls[0].args.p_brand,'1');assert.deepEqual(h.calls[0].args.p_config.account_ids,['act_1']);
 assert.deepEqual(h.calls[0].args.p_filters,{cep:'joint',channel:'non_cpas'});
});
test('matrix cache suppresses mixed currencies and exposes missing metadata as a safe report failure',async()=>{
 const h=cacheHarness({...raw([ad('1')]),currencies:['IDR','USD']});const mixed=await h.read();
 assert.ok(mixed.reportingError);assert.equal(mixed.matrix.ads,0);
 h.response.data={...raw([ad('1',{matrix_metadata:undefined})]),currencies:['IDR']};
 await assert.rejects(h.read(),MetaReportUnavailableError);
});
