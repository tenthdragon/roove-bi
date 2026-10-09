import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { assertLocalUrl, assertProjectConfig, assertLoopbackBindings, cleanEnvironment, blankDotenvKeys, localCliArgs, localSql, buildMigrations } from '../scripts/local-supabase-lib.mjs';
import { loopbackCreateBody } from '../scripts/local-docker-proxy.mjs';
import { csvRows,pendingRanges,batchHashSql,batchCompressedSql } from '../scripts/local-clone-checkpoint.mjs';
import { assertLocalRequest } from '../scripts/local-network-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CSV preserves null, empty string, embedded quotes/newlines and exact numeric strings',()=>{
  assert.equal(csvRows([{cells:[null,'','a"b','a\nb','9007199254740993']}]),',"","a""b","a\nb","9007199254740993"\n');
});
test('resume planner fills gaps only and rejects duplicate/overlapping saved packages',()=>{
  assert.deepEqual(pendingRanges(5500,[{offset:1000,rows:3000}],1000),[{offset:0,rows:1000},{offset:4000,rows:1000},{offset:5000,rows:500}]);
  assert.deepEqual(pendingRanges(5000,[{offset:0,rows:5000}]),[]);
  assert.throws(()=>pendingRanges(5000,[{offset:0,rows:3000},{offset:2000,rows:1000}]));
  assert.match(batchHashSql({schema:'public',name:'test',columns:['id'],keys:['id']},1000,1000),/MATERIALIZED.*LIMIT 1000 OFFSET 1000/);
  const compressed=batchCompressedSql({schema:'public',name:'test',columns:['id'],keys:['id']},0,1000,"'transient-test-key'");
  assert.match(compressed,/compress-algo=1,compress-level=1/);
  assert.doesNotMatch(compressed,/INSERT|UPDATE|DELETE|CREATE/);
});

