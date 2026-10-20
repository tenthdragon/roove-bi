import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import React from 'react';
import { visibleMetaTemplates, brandTemplateRules } from '../lib/meta-template-scope';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';
import { matchDestinationTemplate, assignTemplateSections, type TemplateRule, type ReportGroup } from '../lib/meta-funnel-templates';
import { resolveTaxonomy, validateIntention } from '../lib/meta-ad-taxonomy';
import { classifyWorklistInventory } from '../lib/meta-worklist-inventory';
import { buildWorklist } from '../lib/meta-ad-worklist';
import { buildCepView } from '../lib/meta-cep-view';
import { cepGroupKey } from '../lib/meta-cep-key';
import { parseAdMapping } from '../lib/meta-ad-mapping';
import { dimensionOptions } from '../lib/meta-ad-dimensions';

function load(file: string, stubs: Record<string, unknown>): any {
  const url = new URL(`../${file}`, import.meta.url), require = createRequire(url);
  const output = transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.React } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'React', output)((name: string) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), exports, React);
  return exports;
}
const scope = { brandIds: [1], accountIds: ['act_1'], accessKey: 'one' };
const ctx = { ...scope, workspaceId: 'workspace', profile: { id: 'verified-user', role: 'advertiser' } };
const templates = [
  { ...defaultFunnel(), id: 'shared', brand_id: null },
  { ...defaultFunnel(), id: 'own', brand_id: 1 },
  { ...defaultFunnel(), id: 'foreign', brand_id: 2 },
];
const categories = [{ brand_id: 1, key: 'b1.retention', label: 'Retention', description: '', revision: 1, is_active: true },
  { brand_id: 2, key: 'b2.retention', label: 'Other retention', description: '', revision: 1, is_active: true }];
function database(tables: Record<string, any[]>) {
  return { from(table: string) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    let rows = tables[table]; const q: any = {
      select: () => q, order: () => q, eq: (k: string,v: any) => { rows=rows.filter(r=>r[k]===v);return q; },
      single: async () => ({ data: rows[0] || null, error: rows.length === 1 ? null : { message: 'Missing' } }),
      then: (resolve: any) => Promise.resolve({ data: rows,error:null }).then(resolve),
    }; return q;
  } };
}

