import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// PGLITE_MODULE is an optional absolute module path for a disposable in-memory
// PostgreSQL. Otherwise use the same disposable Docker setup as existing DB tests.
const database = `financial_correction_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
let engine;
let run;
const docker = (cmd, args, input) => execFileSync('docker', ['exec','-i',container,
  cmd,'-U','supabase_admin',...args], { input, encoding: 'utf8' });
if (process.env.PGLITE_MODULE) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  engine = new PGlite();
  run = sql => engine.exec(sql);
} else {
  docker('createdb',[database]);
  run = async sql => docker('psql',['-X','-d',database,'-v','ON_ERROR_STOP=1','-q'],sql);
}
const w = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const owner = '00000000-0000-4000-8000-000000000003';
const stranger = '00000000-0000-4000-8000-000000000004';
const save = (changes, version, actor = owner, workspace = w) => `SELECT public.set_scalev_financial_corrections(
  '${workspace}',1,'${JSON.stringify(changes).replaceAll("'", "''")}'::jsonb,'Reviewed decimal correction',${version},'${actor}');`;
const check = async (expression, label) => run(`DO $$ BEGIN IF NOT (${expression}) THEN RAISE EXCEPTION '${label}'; END IF; END $$;`);
const rejects = async (sql, pattern) => {
  try { await run(sql); } catch (error) {
    assert.match(String(error.message) + String(error.stderr || ''), pattern); return;
  }
  throw new Error('Expected rejection: '+pattern);
};
try {
  await run(`
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE profiles(id uuid PRIMARY KEY);
    CREATE TABLE workspace_memberships(workspace_id uuid,user_id uuid,role text,status text);
    CREATE FUNCTION workspace_has_role(w uuid,r text[]) RETURNS boolean LANGUAGE sql AS $$
      SELECT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=w AND user_id=auth.uid() AND role=ANY(r) AND status='active') $$;
    CREATE TABLE scalev_orders(id bigint PRIMARY KEY,workspace_id uuid,status text,raw_data jsonb,
      gross_revenue numeric(14,2),net_revenue numeric(14,2),shipping_cost numeric(12,2),
      shipping_discount numeric(12,2),discount_code_discount numeric(12,2),unique_code_discount numeric(12,2));
    CREATE TABLE scalev_order_lines(id bigint PRIMARY KEY,workspace_id uuid,scalev_order_id bigint,
      product_name text,quantity int,product_price_bt numeric(12,2),discount_bt numeric(12,2),cogs_bt numeric(12,2),
      UNIQUE(scalev_order_id,product_name));
    -- An incremental summary must finish with effective values even after upserts.
    CREATE TABLE summary(amount numeric NOT NULL); INSERT INTO summary VALUES(0);
    CREATE FUNCTION update_test_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP <> 'INSERT' THEN UPDATE summary SET amount=amount-(OLD.product_price_bt-OLD.discount_bt-OLD.cogs_bt); END IF;
      IF TG_OP <> 'DELETE' THEN UPDATE summary SET amount=amount+(NEW.product_price_bt-NEW.discount_bt-NEW.cogs_bt); END IF;
      RETURN NULL; END $$;
    CREATE TRIGGER trg_order_line_summaries AFTER INSERT OR UPDATE OR DELETE ON scalev_order_lines FOR EACH ROW EXECUTE FUNCTION update_test_summary();
    INSERT INTO workspaces VALUES('${w}'),('${other}'); INSERT INTO profiles VALUES('${owner}'),('${stranger}');
    INSERT INTO workspace_memberships VALUES('${w}','${owner}','workspace_owner','active'),('${other}','${stranger}','workspace_owner','active');
    INSERT INTO scalev_orders VALUES(1,'${w}','shipped','{"net_revenue":525}',525,525,0,NULL,0,0);
    INSERT INTO scalev_order_lines VALUES(10,'${w}',1,'Product A',2,790000,789475,193384);
  `);
  await run(readFileSync(new URL('../supabase/migrations/188_serialize_scalev_order_line_writes.sql',import.meta.url),'utf8'));
  await run(readFileSync(new URL('../supabase/migrations/246_scalev_financial_corrections.sql',import.meta.url),'utf8'));
  // Each call is its own transaction; session claim role is needed for subsequent calls.
  await run(`SELECT set_config('request.jwt.claim.role','service_role',false);`);
  await run(save([
    {entity:'order',field:'net_revenue',amount:525000},
    {entity:'order',field:'gross_revenue',amount:525000},
    {entity:'line',line_key:'Product A',field:'discount_bt',amount:265000},
  ],0));
  await check(`(SELECT net_revenue=525000 AND raw_data='{"net_revenue":525}'::jsonb FROM scalev_orders WHERE id=1)`, 'header/raw mismatch');
  await check(`(SELECT amount=331616 FROM summary)`, 'summary correction mismatch');
  await check(`(SELECT source_amount=789475 AND original_amount=789475 FROM scalev_financial_corrections WHERE field='discount_bt')`, 'source lost');
  await check(`(SELECT quantity=2 AND cogs_bt=193384 FROM scalev_order_lines WHERE id=10)`, 'unrelated values changed');

  // Full upsert + repeated replay: no multiplication, latest source captured.
  for (let i=0;i<3;i++) await run(`INSERT INTO scalev_order_lines VALUES(10,'${w}',1,'Product A',2,790000,789400,193384)
    ON CONFLICT(scalev_order_id,product_name) DO UPDATE SET product_price_bt=EXCLUDED.product_price_bt,discount_bt=EXCLUDED.discount_bt,cogs_bt=EXCLUDED.cogs_bt;`);
  await check(`(SELECT discount_bt=265000 FROM scalev_order_lines WHERE id=10)`, 'sync overwrote manual');
  await check(`(SELECT source_amount=789400 FROM scalev_financial_corrections WHERE field='discount_bt')`, 'upsert source wrong');
  await check(`(SELECT amount=331616 FROM summary)`, 'upsert summary drift');
  await run(`UPDATE scalev_orders SET status='completed',shipping_cost=5000 WHERE id=1;`);
  await check(`(SELECT net_revenue=525000 AND status='completed' AND shipping_cost=5000 FROM scalev_orders WHERE id=1)`, 'partial sync mismatch');
  await check(`(SELECT source_amount=525 FROM scalev_financial_corrections WHERE entity='order' AND field='net_revenue')`, 'partial update corrupted source');
  await run(`UPDATE scalev_orders SET net_revenue=525000 WHERE id=1;`);
  await check(`(SELECT source_amount=525000 FROM scalev_financial_corrections WHERE entity='order' AND field='net_revenue')`, 'source equals override not captured');
  await run(`UPDATE scalev_orders SET net_revenue=600 WHERE id=1;`);
  await run(`INSERT INTO scalev_orders VALUES(1,'${w}','completed','{"net_revenue":600}',600,600,5000,NULL,0,0)
    ON CONFLICT(id) DO UPDATE SET gross_revenue=EXCLUDED.gross_revenue,net_revenue=EXCLUDED.net_revenue,raw_data=EXCLUDED.raw_data;`);
  await check(`(SELECT gross_revenue=525000 AND net_revenue=525000 AND raw_data='{"net_revenue":600}'::jsonb FROM scalev_orders WHERE id=1)`, 'header upsert/raw mismatch');

  // Delete/reinsert preserves correction by ingestion's stable product-name key.
  await run(`DELETE FROM scalev_order_lines WHERE id=10;
    INSERT INTO scalev_order_lines VALUES(11,'${w}',1,'Product A',2,790000,789300,193384);`);
  await check(`(SELECT discount_bt=265000 FROM scalev_order_lines WHERE id=11)`, 'replacement lost correction');
  await check(`(SELECT amount=331616 FROM summary)`, 'replacement summary drift');
  await rejects(`UPDATE scalev_order_lines SET product_name='Different product' WHERE id=11`,/identity changed/);

  // HPP may be corrected independently, never inferred from revenue's multiplier.
  await run(save([{entity:'line',line_key:'Product A',field:'cogs_bt',amount:200000}],1));
  await run(`UPDATE scalev_order_lines SET cogs_bt=190000 WHERE id=11;`);
  await check(`(SELECT cogs_bt=200000 FROM scalev_order_lines WHERE id=11)`, 'HPP sync mismatch');
  await check(`(SELECT amount=325000 FROM summary)`, 'HPP summary mismatch');

  await rejects(save([{entity:'order',field:'net_revenue',amount:1}],0),/version changed/);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1}],2,stranger),/access denied/);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1}],0,stranger,other),/Order not found/);
  await rejects(save([{entity:'order',field:'status',amount:1}],2),/Invalid correction target/);
  await rejects(save([{entity:'line',line_key:'Missing',field:'cogs_bt',amount:1}],2),/no longer exists/);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1.001}],2),/two decimals/);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1},{entity:'order',field:'net_revenue',amount:2}],2),/Duplicate/);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1},{entity:'line',line_key:'Missing',field:'cogs_bt',amount:1}],2),/no longer exists/);
  await check(`(SELECT net_revenue=525000 FROM scalev_orders WHERE id=1)`, 'failed bundle did not roll back');
  await check(`(SELECT count(*)=2 FROM scalev_financial_correction_audit)`, 'failed save left audit');

  await run(save([
    {entity:'order',field:'net_revenue',active:false},
    {entity:'line',line_key:'Product A',field:'discount_bt',active:false},
    {entity:'line',line_key:'Product A',field:'cogs_bt',active:false},
  ],2));
  await check(`(SELECT net_revenue=600 FROM scalev_orders WHERE id=1)`, 'cancel did not restore latest source');
  await check(`(SELECT discount_bt=789300 AND cogs_bt=190000 FROM scalev_order_lines WHERE id=11)`, 'cancel line source mismatch');
  await check(`(SELECT amount=-189300 FROM summary)`, 'cancel summary drift');
  await check(`(SELECT count(*)=3 AND bool_and(changed_by='${owner}') FROM scalev_financial_correction_audit)`, 'audit missing actor');
  await check(`(SELECT revision=3 FROM workspace_financial_revisions WHERE workspace_id='${w}')`, 'cache revision mismatch');
  await run(`UPDATE scalev_order_lines SET discount_bt=789200 WHERE id=11;`);
  await run(save([{entity:'line',line_key:'Product A',field:'discount_bt',amount:250000}],3));
  await check(`(SELECT source_amount=789200 AND original_amount=789475 FROM scalev_financial_corrections WHERE field='discount_bt')`, 'reactivation changed original');
  await run(save([{entity:'order',field:'shipping_discount',amount:100}],4));
  await run(`UPDATE scalev_orders SET shipping_discount=NULL WHERE id=1;`);
  await run(save([{entity:'order',field:'shipping_discount',active:false}],5));
  await check(`(SELECT shipping_discount IS NULL FROM scalev_orders WHERE id=1)`, 'nullable source not restored');
  await run(`DELETE FROM scalev_order_lines WHERE id=11;`);
  await run(save([{entity:'line',line_key:'Product A',field:'discount_bt',active:false}],6));
  await run(`INSERT INTO scalev_order_lines VALUES(12,'${w}',1,'Product A',2,790000,789100,193384);`);
  await check(`(SELECT discount_bt=789100 FROM scalev_order_lines WHERE id=12)`, 'orphan cancellation not respected');
  await run(`SELECT set_config('request.jwt.claim.role','authenticated',false); SELECT set_config('request.jwt.claim.sub','${stranger}',false);`);
  await rejects(save([{entity:'order',field:'net_revenue',amount:1}],4),/another user/);
  await run(`SET ROLE authenticated;`);
  await rejects(`UPDATE scalev_financial_corrections SET corrected_amount=1`,/permission denied/);
  await run(`RESET ROLE;`);
  console.log('PASS: source preservation, replay/upsert/replacement, partial writes, HPP, cancellation, atomicity, audit, versions and access');
} catch (error) {
  console.error(error.message, error.where || error.stderr || '');
  process.exitCode = 1;
} finally {
  if (engine) await engine.close(); else docker('dropdb',['--if-exists',database]);
}