test('local connection guard rejects every cloud/alternate URL', () => {
  assert.equal(assertLocalUrl('http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
  for (const url of ['https://example.supabase.co','http://localhost:54321','http://127.0.0.1:54322','http://127.0.0.1:54321@evil.test','http://127.0.0.1:54321/?x=1']) assert.throws(() => assertLocalUrl(url));
});
test('local app network guard permits local Supabase and refuses production/third-party calls', () => {
  for(const input of ['http://127.0.0.1:54321/rest/v1/workspaces',new URL('http://localhost:3130'),{hostname:'127.0.0.1',port:54321},new Request('http://127.0.0.1:54321')]) assert.doesNotThrow(()=>assertLocalRequest(input));
  for(const input of ['https://production.supabase.co','https://graph.facebook.com',{hostname:'api.scalev.id'},{host:'evil.test'},new Request('https://api.telegram.org')]) assert.throws(()=>assertLocalRequest(input));
});
test('CLI operations cannot push/reset/link/delete cloud resources', () => {
  assert.deepEqual(localCliArgs('start'), ['start','--workdir','.local','--network-id','roove-bi-local-loopback']);
  assert.deepEqual(localCliArgs('stop'), ['stop','--workdir','.local']);
  for (const action of ['push','reset','link','delete','branches','constructor','toString']) assert.throws(() => localCliArgs(action));
});
test('changing the generated project identity cannot target another Docker stack', () => {
  assert.doesNotThrow(() => assertProjectConfig('project_id = "roove-bi-local"\n'));
  assert.throws(() => assertProjectConfig('project_id = "other-project"\n'));
});
test('published local services must bind only to IPv4 loopback', () => {
  const container = (ip) => [{NetworkSettings:{Ports:{'8000/tcp':[{HostIp:ip,HostPort:'54321'}],'8080/tcp':null}}}];
  assert.doesNotThrow(() => assertLoopbackBindings(container('127.0.0.1')));
  for (const ip of ['0.0.0.0','::','']) assert.throws(() => assertLoopbackBindings(container(ip)));
});
test('Docker create guard binds only our project explicitly to localhost without changing volumes or keys', () => {
  const input = { Labels:{'com.supabase.cli.project':'roove-bi-local'}, Env:['LOCAL_KEY=test'], HostConfig:{PortBindings:{'5432/tcp':[{HostIp:'',HostPort:'54322'}]},Binds:['local-volume:/data']} };
  const result = JSON.parse(loopbackCreateBody(JSON.stringify(input)));
  assert.equal(result.HostConfig.PortBindings['5432/tcp'][0].HostIp, '127.0.0.1');
  assert.deepEqual(result.HostConfig.Binds, input.HostConfig.Binds);
  assert.deepEqual(result.Env, input.Env);
  assert.throws(() => loopbackCreateBody(JSON.stringify({...input,Labels:{'com.supabase.cli.project':'other-project'}})));
});
test('bootstrap creates equivalent indexes transactionally and does not seed historical stock/bank data', async () => {
  const index = localSql('085_scalev_query_indexes.sql','CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON test(id);');
  assert.match(index.sql,/CREATE INDEX IF NOT EXISTS idx/);
  assert.doesNotMatch(index.sql,/CONCURRENTLY/);
  for (const name of ['066_warehouse_seed_rlb_and_stock.sql','073_warehouse_reseed_all.sql']) {
    const adapted = localSql(name, await readFile(path.join(root,'supabase/migrations',name),'utf8')).sql;
    assert.match(adapted,/INSERT INTO warehouse_products/);
    assert.doesNotMatch(adapted,/INSERT INTO warehouse_batches|INSERT INTO warehouse_stock_ledger|SELECT _seed/);
  }
  assert.doesNotMatch(localSql('096_seed_bank_accounts.sql','original').sql,/INSERT/);
});
test('local launcher drops cloud secrets and masks dotenv declarations without copying values', () => {
  const env = cleanEnvironment({PATH:'/bin',HOME:'/home/test',SUPABASE_ACCESS_TOKEN:'cloud',GOOGLE_PRIVATE_KEY:'cloud',NODE_OPTIONS:'--require unsafe.js',NEXT_PUBLIC_SUPABASE_URL:'https://production.test'});
  assert.deepEqual(env, {PATH:'/bin',HOME:'/home/test'});
  assert.deepEqual(blankDotenvKeys('GOOGLE_PRIVATE_KEY="secret"\nexport META_ACCESS_TOKEN=secret\nNEXT_PUBLIC_SUPABASE_URL=https://production.test\n'), {GOOGLE_PRIVATE_KEY:'',META_ACCESS_TOKEN:'',NEXT_PUBLIC_SUPABASE_URL:''});
});
test('local adapters keep routing schema without production stock/order operations', async () => {
  const name = '179_transfer_historical_purvu_orders_to_apurva.sql';
  const adapted = localSql(name, await readFile(path.join(root,'supabase/migrations',name),'utf8')).sql;
  assert.match(adapted, /CREATE TABLE IF NOT EXISTS public.scalev_order_workspace_transfers/);
  assert.match(adapted, /CREATE TRIGGER prevent_transferred_scalev_order_recreation/);
  assert.doesNotMatch(adapted, /expected_purvu_transfer|352786/);
  assert.doesNotMatch(localSql('174_apurva_warehouse_cutover.sql','original').sql, /INSERT|UPDATE|DELETE/);
});
test('deterministic local migration copies omit diagnostics/rollback and respect vendor dependency', async () => {
  const entries = await buildMigrations(root);
  assert.deepEqual(entries, await buildMigrations(root));
  assert.equal(new Set(entries.map((e) => e.generatedName)).size, entries.length);
  assert.equal(entries[0].name, '000_local_legacy_base.sql');
  assert.ok(entries.findIndex((e) => e.name === '065_vendor_pkp.sql') > entries.findIndex((e) => e.name === '078_vendors_table.sql'));
  assert.ok(entries.some((e) => e.name === '195_growth_execution.sql'));
  assert.ok(entries.every((e) => !/ROLLBACK|verify|validation_queries/.test(e.name)));
});