test('funnel visibility follows assigned brand even when account_ids is the all-accounts wildcard', () => {
  assert.deepEqual(visibleMetaTemplates(templates, scope).map(f=>f.id), ['shared','own']);
  assert.deepEqual(visibleMetaTemplates(templates, {...scope,brandIds:[],accountIds:[]}), []);
  assert.deepEqual(visibleMetaTemplates(templates, {brandIds:null,accountIds:null,accessKey:'all'}, '2').map(f=>f.id), ['shared','foreign']);
});
test('same URL has isolated brand assignments with shared rules as fallback', () => {
  const rules: TemplateRule[] = [
    {id:'global',brand_id:null,funnel_id:'shared',match_kind:'exact',pattern:'https://example.com/path'},
    {id:'own-rule',brand_id:1,funnel_id:'own',match_kind:'domain',pattern:'example.com'},
    {id:'foreign-rule',brand_id:2,funnel_id:'foreign',match_kind:'exact',pattern:'https://example.com/path'},
  ];
  const group: ReportGroup = {key:'landing:https://example.com/path',name:'Page',landing_page_urls:['https://example.com/path'],current:{...emptyTotals(),spend:100},previous:emptyTotals(),ad_ids:['1'],accounts:['Account'],ad_names:['Ad'],verified_ad_ids:[]};
  for (const [brand,expected] of [[1,'own'],[2,'foreign'],[3,'shared']] as const) {
    assert.equal(matchDestinationTemplate(group,brandTemplateRules(rules,brand))?.funnel_id,expected);
    const result=assignTemplateSections([group],templates.filter(f=>f.brand_id===null||f.brand_id===brand),brandTemplateRules(rules,brand));
    assert.equal(result.sections.find(s=>s.groups.length)?.funnelId,expected);
    assert.equal(result.sections.reduce((sum,s)=>sum+s.summary.spend,0),100);
  }
});
test('editing permission is independent of integration access and fails on workspace switches', async () => {
  let permission = 'meta:mapping', workspaceId = ctx.workspaceId;
  const api=load('lib/meta-report-context.ts', {
    './dashboard-access': {requireDashboardTabAccess:async()=>ctx,requireDashboardPermissionAccess:async (key:string)=> { assert.equal(key,permission);return {...ctx,workspaceId}; }},
    './workspaces':{isWorkspaceModuleEnabled:()=>true},
    './meta-brand-access':{loadMetaBrandScope:async()=>scope},
  });
  for (permission of ['meta:mapping','meta:taxonomy','meta:funnels']) assert.equal((await api.editAccess(permission)).profile.id,'verified-user');
  workspaceId='other'; await assert.rejects(api.editAccess(permission),/Workspace berubah/);
  await assert.rejects(api.manageAccess(),/pengelola workspace/,'Advertiser cannot trigger integration sync');
});
test('mapping action rejects forged accounts, foreign CEPs and mixed unauthorized bulk selections before writes', async () => {
  const writes: any[]=[];
  const svc=database({ meta_ad_accounts: [{workspace_id:'workspace',account_id:'act_1',default_brand_id:1,is_active:true},{workspace_id:'workspace',account_id:'act_2',default_brand_id:2,is_active:true}],
    meta_ad_classifications:[{workspace_id:'workspace',account_id:'act_1',ad_id:'1',revision:1,overrides:{},cep_keys:[]},{workspace_id:'workspace',account_id:'act_2',ad_id:'2',revision:1,overrides:{},cep_keys:[]}] });
  const api=load('lib/meta-ad-mapping-actions.ts',{
    './meta-report-context':{editAccess:async(key:string)=>{assert.equal(key,'meta:mapping');return ctx;}},
    './service-supabase':{createServiceSupabase:()=>svc},
    './meta-taxonomy-store':{loadTaxonomy:async()=>({catalog:categories,intentions:categories})},
    './meta-edit-mutations':{mutateMeta:async(...args:any[])=>{writes.push(args);return {saved:true};}},
  });
  assert.deepEqual(await api.saveMetaAdMappingOverrides({accountId:'act_1',adId:'1',revision:1,intention:'b1.retention'}),{saved:true});
  assert.equal(writes[0][0].profile.id,'verified-user');assert.equal(writes[0][1],'mapping');
  assert.ok((await api.saveMetaAdMappingOverrides({accountId:'act_2',adId:'2',revision:1,intention:'b2.retention'})).error);
  assert.ok((await api.saveMetaAdMappingOverrides({accountId:'act_1',adId:'1',revision:1,ceps:['b2.retention']})).error);
  await assert.rejects(api.saveMetaAdMappingOverridesBulk({ads:[{accountId:'act_1',adId:'1'},{accountId:'act_2',adId:'2'}],intention:'b1.retention'}),/di luar akses/);
  assert.equal(writes.length,1);
});
test('taxonomy category, status, and rule previews reject forged brand IDs', async () => {
  let reads=0;
  const api=load('lib/meta-ad-taxonomy-actions.ts',{
    './meta-taxonomy-store':{taxonomyAccess:async()=>ctx,loadTaxonomy:async()=>{reads++;return {brands:[],catalog:[],intentions:[],rules:[]};}},
    './meta-edit-mutations':{mutateMeta:async()=>{throw new Error('Must not mutate');}},
  });
  assert.ok((await api.saveMetaCepCategory({brandId:2,key:'',label:'Foreign',description:'',revision:0})).error);
  assert.ok((await api.saveMetaIntentionCategory({brandId:2,key:'',label:'Foreign',description:'',revision:0})).error);
  assert.ok((await api.setMetaIntentionCategoryActive({brandId:2,key:'b2.retention',revision:1,active:false})).error);
  assert.ok((await api.previewMetaTaxonomyRule({brandId:2,dimension:'intention',raw:'retention',ceps:[],intention:'b2.retention',revision:0})).error);
  assert.equal(reads,0);
});
test('custom intentions flow from naming into worklist, filters, and CEP matrix without losing spend', () => {
  const raw=parseAdMapping('[x][retention]');
  const resolved=resolveTaxonomy(1,raw,{},[],[],categories);
  assert.equal(resolved.intention_key,'b1.retention');
  assert.throws(()=>validateIntention('b2.retention',1,categories));
  assert.throws(()=>validateIntention('b1.retention',1,[{...categories[0],is_active:false}]));
  assert.equal(validateIntention('b1.retention',1,[{...categories[0],is_active:false}],'b1.retention'),'b1.retention');
  const mappings=classifyWorklistInventory([{workspace_id:'workspace',account_id:'act_1',ad_id:'1',ad_name:'[x][retention]',auto_mapping:raw,overrides:{},landing_page_urls:[],last_seen_at:'',revision:1} as any], [{account_id:'act_1',default_brand_id:1}],[],[],categories);
  const list=buildWorklist({mappings,accounts:[{account_id:'act_1',account_name:'One'}],activity:[{account_id:'act_1',ad_id:'1',spend:100,impressions:10,last_active:null}],verified:[],intentions:categories});
  assert.equal(list.rows[0].intention.label,'Retention');assert.ok(!list.rows[0].issues.includes('intention'));
  const dimensions=[{account_id:'act_1',ad_id:'1',cep_key:null,intention_key:'b1.retention',campaign_id:null,campaign_name:null,campaign_objective:null}];
  assert.equal(dimensionOptions(dimensions,dimensions,{},[],[categories[0]]).intentions.find(c=>c.value==='b1.retention')?.count,1);
  const totals={...emptyTotals(),spend:100};
  const matrix=buildCepView([{key:cepGroupKey('skin','b1.retention'),name:'',current:totals,previous:emptyTotals(),ad_ids:['1'],ad_names:[],accounts:[],landing_page_urls:[],verified_ad_ids:[]}], 'website',totals,emptyTotals(),{intentionLabels:{'b1.retention':'Retention'}});
  assert.equal(matrix.columns.find(c=>c.intention==='b1.retention')?.label,'Retention');
  assert.equal(matrix.columns.find(c=>c.intention==='b1.retention')?.current.spend,100);
});
test('intention editor submits selected brand and hides all mutations without taxonomy permission', async () => {
  const {create,act}=createRequire(import.meta.url)('react-test-renderer');const writes:any[]=[];
  const Component=load('components/MetaIntentionCatalog.tsx',{
    '@/lib/meta-ad-taxonomy-actions':{saveMetaIntentionCategory:async(input:any)=>{writes.push(input);return {};},setMetaIntentionCategoryActive:async()=>({})},
    '@/app/dashboard/meta-funnels/page.module.css':{default:{}},
  }).default;
  let root:any;
  await act(async()=>{root=create(React.createElement(Component,{brandId:1,catalog:[],canManage:true,onSaved:async()=>{}}));});
  await act(async()=>root.root.findAllByType('button')[0].props.onClick());
  await act(async()=>root.root.findByType('input').props.onChange({target:{value:'Retention'}}));
  await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'Existing customers'}}));
  await act(async()=>root.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes[0].brandId,1);assert.equal(writes[0].label,'Retention');
  await act(async()=>root.update(React.createElement(Component,{brandId:1,catalog:categories,canManage:false,onSaved:async()=>{}})));
  assert.equal(root.root.findAllByType('button').length,0);await act(async()=>root.unmount());
});

