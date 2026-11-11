import type { Catalog, ParserConfig, PreviewLine, RouteDecision, RoutingCaseItem, RoutingResult } from './types';

// One bundle has the same destination at every quantity. Multi-bundle cases
// include quantities: approving a bonus combination must not approve another mix.
export function routingCase(lines: Pick<PreviewLine,'bundleId' | 'sku' | 'quantity'>[]) {
  if (!lines.length || lines.some(l => !l.bundleId || !l.sku || !l.quantity)) return null;
  const grouped = new Map<string,RoutingCaseItem>();
  for (const line of lines) {
    const key = JSON.stringify([line.bundleId,line.sku]);
    const item = grouped.get(key) || { bundleId: line.bundleId!,sku: line.sku,quantity: 0 };
    item.quantity += line.quantity!; grouped.set(key,item);
  }
  const items = [...grouped.values()].sort((a,b) => a.bundleId - b.bundleId || a.sku.localeCompare(b.sku));
  if (items.length === 1) items[0].quantity = 1;
  return { items,key: JSON.stringify(items.map(i => [i.bundleId,i.sku,i.quantity])) };
}
export function latestDecision(decisions: RouteDecision[], account: string,business: string,key: string) {
  return decisions.filter(d => d.account === account && d.business === business && d.caseKey === key).sort((a,b) => b.revision - a.revision)[0];
}
const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !['main','store','marketplace','markerplace','business','rti','jhn','free','bonus','gratis'].includes(w));
export function resolveStore(input: { account: string; business: string; lines: PreviewLine[]; config: ParserConfig; catalog: Catalog; ruleIds?: number[]; ruleValid?: boolean; sourceNames?: string[] }): RoutingResult {
  const {account,business,lines,config,catalog} = input;
  const result: RoutingResult = { status:'bundle',storeId:null,candidateIds:[],suggestedIds:[],caseKey:'',items:[],decisionId:null,message:'' };
  const identity = routingCase(lines);
  if (!identity) return result;
  result.caseKey=identity.key; result.items=identity.items;
  const eligible = catalog.stores.filter(s => s.business===business && config.stores.some(scope => scope.storeId===s.id));
  const allowed = new Set(eligible.map(s => s.id));
  const decisions = catalog.decisions || [];
  const decision = latestDecision(decisions,account,business,identity.key);
  function resolveSaved(ids: number[],id: string | null) {
    result.decisionId=id;
    if (ids.some(storeId => !allowed.has(storeId))) return {...result,status:'invalid' as const,message:'Store tersimpan tidak tersedia. Tinjau kembali keputusan.'};
    if (new Set(ids).size===1) return {...result,status:'saved' as const,storeId:ids[0]};
    return null;
  }
  if (decision) return resolveSaved([decision.storeId],decision.id)!;
  // An order-level decision never overwrites the constituent single-bundle rules.
  const singles=identity.items.map(i => latestDecision(decisions,account,business,JSON.stringify([[i.bundleId,i.sku,1]])));
  if (singles.some(d => d && !allowed.has(d.storeId))) return {...result,status:'invalid',message:'Store tersimpan tidak tersedia. Tinjau kembali keputusan.'};
  const bonus=/\b(free|bonus|gratis|gift)\b/i.test([...lines.map(l=>l.bundleName),...(input.sourceNames || [])].join(' '));
  if (identity.items.length>1 && singles.every(Boolean) && !bonus) {
    const saved=resolveSaved(singles.map(d=>d!.storeId),null); if(saved) return saved;
  }
  const choices=identity.items.map((item,index) => {
    const single=singles[index];
    if(single) return allowed.has(single.storeId) ? [single.storeId] : [];
    return [...new Set(catalog.bundles.find(b=>b.business===business && b.id===item.bundleId && b.sku===item.sku)?.storeIds || [])].filter(id=>allowed.has(id));
  });
  const common=eligible.map(s=>s.id).filter(id=>choices.every(ids=>ids.includes(id)));
  result.candidateIds=common;
  // Catalog membership is evidence, never eligibility. Gifts require an explicit
  // first approval; an existing exact decision above remains authoritative.
  if (!bonus && common.length===1) return {...result,status:'catalog',storeId:common[0]};
  if (!bonus && input.ruleValid && input.ruleIds?.length===1 && allowed.has(input.ruleIds[0])) return {...result,status:'rule',storeId:input.ruleIds[0]};
  const tokens=new Set(lines.flatMap(l=>words(l.bundleName)));
  const ranked=eligible.map(s=>({id:s.id,score:words(s.name).filter(w=>tokens.has(w)).length})).filter(s=>s.score>0).sort((a,b)=>b.score-a.score);
  result.suggestedIds=[...new Set([...common,...(input.ruleIds||[]).filter(id=>allowed.has(id)),...ranked.map(s=>s.id)])].slice(0,5);
  return {...result,status:'approval',message:bonus?'Bundle dengan bonus: pilih Store sekali untuk kasus ini.':common.length>1?'Beberapa Store cocok. Pilih tujuan.':'Pilih Store tujuan; keputusan akan diingat.'};
}
