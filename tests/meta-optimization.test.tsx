import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { optimizationInventoryRows, optimizationLabel, optimizationTarget, type MetaOptimization } from '../lib/meta-ad-optimization';
import { optimizationGroups, compareMetrics, type TemplateGroup } from '../lib/meta-funnel-templates';
import { emptyTotals, defaultFunnel } from '../lib/meta-funnel-domain';
import { useMetaBreakdownPreference } from '../lib/useMetaBreakdownPreference';
Object.assign(globalThis,{React});
const require=createRequire(import.meta.url);
require.extensions['.css']=(module:any)=>{module.exports={default:new Proxy({},{get:(_t,n)=>String(n)})};};
const {create,act}=require('react-test-renderer');
const Results=require('../components/MetaTemplateResults').default;
const optimization=(goal:string|null,event:string|null=null,objective='OUTCOME_SALES'):MetaOptimization=>({objective,optimization_goal:goal,conversion_event:event,custom_conversion_id:null});
test('labels campaign and actual optimization separately, preserving unknown/custom/value distinctions',()=>{
 for(const [goal,event,label] of [['OFFSITE_CONVERSIONS','PURCHASE','Sales · Purchase'],['OFFSITE_CONVERSIONS','INITIATED_CHECKOUT','Sales · Initiate Checkout'],['OFFSITE_CONVERSIONS','ADD_TO_CART','Sales · Add to Cart'],['VALUE','PURCHASE','Sales · Purchase value']] as const) assert.equal(optimizationLabel(optimization(goal,event)),label);
 assert.equal(optimizationLabel(optimization('LANDING_PAGE_VIEWS',null,'OUTCOME_TRAFFIC')),'Traffic · Landing Page Views');
 assert.equal(optimizationLabel(optimization('REACH',null,'OUTCOME_AWARENESS')),'Awareness · Reach');
 assert.equal(optimizationTarget(optimization('OFFSITE_CONVERSIONS')),'Conversion · event belum terbaca');
 assert.equal(optimizationTarget(optimization(null,'PURCHASE')),'Optimasi belum terbaca','Event alone cannot prove the optimization goal');
 assert.equal(optimizationTarget({...optimization('OFFSITE_CONVERSIONS','OTHER'),custom_conversion_id:'123'}),'Custom conversion · 123');
 assert.equal(optimizationTarget(optimization('FUTURE_GOAL')),'Future goal');
});
test('inventory deduplicates adsets, retains freshest observation, and does not infer from names',()=>{
 const older={id:'1',name:'optimized Purchase',campaign:{id:'20',objective:'OUTCOME_SALES'},adset:{id:'30',updated_time:'2026-10-01T00:00:00Z',optimization_goal:'OFFSITE_CONVERSIONS',promoted_object:{custom_event_type:'INITIATED_CHECKOUT'}}};
 const newer={...older,id:'2',adset:{...older.adset,updated_time:'2026-10-02T00:00:00Z',promoted_object:{custom_event_type:'PURCHASE'}}};
 const rows=optimizationInventoryRows([newer,older,{id:'3',name:'Sales Purchase'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].conversion_event,'PURCHASE');assert.equal(rows[0].source_updated_at,'2026-10-02T00:00:00.000Z');
 assert.throws(()=>optimizationInventoryRows([older,{...older,campaign:{id:'21'}}]),/campaign berbeda/);
});
const totals=(x:object)=>({...emptyTotals(),...x});
const metrics=defaultFunnel().metrics;
const group:TemplateGroup={key:'landing:https://example.com',name:'https://example.com',ad_ids:['1','2'],accounts:['A'],ad_names:[],landing_page_urls:['https://example.com'],verified_ad_ids:[],metrics:[],current:totals({spend:300,purchases:3}),previous:totals({spend:200,purchases:1}),
 format_breakdown:[{format:'image',ad_ids:['1','2'],current:totals({spend:300,purchases:3}),previous:totals({spend:200,purchases:1})}],
 optimization_breakdown:[{...optimization('OFFSITE_CONVERSIONS','PURCHASE'),ad_ids:['1'],current:totals({spend:100,purchases:2}),previous:totals({spend:50,purchases:1})},{...optimization('OFFSITE_CONVERSIONS','INITIATED_CHECKOUT'),ad_ids:['2'],current:totals({spend:200,purchases:1}),previous:totals({spend:150,purchases:0})}]};
group.metrics=compareMetrics(group.current,group.previous,metrics);
test('optimization children keep parent columns, summed-event ratios and separate comparison cohorts',()=>{
 const children=optimizationGroups(group,metrics);assert.equal(children.length,2);
 const purchase=children.find(c=>c.name==='Sales · Purchase')!;
 assert.equal(purchase.metrics.find(m=>m.id==='cpp')?.current,50);assert.equal(purchase.metrics.find(m=>m.id==='cpp')?.previous,50);
 assert.equal(children.reduce((n,g)=>n+g.current.spend,0),group.current.spend);assert.equal(purchase.optimization_breakdown,undefined);
});
test('switching breakdown replaces subrows without changing parent, totals or visible column count',async()=>{
 const section={key:'s',funnelId:'s',name:'Test',kind:'transaction',config:{...defaultFunnel(),id:'s'},groups:[group],summary:group.current,previous:group.previous,metrics:group.metrics,mainMetric:null,mainMedian:null};
 let root:any;const props={section,world:'website',currency:'IDR',preferencesReady:true,onOpenGroup:()=>{}};
 await act(async()=>{root=create(<Results {...props}/>);});
 const text=()=>JSON.stringify(root.toJSON());assert.match(text(),/Image/);assert.doesNotMatch(text(),/Sales · Purchase/);
 const parentColumns=root.root.findByType('tbody').findAllByType('tr')[0].findAllByType('td').length;
 await act(async()=>root.update(<Results {...props} breakdown="optimization"/>));
 assert.match(text(),/Sales · Purchase/);assert.match(text(),/Sales · Initiate Checkout/);assert.doesNotMatch(text(),/"Image"/);
 assert.equal(root.root.findByType('tbody').findAllByType('tr').length,3);assert.equal(root.root.findByType('tbody').findAllByType('tr')[0].findAllByType('td').length,parentColumns);
 await act(async()=>root.unmount());
});
test('breakdown preference restores, isolates sessions, and handles blocked storage',async()=>{
 const oldWindow=globalThis.window,store=new Map<string,string>();let state:ReturnType<typeof useMetaBreakdownPreference>;
 Object.assign(globalThis,{window:{localStorage:{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)}}});
 function Probe({workspace='w',user='u'}:{workspace?:string;user?:string}){state=useMetaBreakdownPreference(workspace,user);return null;}
 let root:any;
 try{
  await act(async()=>{root=create(<Probe/>);});assert.equal(state!.value,'format');
  await act(async()=>state!.select('optimization'));assert.equal(state!.value,'optimization');
  await act(async()=>root.unmount());await act(async()=>{root=create(<Probe/>);});assert.equal(state!.value,'optimization');
  await act(async()=>root.update(<Probe user="other"/>));assert.equal(state!.value,'format');
  await act(async()=>root.update(<Probe workspace="other"/>));assert.equal(state!.value,'format');
  globalThis.window.localStorage.setItem=()=>{throw Error('blocked');};
  await act(async()=>state!.select('optimization'));assert.equal(state!.value,'optimization');assert.ok(state!.error);
 }finally{await act(async()=>root.unmount());Object.assign(globalThis,{window:oldWindow});}
});
