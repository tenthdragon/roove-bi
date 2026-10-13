import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionOptions, matchesAdDimensions, withAdDimensions, validateDimensionFilters, type AdDimensions } from '../lib/meta-ad-dimensions';
import { compareGroups, defaultFunnel, emptyTotals, totalFacts, trend, metricValue, type AdFact } from '../lib/meta-funnel-domain';
const fact=(id:string,name:string,campaign:string|null,spend=100,objective?:string):AdFact=>({account_id:'act_1',account_name:'A',ad_id:id,ad_name:name,campaign_id:campaign,campaign_objective:objective,metric_date:'2026-10-01',currency:'IDR',metrics:{...emptyTotals(),spend,impressions:100,outbound_clicks:10,lpv:5}});
const map=(id:string,cep:string|null,campaign:string,objective:string|null,intention='cons',account='act_1'):AdDimensions=>({account_id:account,ad_id:id,cep_key:cep,intention_key:intention,campaign_id:campaign,campaign_name:'C',campaign_objective:objective});
test('CEP Sendi AND objective Sales includes consideration ads and excludes traffic, other CEPs, legacy conversions and unknowns',()=>{
 const facts=[fact('1','[sendi][cons] A','10'),fact('2','[sendi][conv] B','20'),fact('3','[skin][conv] C','10'),fact('4','[sendi][conv] D','40',100,'CONVERSIONS'),fact('5','[sendi][conv] E',null)];
 const mappings=[map('1','joint','10','OUTCOME_SALES'),map('2','joint','20','OUTCOME_TRAFFIC','conv'),map('3','skin','10','OUTCOME_SALES','conv')];
 const rows=withAdDimensions(facts,mappings).filter(r=>matchesAdDimensions(r,validateDimensionFilters({cep:'sendi',objective:'OUTCOME_SALES'})));
 assert.deepEqual(rows.map(r=>r.ad_id),['1']); assert.equal(rows[0].intention_key,'cons');
});
test('manual/current CEP classification wins over the reported name and objective fallback stays in its own account/campaign',()=>{
 const rows=withAdDimensions([fact('1','[sendi][cons] A','10'),fact('2','[sendi][cons] B','old'),{...fact('3','[sendi][cons] C','10'),account_id:'act_2'}],[map('1','bone','10','OUTCOME_SALES'),map('2','joint','new','OUTCOME_SALES')]);
 assert.equal(rows[0].cep_key,'bone'); assert.equal(rows[1].campaign_objective,null); assert.equal(rows[2].campaign_objective,null);
});
test('an objective observed in daily insights wins over newer campaign metadata',()=>{
 const rows=withAdDimensions([fact('1','[sendi][cons] A','10',100,'OUTCOME_TRAFFIC')],[map('1','joint','10','OUTCOME_SALES')]);
 assert.equal(rows[0].campaign_objective,'OUTCOME_TRAFFIC');
});
test('filtered per-ad report keeps identical names separate and uses totals for ratios and trends',()=>{
 const facts=[fact('1','[sendi][cons] Same','10',100),{...fact('2','[sendi][cons] Same','10',200),metrics:{...emptyTotals(),spend:200,impressions:300,outbound_clicks:30,lpv:20}},fact('3','[skin][cons] Other','10',999)];
 const rows=withAdDimensions(facts,[map('1','joint','10','OUTCOME_SALES'),map('2','joint','10','OUTCOME_SALES'),map('3','skin','10','OUTCOME_SALES')]).filter(r=>matchesAdDimensions(r,{cep:'joint',objective:'OUTCOME_SALES'}));
 const config={...defaultFunnel(),group_by:'ad_id' as const}; const groups=compareGroups(rows,config,'2026-10-01','2026-10-01');
 assert.equal(groups.length,2); assert.notEqual(groups[0].key,groups[1].key); assert.equal(totalFacts(rows).spend,300);
 assert.equal(metricValue(totalFacts(rows),config.metrics.find(m=>m.id==='lpv_rate')!),25/40);
 assert.equal(trend(rows,config,'2026-10-01','2026-10-01','day')[0].metrics.spent,300);
});
test('options preserve new values and unknowns without conflating objective with intention',()=>{
 const options=dimensionOptions([map('1','joint','10','OUTCOME_SALES','cons'),map('2','new-cep','20',null,'new-intention')]);
 assert.ok(options.ceps.some(o=>o.label==='Sendi' && o.value==='joint'));
 assert.ok(options.objectives.some(o=>o.label==='Sales' && o.value==='OUTCOME_SALES'));
 assert.ok(options.objectives.some(o=>o.value==='__unknown__')); assert.ok(options.intentions.some(o=>o.value==='new-intention'));
});
test('dimension counts deduplicate daily rows by account and ad, including unknowns and zero-count inventory choices',()=>{
 const mappings=[map('1','joint','10','OUTCOME_SALES'),map('2','joint','10','OUTCOME_SALES'),map('1','joint','10','OUTCOME_SALES','cons','act_2'),map('3','skin','10','OUTCOME_SALES')];
 const rows=withAdDimensions([fact('1','[sendi][cons] Same','10'),{...fact('1','[sendi][cons] Same','10'),metric_date:'2026-10-02'},fact('2','[sendi][cons] Same','10'),{...fact('1','[sendi][cons] Same','10'),account_id:'act_2'},fact('4','No tags',null),fact('5','[new-cep][cons] New',null)],mappings);
 const options=dimensionOptions(mappings,rows);
 assert.equal(options.ceps.find(o=>o.value==='joint')?.count,3);
 assert.equal(options.ceps.find(o=>o.value==='skin')?.count,0);
 assert.equal(options.ceps.find(o=>o.value==='__unknown__')?.count,1);
 assert.equal(options.ceps.find(o=>o.value==='new-cep')?.count,1);
 assert.equal(options.cepTotal,5);
 assert.equal(options.intentions.find(o=>o.value==='cons')?.count,4);
 assert.equal(options.intentions.find(o=>o.value==='__unknown__')?.count,1);
 assert.equal(options.intentionTotal,5);
 assert.equal(options.objectives.find(o=>o.value==='OUTCOME_SALES')?.count,3);
 assert.equal(options.objectives.find(o=>o.value==='__unknown__')?.count,2);
 assert.equal(options.objectiveTotal,5);
});
test('CEP counts respect intention and report-observed objective while keeping alternatives to the selected CEP available',()=>{
 const mappings=[map('1','joint','10','OUTCOME_SALES'),map('2','skin','10','OUTCOME_SALES'),map('3','joint','10','OUTCOME_SALES','conv'),map('4','joint','10','OUTCOME_SALES')];
 const rows=withAdDimensions([fact('1','A','10'),fact('2','B','10'),fact('3','C','10'),fact('4','D','10',100,'OUTCOME_TRAFFIC')],mappings);
 const options=dimensionOptions(mappings,rows,{cep:'joint',intention:'cons',objective:'OUTCOME_SALES'});
 assert.equal(options.ceps.find(o=>o.value==='joint')?.count,1);
 assert.equal(options.ceps.find(o=>o.value==='skin')?.count,1);
 assert.equal(options.cepTotal,2);
 assert.equal(options.intentions.find(o=>o.value==='cons')?.count,1);
 assert.equal(options.intentions.find(o=>o.value==='conv')?.count,1);
 assert.equal(options.intentionTotal,2);
 assert.equal(options.objectives.find(o=>o.value==='OUTCOME_SALES')?.count,1);
 assert.equal(options.objectives.find(o=>o.value==='OUTCOME_TRAFFIC')?.count,1);
 assert.equal(options.objectiveTotal,2);
});
test('all dimension choices sort by descending ad count, with alphabetical ties and zero-count choices last',()=>{
 const mappings=[map('1','skin','20','OUTCOME_TRAFFIC','conv'),map('2','joint','10','OUTCOME_SALES'),map('3','joint','10','OUTCOME_SALES'),map('4','joint','10','OUTCOME_SALES','disc'),map('5','skin','10','OUTCOME_SALES','conv'),map('6','bone','30','OUTCOME_AWARENESS','disc')];
 const rows=withAdDimensions([fact('1','A','20'),fact('2','B','10'),fact('3','C','10'),fact('4','D','10'),fact('5','E','10')],mappings);
 const options=dimensionOptions(mappings,rows);
 assert.deepEqual(options.ceps.map(o=>[o.value,o.count]),[['joint',3],['skin',2],['bone',0]]);
 assert.deepEqual(options.intentions.map(o=>[o.value,o.count]),[['cons',2],['conv',2],['disc',1]]);
 assert.deepEqual(options.objectives.map(o=>[o.value,o.count]),[['OUTCOME_SALES',4],['OUTCOME_TRAFFIC',1],['OUTCOME_AWARENESS',0]]);
});
