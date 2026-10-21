import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
const database = `sync_queue_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const args = (command, rest) => ['exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'sync-queue-test', command, '-U', 'supabase_admin', ...rest];
const docker = (command, rest, input) => execFileSync('docker', args(command, rest), { input, encoding: 'utf8', timeout: 30000 });
const sql = text => docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], text).trim();
const migration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const add = (n, priority, age, extra = '') => sql(`INSERT INTO public.sync_jobs(id,job_name,route,priority,available_at${extra ? ',status,attempt_count,max_attempts' : ''}) VALUES ('${id(n)}','meta_sync','/test',${priority},now()-interval '${age}'${extra ? ',' + extra : ''});`);
const claim = worker => sql(`SELECT id FROM public.claim_next_sync_job('${worker}');`);
let locker;
docker('createdb', [database]);
try {
  sql(`CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE FUNCTION public.trg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;`);
  sql(migration('112_sync_jobs_queue.sql'));
  sql(`REVOKE EXECUTE ON FUNCTION public.claim_next_sync_job(text) FROM PUBLIC;`);
  const grants = sql(`SELECT proacl::text FROM pg_proc WHERE oid='public.claim_next_sync_job(text)'::regprocedure;`);
  sql(migration('229_sync_queue_fairness.sql'));
  assert.equal(sql(`SELECT proacl::text FROM pg_proc WHERE oid='public.claim_next_sync_job(text)'::regprocedure;`), grants);
  assert.match(sql(`SELECT proconfig::text FROM pg_proc WHERE oid='public.claim_next_sync_job(text)'::regprocedure;`), /search_path=pg_catalog, public, extensions, auth, pg_temp/);
  assert.equal(sql(`SELECT prosecdef FROM pg_proc WHERE oid='public.claim_next_sync_job(text)'::regprocedure;`), 'f');
  assert.equal(claim('empty'), '');
  // Fresh work keeps its priority even if lower-priority metadata arrived first.
  add(1, 25, '30 seconds'); add(2, 20, '0 seconds');
  assert.equal(claim('fresh'), id(2)); assert.equal(claim('fresh'), id(1));
  sql('TRUNCATE public.sync_jobs;');
  // Repeated Scalev continuations cannot starve metadata waiting past the threshold.
  add(10, 25, '121 seconds'); add(11, 20, '0 seconds');
  assert.equal(claim('fair'), id(10));
  assert.equal(sql(`SELECT status||':'||attempt_count||':'||locked_by||':'||(started_at IS NOT NULL)||':'||(locked_at IS NOT NULL) FROM sync_jobs WHERE id='${id(10)}'`), 'running:1:fair:true:true');
  assert.equal(claim('fair'), id(11));
  sql('TRUNCATE public.sync_jobs;');
  // Overdue work runs oldest-first in either direction, independently of priority.
  add(20, 35, '5 minutes'); add(21, 10, '3 minutes'); add(22, 1, '0 seconds');
  assert.equal(claim('oldest'), id(20)); assert.equal(claim('oldest'), id(21)); assert.equal(claim('oldest'), id(22));
  sql('TRUNCATE public.sync_jobs;');
  // A delayed retry does not inherit urgency from its old creation time.
  add(30, 25, '0 seconds'); sql(`UPDATE sync_jobs SET created_at=now()-interval '1 day' WHERE id='${id(30)}';`);
  add(31, 20, '0 seconds'); add(32, 1, '-1 hour');
  add(33, 1, '1 hour', "'queued',3,3"); add(34, 1, '1 hour', "'running',1,3");
  assert.equal(claim('eligible'), id(31)); assert.equal(claim('eligible'), id(30)); assert.equal(claim('eligible'), '');
  sql('TRUNCATE public.sync_jobs;');
  // Concurrent claim skips a locked oldest job rather than blocking or duplicating it.
  add(40, 25, '5 minutes'); add(41, 20, '0 seconds');
  locker = spawn('docker', args('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1']), { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(locker, 'exit');
  const ready = new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Row lock was not established')), 10000);
    locker.stdout.on('data', chunk => { output += chunk; if (output.includes('LOCK_READY')) { clearTimeout(timer); resolve(); } });
    locker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  locker.stdin.write(`BEGIN; SELECT id FROM public.sync_jobs WHERE id='${id(40)}' FOR UPDATE; SELECT 'LOCK_READY';\n`);
  await ready;
  assert.equal(claim('concurrent'), id(41));
  locker.stdin.end('ROLLBACK;\n'); assert.equal((await exited)[0], 0); locker = null;
  assert.equal(claim('after-lock'), id(40)); assert.equal(claim('no-duplicates'), '');
  console.log('PASS: fresh priority, overdue fairness, retry timing, eligibility, claim state, concurrent locks, grants and search path');
} finally {
  if (locker) { const exited = once(locker, 'exit'); locker.stdin.end('ROLLBACK;\n'); await exited; }
  docker('dropdb', ['--if-exists', database]);
}