test('advertiser template editor copies shared templates into the selected brand and resets on brand switch', async () => {
  const {create,act}=createRequire(import.meta.url)('react-test-renderer');
  const writes:any[]=[], reads:any[]=[];
  const config={...defaultFunnel(),name:'Shared template',id:'shared',brand_id:null,version:1,kind:'transaction',rules:0,mainMetric:null};
  const data=(brandId=1)=>({schemaReady:true,brandId,brands:[{id:1,name:'One'},{id:2,name:'Two'}],rulesReady:true,templates:[config],accounts:[],rules:[],landingPages:[],range:{from:'2026-10-01',to:'2026-10-19'},currency:'IDR'});
  function Editor(props:any) { return React.createElement('button',{onClick:props.onSave},'Save copied funnel'); }
  const Component=load('app/dashboard/meta-funnels/templates/page.tsx',{
    '@/lib/WorkspaceContext':{useWorkspace:()=>({activeWorkspace:{id:'workspace'}})},
    '@/lib/PermissionsContext':{usePermissions:()=>({role:'advertiser',can:(key:string)=>key==='meta:funnels'})},
    '@/lib/useMetaCachedLoad':{useMetaReportSession:()=>({key:'session'})},
    '@/lib/meta-funnel-actions':{saveMetaFunnel:async(input:any)=>{writes.push(input);return {id:'new'};},archiveMetaFunnel:async()=>{throw new Error('Must not archive shared');}},
    '@/lib/meta-brand-actions':{
      getMetaTemplateSettings:async(brandId?:number)=>{reads.push(brandId);return data(brandId);},
      getMetaTemplateConfiguration:async(brandId:number)=>data(brandId),
      createMetaTemplatePreset:async(kind:string,brandId:number)=>{writes.push({kind,brandId});},
    },
    '@/components/MetaAdsNav':{default:(props:any)=>React.createElement('div',null,props.actions)},
    '@/components/MetaFunnelEditor':{default:Editor},
    '../page.module.css':{default:{}},
  }).default;
  let root:any;
  await act(async()=>{root=create(React.createElement(Component));});
  const button=(text:string)=>root.root.findAllByType('button').find((b:any)=>b.children.join('')===text);
  assert.equal(button('Ubah template'),undefined);
  await act(async()=>button('Salin untuk brand ini').props.onClick());
  await act(async()=>button('Save copied funnel').props.onClick());
  assert.equal(writes[0].brandId,1);assert.equal(writes[0].id,undefined);assert.deepEqual(writes[0].config.account_ids,[]);
  await act(async()=>button('Salin untuk brand ini').props.onClick());
  await act(async()=>root.root.findByProps({'aria-label':'Brand template'}).props.onChange({target:{value:'2'}}));
  assert.equal(button('Save copied funnel'),undefined);
  assert.equal(reads.at(-1),2);
  await act(async()=>button('+ Template Transaksi').props.onClick());
  assert.deepEqual(writes.at(-1),{kind:'transaction',brandId:2});
  await act(async()=>root.unmount());
});
