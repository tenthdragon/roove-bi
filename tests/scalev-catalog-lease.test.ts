import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let state: any, tick = 0;
function from(table: string) {
  assert.equal(table,'scalev_catalog_sync_state');
  let operation = '',payload: any,condition = ''; const filters: Record<string,unknown> = {};
  const q: any = {
    upsert(value: any,options: any) { assert.equal(options.ignoreDuplicates,true); operation = 'insert'; payload = value; return q; },
    update(value: any) { operation = 'update'; payload = value; return q; },
    eq(key: string,value: unknown) { filters[key] = value; return q; },
    or(value: string) { condition = value; return q; },select() { return q; },maybeSingle() { return q; },
    then(resolve: (v: any) => void) {
      if (operation === 'insert') { state ??= {...payload,updated_at:new Date().toISOString()}; return resolve({error:null}); }
      assert.equal(filters.workspace_id,'w'); assert.equal(filters.business_id,4);
      let matches = state && Object.entries(filters).every(([key,value]) => state[key] === value);
      if (condition) { assert.match(condition,/^sync_status.neq.running,updated_at.lt./); matches &&= state.sync_status !== 'running' || state.updated_at < condition.split('updated_at.lt.')[1]; }
      if (matches && operation === 'update') state = {...state,...payload,updated_at:new Date(Date.now() + ++tick).toISOString()};
      resolve({data:matches ? {...state} : null,error:null});
    },
  }; return q;
}
require.cache[require.resolve('../lib/service-supabase')] = {exports:{createServiceSupabase:()=>({from})}} as any;
const {claimCatalogBusiness,assertCatalogBusinessClaim,failCatalogBusinessClaim,completeCatalogBusinessClaim} = require('../lib/scalev-catalog-lease') as typeof import('../lib/scalev-catalog-lease');
beforeEach(() => { state = null; tick = 0; });
test('Business sync and sharing acquire the same exclusive generation; stale failure never overwrites a newer sync',async () => {
  const first = await claimCatalogBusiness('w',4,'RTI');
  await assert.rejects(claimCatalogBusiness('w',4,'RTI'),/sedang disinkronkan/);
  await assertCatalogBusinessClaim('w',4,first);
  await failCatalogBusinessClaim('w',4,first);
  const second = await claimCatalogBusiness('w',4,'RTI');
  assert.notEqual(first,second);
  await failCatalogBusinessClaim('w',4,first); assert.equal(state.sync_status,'running');
  await assert.rejects(assertCatalogBusinessClaim('w',4,first),/berubah/);
  await completeCatalogBusinessClaim('w',4,second,{last_synced_at:'2026-11-11',last_error:null,products_count:0,variants_count:0,bundles_count:1,identifiers_count:1});
  assert.equal(state.sync_status,'success'); assert.equal(state.bundles_count,1);
  await failCatalogBusinessClaim('w',4,second); assert.equal(state.sync_status,'success');
});
test('expired claims cannot write; a stale running generation is recoverable after thirty minutes',async () => {
  await claimCatalogBusiness('w',4,'RTI'); state.updated_at = new Date(Date.now()-31*60000).toISOString(); const old = state.updated_at;
  await assert.rejects(assertCatalogBusinessClaim('w',4,old),/kedaluwarsa/);
  const next = await claimCatalogBusiness('w',4,'RTI'); await assertCatalogBusinessClaim('w',4,next);
});
test('a conflicting Business id in another workspace cannot be claimed or overwritten',async () => {
  state = {workspace_id:'foreign',business_id:4,business_code:'RTI',sync_status:'success',updated_at:'2026-11-11'};
  await assert.rejects(claimCatalogBusiness('w',4,'RTI'),/sedang disinkronkan/); assert.equal(state.workspace_id,'foreign'); assert.equal(state.sync_status,'success');
});
