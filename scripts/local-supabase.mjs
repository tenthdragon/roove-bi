import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, access, chmod, stat } from 'node:fs/promises';
import { readFileSync, existsSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createLoopbackProxy } from './local-docker-proxy.mjs';
import { APP_PORT, PROJECT_ID, NETWORK_NAME, assertLocalUrl, assertProjectConfig, assertLoopbackBindings, buildMigrations, cleanEnvironment, blankDotenvKeys, localCliArgs, sqlLiteral, sha256 } from './local-supabase-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const stack = path.join(local, 'supabase');
const dbContainer = `supabase_db_${PROJECT_ID}`;
const command = process.argv[2] || 'status';
const env = cleanEnvironment();
const exists = async (file) => access(file).then(() => true, () => false);
const redact = (s) => s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local-key]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[local-key]');

async function prepare() {
  if (await exists(path.join(stack, '.temp/project-ref'))) throw new Error('Refusing linked .local project. Remove the link manually after checking its purpose.');
  await mkdir(path.join(stack, 'migrations'), { recursive: true });
  await chmod(local, 0o700);
  await copyFile(path.join(root, 'supabase/local/config.toml'), path.join(stack, 'config.toml'));
  const migrations = await buildMigrations(root);
  for (const item of migrations) await writeFile(path.join(stack, 'migrations', item.generatedName), item.sql);
  await writeFile(path.join(local, 'migration-manifest.json'), JSON.stringify(migrations.map(({ sql, ...item }) => item), null, 2) + '\n');
  return migrations;
}
function cliCapture(action) {
  guardProject();
  return execFileSync('supabase', localCliArgs(action), { cwd: root, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function guardProject() {
  if (existsSync(path.join(stack,'.temp/project-ref'))) throw new Error('Refusing linked .local project');
  assertProjectConfig(readFileSync(path.join(stack,'config.toml'),'utf8'));
}
function ensureNetwork() {
  const inspect = () => JSON.parse(execFileSync('docker', ['network','inspect',NETWORK_NAME], { env, encoding:'utf8', stdio:['ignore','pipe','pipe'] }))[0];
  let network;
  try { network = inspect(); }
  catch {
    execFileSync('docker',['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1','--label',`roove.bi.local.project=${PROJECT_ID}`,NETWORK_NAME], { env, stdio:['ignore','pipe','pipe'] });
    network = inspect();
  }
  if (network.Driver !== 'bridge' || network.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1' || network.Labels?.['roove.bi.local.project'] !== PROJECT_ID) {
    throw new Error('Existing loopback network is not the expected Roove-owned network; no changes made.');
  }
}
function verifyBindings() {
  const containers = ['db','kong','studio','inbucket'].map((name) => `supabase_${name}_${PROJECT_ID}`);
  assertLoopbackBindings(JSON.parse(execFileSync('docker',['inspect',...containers],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']})));
}
async function cliRun(action) {
  guardProject();
  if (action === 'start') ensureNetwork();
  let closeProxy;
  const cliEnv = { ...env };
  if (action === 'start') {
    const host = env.DOCKER_HOST || execFileSync('docker', ['context','inspect','--format','{{.Endpoints.docker.Host}}'], { env, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
    if (!host.startsWith('unix://')) throw new Error('Local Docker setup requires a Unix socket, not a remote Docker host');
    const proxySocket = path.join(local, `docker-loopback-${process.pid}.sock`);
    closeProxy = await createLoopbackProxy(proxySocket, host.slice(7));
    delete cliEnv.DOCKER_CONTEXT;
    cliEnv.DOCKER_HOST = `unix://${proxySocket}`;
  }
  console.log(`${action === 'start' ? 'Starting' : 'Stopping'} isolated Supabase project ${PROJECT_ID}...`);
  try { await new Promise((resolve, reject) => {
    const child = spawn('supabase', localCliArgs(action), { cwd: root, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    const report = (chunk) => {
      for (const line of chunk.toString().split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        last = line;
        if (!/(Downloading|Extracting|Pulling fs layer|Waiting|Download complete|Verifying Checksum|Pull complete|\[local-key\]|Anon key|Service role|Secret|Publishable|S3.*Key|JWT secret|Access Key)/i.test(redact(line))) console.log(redact(line));
      }
    };
    child.stdout.on('data', report); child.stderr.on('data', report);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`supabase ${action} failed (${code}): ${redact(last)}`)));
  }); } finally { if (closeProxy) await closeProxy(); }
  if (action === 'start') verifyBindings();
}
function status() {
  const value = JSON.parse(cliCapture('status'));
  assertLocalUrl(value.API_URL);
  if (!value.ANON_KEY || !value.SERVICE_ROLE_KEY) throw new Error('Local auth keys are not available');
  return value;
}
function psql(sql) {
  return execFileSync('docker', ['exec', '-i', dbContainer, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], {
    cwd: root, env, input: sql, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}
async function migrate(migrations) {
  if (await exists(path.join(local,'clone-state.json'))) throw new Error('Production-clone mode: historical bootstrap is disabled. Apply only a reviewed new migration locally.');
  status(); // URL guard before every write workflow; Docker target is fixed, not configurable.
  psql(`CREATE SCHEMA IF NOT EXISTS roove_local;
    REVOKE ALL ON SCHEMA roove_local FROM PUBLIC,anon,authenticated;
    CREATE TABLE IF NOT EXISTS roove_local.bootstrap_history(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS roove_local.seed_history(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());`);
  const applied = new Map(JSON.parse(psql("SELECT coalesce(json_agg(json_build_array(name,checksum)), '[]') FROM roove_local.bootstrap_history;")));
  for (const item of migrations) {
    if (applied.has(item.name)) {
      if (applied.get(item.name) !== item.checksum) throw new Error(`Already-applied local migration changed: ${item.name}. No automatic reset is performed.`);
      continue;
    }
    console.log(`Apply local migration: ${item.name}`);
    try {
      psql(`BEGIN;\n${item.sql}\nINSERT INTO roove_local.bootstrap_history(name,checksum) VALUES(${sqlLiteral(item.name)},${sqlLiteral(item.checksum)});\nCOMMIT;`);
    } catch (error) {
      throw new Error(`${item.name}: ${redact(error.stderr?.toString() || error.message)}`);
    }
  }
  console.log(`${migrations.length} local bootstrap migrations verified.`);
}
async function seed() {
  if (await exists(path.join(local,'clone-state.json'))) throw new Error('Production-clone mode: dummy seeds/password resets are disabled. Existing production-copy accounts are preserved.');
  const info = status();
  if (psql("SELECT count(*) FROM roove_local.seed_history WHERE name='growth-local-v1';") === '1') {
    if (!(await exists(path.join(local, 'login.json')))) throw new Error('Seed exists but .local/login.json is missing. Existing users/data will not be reset automatically.');
    console.log('Local seed already exists; preserving test records and account settings.');
    return;
  }
  const client = createClient(info.API_URL, info.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const credentialsFile = path.join(local, 'login.json');
  const credentials = await exists(credentialsFile) ? JSON.parse(await readFile(credentialsFile, 'utf8')) : {
    password: `RooveLocal-${randomBytes(18).toString('base64url')}`,
    accounts: [
      { email: 'owner@roove.test', name: 'Owner Lokal', role: 'owner' },
      { email: 'growth@roove.test', name: 'Growth Lead Lokal', role: 'brand_manager' },
      { email: 'creative@roove.test', name: 'Creative Lokal', role: 'manager' },
      { email: 'reviewer@roove.test', name: 'Reviewer Lokal', role: 'manager' }
    ]
  };
  await writeFile(credentialsFile, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
  await chmod(credentialsFile, 0o600);
  const { data: users, error: listError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  for (const account of credentials.accounts) {
    const existing = users.users.find((user) => user.email === account.email);
    const result = existing ? await client.auth.admin.updateUserById(existing.id, { password: credentials.password, email_confirm: true }) : await client.auth.admin.createUser({ email: account.email, password: credentials.password, email_confirm: true, user_metadata: { full_name: account.name } });
    if (result.error) throw result.error;
    account.id = result.data.user.id;
  }
  await writeFile(credentialsFile, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
  let sql = await readFile(path.join(root, 'supabase/local/seed.sql'), 'utf8');
  for (const account of credentials.accounts) {
    if (!/^[0-9a-f-]{36}$/.test(account.id)) throw new Error('Invalid local auth user ID');
    sql = sql.replaceAll(`{{${account.email.split('@')[0]}_id}}`, account.id);
  }
  try { psql(`BEGIN;\n${sql}\nINSERT INTO roove_local.seed_history(name) VALUES('growth-local-v1');\nCOMMIT;`); }
  catch (error) { throw new Error(`Local seed: ${redact(error.stderr?.toString() || error.message)}`); }
  await writeFile(path.join(local, 'app.env'), `NEXT_PUBLIC_SUPABASE_URL=${info.API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${info.ANON_KEY}\nSUPABASE_SERVICE_ROLE_KEY=${info.SERVICE_ROLE_KEY}\nNEXT_PUBLIC_SITE_URL=http://127.0.0.1:${APP_PORT}\nNEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS=roove.test\n`, { mode: 0o600 });
  console.log('Local users/workspaces/Growth sample records seeded. Credentials: .local/login.json');
}
async function applyCloneMigration(name) {
  status(); verifyBindings();
  if (!(await exists(path.join(local,'clone-state.json')))) throw new Error('An activated, verified production clone is required.');
  if (!/^\d+_[A-Za-z0-9_]+\.sql$/.test(name || '') || /ROLLBACK|verify|validation_queries/i.test(name)) throw new Error('Specify exactly one reviewed migration filename, not a path or historical replay.');
  const sql=await readFile(path.join(root,'supabase/migrations',name),'utf8');
  const checksum=sha256(sql);
  psql(`CREATE SCHEMA IF NOT EXISTS roove_local; REVOKE ALL ON SCHEMA roove_local FROM PUBLIC,anon,authenticated;
    CREATE TABLE IF NOT EXISTS roove_local.clone_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());`);
  const applied=psql(`SELECT checksum FROM roove_local.clone_migrations WHERE name=${sqlLiteral(name)};`);
  if(applied && applied!==checksum) throw new Error('Already-applied clone migration changed; no automatic replacement.');
  if(!applied) {
    if(/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(sql) && !(sql.match(/^\s*BEGIN;\s*$/gm)?.length===1 && sql.match(/^\s*COMMIT;\s*$/gm)?.length===1)) throw new Error('Review transaction control before applying this file locally.');
    const body=sql.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,'');
    try {psql(`BEGIN;\n${body}\nINSERT INTO roove_local.clone_migrations(name,checksum) VALUES(${sqlLiteral(name)},${sqlLiteral(checksum)}); COMMIT;`);}
    catch(error) {throw new Error(`Local migration failed: ${redact(error.stderr?.toString() || error.message)}`);}
  }
  const stateFile=path.join(local,'clone-state.json');
  const state=JSON.parse(await readFile(stateFile,'utf8'));
  if(!state.local_overlays.some(item=>item.migration===name)) state.local_overlays.push({migration:name,sha256:checksum,applied_at:new Date().toISOString()});
  await writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});
  psql("NOTIFY pgrst, 'reload schema';");
  console.log(`Verified local-only migration: ${name}`);
}
async function verify() {
  const info = status();
  verifyBindings();
  if (await exists(path.join(local,'clone-state.json'))) {
    const state=JSON.parse(await readFile(path.join(local,'clone-state.json'),'utf8'));
    const client=createClient(info.API_URL,info.SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const users=await client.auth.admin.listUsers({page:1,perPage:1000});
    if(users.error) throw new Error(`Local cloned Auth: ${users.error.message}`);
    const workspaces=await client.from('workspaces').select('id',{count:'exact',head:true});
    if(workspaces.error) throw new Error(`Local cloned REST: ${workspaces.error.message}`);
    console.log(JSON.stringify({healthy:true,mode:'production-snapshot',api:info.API_URL,studio:info.STUDIO_URL,app:`http://127.0.0.1:${APP_PORT}`,authUsers:users.data.users.length,workspaces:workspaces.count,baseline:state.verification},null,2));
    return;
  }
  const credentials = JSON.parse(await readFile(path.join(local, 'login.json'), 'utf8'));
  const checks = [];
  const anonymous = createClient(info.API_URL, info.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const anonRecords = await anonymous.from('growth_records').select('id');
  if (anonRecords.data?.length) throw new Error('Anonymous users must not read Growth records');
  for (const account of credentials.accounts) {
    const client = createClient(info.API_URL, info.ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = await client.auth.signInWithPassword({ email: account.email, password: credentials.password });
    if (auth.error) throw new Error(`Local login ${account.email}: ${auth.error.message}`);
    const profile = await client.from('profiles').select('id,role,active_workspace_id').eq('id', account.id).single();
    if (profile.error || profile.data.role !== account.role) throw new Error(`Profile/RLS check failed for ${account.email}`);
    const records = await client.from('growth_records').select('id,kind');
    if (records.error || !records.data.length) throw new Error(`Growth/RLS check failed for ${account.email}: ${records.error?.message || 'no accessible records'}`);
    const restricted = ['creative@roove.test','reviewer@roove.test'].includes(account.email);
    for (let index = 1; index <= 3; index++) {
      const visible = records.data.some((record) => record.id === `20000000-0000-4000-8000-${String(index).padStart(12,'0')}`);
      if (visible !== (!restricted || index === 2)) throw new Error(`Seed visibility/RLS mismatch for ${account.email}, record ${index}`);
    }
    checks.push({ email: account.email, role: account.role, visibleGrowthRecords: records.data.length });
    // Do not revoke a developer's browser session while running health checks.
    await client.auth.signOut({ scope: 'local' });
  }
  console.log(JSON.stringify({ healthy: true, api: info.API_URL, studio: info.STUDIO_URL, app: `http://127.0.0.1:${APP_PORT}`, checks }, null, 2));
}
async function backup() {
  status();
  verifyBindings();
  const directory = path.join(local,'backups');
  await mkdir(directory,{recursive:true,mode:0o700});
  const file = path.join(directory,`${PROJECT_ID}-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
  const child = spawn('docker',['exec',dbContainer,'pg_dump','-U','postgres','-d','postgres','--format=custom','--no-owner'],{env,stdio:['ignore','pipe','pipe']});
  let errorText='';
  child.stderr.on('data',(data)=>{errorText+=data.toString();});
  await Promise.all([
    pipeline(child.stdout,createWriteStream(file,{flags:'wx',mode:0o600})),
    new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code)=>code===0?resolve():reject(new Error(`Local backup failed (${code}): ${redact(errorText)}`)));})
  ]);
  console.log(JSON.stringify({project:PROJECT_ID,backup:file,bytes:(await stat(file)).size},null,2));
}
async function dev() {
  const info = status();
  verifyBindings();
  const appEnv = cleanEnvironment();
  // Next loads these files automatically. Blank every declared key BEFORE Next
  // starts, so it cannot inherit cloud/integration credentials from dotenv.
  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const file = path.join(root, name);
    if (await exists(file)) Object.assign(appEnv, blankDotenvKeys(await readFile(file, 'utf8')));
  }
  const cloned=await exists(path.join(local,'clone-state.json'));
  Object.assign(appEnv, { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: info.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: info.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: info.SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${APP_PORT}`, NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS: cloned?'':'roove.test', NEXT_PUBLIC_SUPPORT_EMAIL: cloned?'':'owner@roove.test', ROOVE_LOCAL_DEV: '1', NEXT_PUBLIC_APP_ENV: 'development', NODE_OPTIONS:`--import=${path.join(root,'scripts/local-network-guard.mjs')}` });
  console.log(`Roove BI local database mode: http://127.0.0.1:${APP_PORT} (no production dotenv credentials)`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(APP_PORT)], { cwd: root, env: appEnv, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { process.exitCode = code ?? 0; resolve(); }); });
}

try {
  if (command === 'prepare') console.log(`Prepared ${(await prepare()).length} local migrations.`);
  else if (command === 'setup') { const migrations = await prepare(); await cliRun('start'); if (!(await exists(path.join(local,'clone-state.json')))) { await migrate(migrations); await seed(); } await verify(); }
  else if (command === 'migrate') await migrate(await prepare());
  else if (command === 'migration') await applyCloneMigration(process.argv[3]);
  else if (command === 'seed') await seed();
  else if (command === 'start') { await prepare(); await cliRun('start'); }
  else if (command === 'stop') { if (await exists(path.join(stack, '.temp/project-ref'))) throw new Error('Refusing linked project'); await cliRun('stop'); }
  else if (command === 'status') { const s = status(); console.log(JSON.stringify({ project: PROJECT_ID, api: s.API_URL, studio: s.STUDIO_URL, db: '127.0.0.1:54322', credentials: (await exists(path.join(local,'clone-state.json')))?'Existing Roove BI accounts (local copy)':'.local/login.json' }, null, 2)); }
  else if (command === 'verify') await verify();
  else if (command === 'backup') await backup();
  else if (command === 'dev') await dev();
  else throw new Error('Use setup, prepare, migrate, migration <filename>, seed, start, stop, status, verify, backup, or dev. No remote/reset commands exist.');
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
